"""
Thin wrapper around the Spotify Web API. Two important limits baked into
the design elsewhere in this app because of Spotify's API, not a choice
we made:
  - There is no endpoint to reorder or remove items from a device's live
    playback queue. Only `queue_track` (add) exists.
  - There is no endpoint to *read back* the live queue either.
Because of this, `queue_items` in our own DB is the real queue, and only
the next pending item gets pushed here right before it's due to play.
See app/services/queue_engine.py.
"""
import httpx

from .database import get_db
from .security import decrypt, encrypt
from .spotify_helpers import get_spotify_credentials

BASE_URL = "https://api.spotify.com/v1"


async def _get_access_token() -> str:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM spotify_account ORDER BY id DESC LIMIT 1").fetchone()
    if row is None:
        raise RuntimeError("No Spotify account connected yet")

    from datetime import datetime, timezone
    if row["expires_at"] > datetime.now(timezone.utc).isoformat():
        return decrypt(row["access_token_enc"])

    # expired — refresh
    client_id, client_secret = get_spotify_credentials()
    if not client_id or not client_secret:
        raise RuntimeError("Spotify Client ID and Secret are not configured")

    refresh_token = decrypt(row["refresh_token_enc"])
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://accounts.spotify.com/api/token",
            data={"grant_type": "refresh_token", "refresh_token": refresh_token},
            auth=(client_id, client_secret),
        )
        resp.raise_for_status()
        data = resp.json()

    new_access = data["access_token"]
    new_expiry = (datetime.now(timezone.utc).timestamp() + data["expires_in"])
    from datetime import datetime as dt
    expires_iso = dt.fromtimestamp(new_expiry, tz=timezone.utc).isoformat()

    with get_db() as conn:
        conn.execute(
            "UPDATE spotify_account SET access_token_enc = ?, expires_at = ? WHERE id = ?",
            (encrypt(new_access), expires_iso, row["id"]),
        )
        conn.commit()

    return new_access


async def search_tracks(query: str, limit: int = 10) -> list[dict]:
    limit = max(1, min(limit, 10))
    token = await _get_access_token()
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{BASE_URL}/search",
            params={"q": query, "type": "track", "limit": limit},
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
    items = resp.json()["tracks"]["items"]
    return [
        {
            "uri": t["uri"],
            "name": t["name"],
            "artist": ", ".join(a["name"] for a in t["artists"]),
            "album_art_url": t["album"]["images"][0]["url"] if t["album"]["images"] else None,
            "duration_ms": t["duration_ms"],
        }
        for t in items
    ]


async def push_to_live_queue(track_uri: str, device_id: str | None = None) -> None:
    token = await _get_access_token()
    params = {"uri": track_uri}

    async with httpx.AsyncClient() as client:
        # If no explicit device_id, check if there is an active playing device
        if not device_id:
            try:
                pb = await client.get(
                    f"{BASE_URL}/me/player",
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=3.0,
                )
                if pb.status_code == 200:
                    active_dev = pb.json().get("device", {})
                    if active_dev.get("id"):
                        device_id = active_dev["id"]
            except Exception:
                pass

        if device_id:
            params["device_id"] = device_id

        resp = await client.post(
            f"{BASE_URL}/me/player/queue",
            params=params,
            headers={"Authorization": f"Bearer {token}"},
            timeout=5.0,
        )
        resp.raise_for_status()


async def get_currently_playing() -> dict | None:
    token = await _get_access_token()
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{BASE_URL}/me/player/currently-playing",
            headers={"Authorization": f"Bearer {token}"},
        )
    if resp.status_code == 204 or resp.status_code >= 400:
        return None
    return resp.json()
