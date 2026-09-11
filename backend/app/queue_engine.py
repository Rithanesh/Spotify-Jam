"""
Own queue live here. Spotify API no let reorder/remove — so app keep
truth in `queue_items` table. Only push ONE track to real Spotify queue,
right before it play. This module = the bridge between our table and
Spotify's dumb one-way queue.
"""
import httpx

from . import spotify_client
from .database import get_db, now, write_audit_log

AUTO_PUSH_ENABLED = False


async def push_next_if_needed():
    """Call on a timer (see scheduler.py). If nothing pushed/playing right
    now, push oldest pending item to Spotify's real queue."""
    # 1. Sync playback state: If an item was marked 'pushed' or 'playing', check if it's still playing/queued in Spotify
    with get_db() as conn:
        active = conn.execute(
            "SELECT * FROM queue_items WHERE status IN ('pushed','playing') ORDER BY position LIMIT 1"
        ).fetchone()

    if active:
        try:
            token = await spotify_client._get_access_token()
            async with httpx.AsyncClient() as client:
                q_resp = await client.get(
                    "https://api.spotify.com/v1/me/player/queue",
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=4.0,
                )
            if q_resp.status_code == 200:
                q_data = q_resp.json()
                curr_playing = q_data.get("currently_playing") or {}
                curr_uri = curr_playing.get("uri")
                spotify_queue = [item.get("uri") for item in q_data.get("queue", [])]

                if active["track_uri"] == curr_uri:
                    if active["status"] != "playing":
                        with get_db() as conn:
                            conn.execute("UPDATE queue_items SET status = 'playing' WHERE id = ?", (active["id"],))
                            conn.commit()
                    return  # currently playing, wait until it finishes
                elif active["track_uri"] in spotify_queue:
                    return  # still queued in Spotify, wait
                else:
                    # Not playing and no longer in Spotify queue (was cleared or played)
                    import datetime
                    from .database import now
                    # Add a 15-second grace period after pushing before assuming it was skipped
                    if active["pushed_at"]:
                        pushed_dt = datetime.datetime.fromisoformat(active["pushed_at"].replace('Z', '+00:00'))
                        if (datetime.datetime.now(datetime.timezone.utc) - pushed_dt).total_seconds() < 15:
                            return # Spotify might just be slow to update, wait
                    
                    with get_db() as conn:
                        conn.execute("UPDATE queue_items SET status = 'played', played_at = ? WHERE id = ?", (now(), active["id"]))
                        conn.commit()
        except Exception as e:
            import logging
            logging.getLogger("spotify-jam-app.queue").debug(f"Queue sync check error: {e}")
            return  # temporary network error, don't push duplicates yet

    if not AUTO_PUSH_ENABLED:
        return

    with get_db() as conn:
        target_device = conn.execute(
            "SELECT * FROM playback_devices WHERE is_target = 1 LIMIT 1"
        ).fetchone()

        next_item = conn.execute(
            "SELECT * FROM queue_items WHERE status = 'pending' ORDER BY position LIMIT 1"
        ).fetchone()
        if next_item is None:
            return  # queue empty

    device_id = target_device["spotify_device_id"] if target_device else None

    try:
        await spotify_client.push_to_live_queue(next_item["track_uri"], device_id)
    except Exception as e:
        import logging
        logging.getLogger("spotify-jam-app.queue").warning(f"Failed to push {next_item['track_name']} to Spotify: {e}")
        return

    with get_db() as conn:
        conn.execute(
            "UPDATE queue_items SET status = 'pushed', pushed_at = ? WHERE id = ?",
            (now(), next_item["id"]),
        )
        write_audit_log(conn, None, "song_pushed_to_spotify", "queue_item", next_item["id"],
                         {"track_name": next_item["track_name"]})
        conn.commit()


async def push_item_now(item_id: int) -> dict:
    """Manually push a specific queue item to Spotify right now."""
    with get_db() as conn:
        item = conn.execute("SELECT * FROM queue_items WHERE id = ?", (item_id,)).fetchone()
        if not item:
            raise ValueError("Song not found in queue")

        target_device = conn.execute(
            "SELECT * FROM playback_devices WHERE is_target = 1 LIMIT 1"
        ).fetchone()

    device_id = target_device["spotify_device_id"] if target_device else None
    await spotify_client.push_to_live_queue(item["track_uri"], device_id)

    with get_db() as conn:
        conn.execute(
            "UPDATE queue_items SET status = 'pushed', pushed_at = ? WHERE id = ?",
            (now(), item["id"]),
        )
        write_audit_log(conn, None, "song_manually_pushed_to_spotify", "queue_item", item["id"],
                         {"track_name": item["track_name"]})
        conn.commit()
    return {"ok": True, "id": item_id, "status": "pushed"}


def add_song(user_id: int, track: dict) -> int:
    with get_db() as conn:
        max_pos = conn.execute(
            "SELECT COALESCE(MAX(position), 0) AS m FROM queue_items"
        ).fetchone()["m"]
        cur = conn.execute(
            """INSERT INTO queue_items
               (track_uri, track_name, artist_name, album_art_url, duration_ms, added_by, position, status, added_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)""",
            (track["uri"], track["name"], track["artist"], track.get("album_art_url"),
             track.get("duration_ms"), user_id, max_pos + 1, now()),
        )
        item_id = cur.lastrowid
        write_audit_log(conn, user_id, "song_added", "queue_item", item_id, {"track_name": track["name"]})
        conn.commit()
    return item_id


def remove_song(user_id: int, user_role: str, item_id: int) -> None:
    with get_db() as conn:
        item = conn.execute("SELECT * FROM queue_items WHERE id = ?", (item_id,)).fetchone()
        if item is None:
            raise ValueError("Song not found")
        if user_role != "admin" and item["added_by"] != user_id:
            raise ValueError("You can only remove your own songs")
        conn.execute("UPDATE queue_items SET status = 'removed' WHERE id = ?", (item_id,))
        write_audit_log(conn, user_id, "song_removed", "queue_item", item_id, {"track_name": item["track_name"]})
        conn.commit()


def reorder_song(user_id: int, item_id: int, new_position: int) -> None:
    with get_db() as conn:
        item = conn.execute("SELECT * FROM queue_items WHERE id = ?", (item_id,)).fetchone()
        if item is None or item["status"] != "pending":
            raise ValueError("Can only reorder songs still pending")
        old_position = item["position"]

        if new_position > old_position:
            conn.execute(
                "UPDATE queue_items SET position = position - 1 WHERE status='pending' AND position > ? AND position <= ?",
                (old_position, new_position),
            )
        else:
            conn.execute(
                "UPDATE queue_items SET position = position + 1 WHERE status='pending' AND position >= ? AND position < ?",
                (new_position, old_position),
            )
        conn.execute("UPDATE queue_items SET position = ? WHERE id = ?", (new_position, item_id))
        write_audit_log(conn, user_id, "song_reordered", "queue_item", item_id,
                         {"from_position": old_position, "to_position": new_position})
        conn.commit()


def list_pending(include_all: bool = False):
    with get_db() as conn:
        status_filter = "status IN ('pending','pushed','playing')" if not include_all else "status IN ('pending','pushed','playing','played','removed','skipped')"
        rows = conn.execute(
            f"""
            SELECT q.*, u.username as added_by_username, u.display_name as added_by_display_name, u.role as added_by_role
            FROM queue_items q
            LEFT JOIN users u ON q.added_by = u.id
            WHERE {status_filter}
            ORDER BY q.position ASC, q.added_at ASC
            """
        ).fetchall()
    return [dict(r) for r in rows]
