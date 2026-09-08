import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import queue_engine, spotify_client
from ..deps import get_current_user, require_discoverable_for_lan

router = APIRouter(prefix="/api/queue", tags=["queue"], dependencies=[Depends(require_discoverable_for_lan)])
logger = logging.getLogger("spotify-jam-app")


class AddSongRequest(BaseModel):
    uri: str
    name: str
    artist: str
    album_art_url: str | None = None
    duration_ms: int | None = None


class ReorderRequest(BaseModel):
    new_position: int


@router.get("/search")
async def search(q: str, user: dict = Depends(get_current_user)):
    if not q or not q.strip():
        return []
    try:
        return await spotify_client.search_tracks(q.strip())
    except RuntimeError as e:
        raise HTTPException(
            status_code=400,
            detail="No Spotify account connected yet. Please go to Settings and click 'Connect Spotify Account' first.",
        )
    except Exception as e:
        logger.warning(f"Spotify track search error: {e}")
        raise HTTPException(status_code=400, detail=f"Search failed: {e}")


@router.get("/now-playing")
async def get_now_playing(user: dict = Depends(get_current_user)):
    try:
        data = await spotify_client.get_currently_playing()
        if not data or not data.get("item"):
            return None
        item = data["item"]
        return {
            "is_playing": data.get("is_playing", False),
            "progress_ms": data.get("progress_ms", 0),
            "duration_ms": item.get("duration_ms", 0),
            "track_name": item.get("name"),
            "artist_name": ", ".join(a.get("name", "") for a in item.get("artists", [])),
            "album_art_url": item.get("album", {}).get("images", [{}])[0].get("url") if item.get("album", {}).get("images") else None,
            "uri": item.get("uri"),
        }
    except Exception as e:
        logger.debug(f"Error fetching currently playing: {e}")
        return None


@router.get("")
def list_queue(all: bool = False, user: dict = Depends(get_current_user)):
    include_all = all and user.get("role") == "admin"
    return queue_engine.list_pending(include_all=include_all)


@router.post("")
def add(body: AddSongRequest, user: dict = Depends(get_current_user)):
    item_id = queue_engine.add_song(user["id"], body.model_dump())
    return {"id": item_id}


@router.delete("/{item_id}")
def remove(item_id: int, user: dict = Depends(get_current_user)):
    try:
        queue_engine.remove_song(user["id"], item_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True}


@router.patch("/{item_id}/position")
def reorder(item_id: int, body: ReorderRequest, user: dict = Depends(get_current_user)):
    try:
        queue_engine.reorder_song(user["id"], item_id, body.new_position)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True}


@router.post("/{item_id}/push")
async def push_now(item_id: int, user: dict = Depends(get_current_user)):
    try:
        res = await queue_engine.push_item_now(item_id)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
