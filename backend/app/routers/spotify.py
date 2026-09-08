from datetime import datetime, timedelta, timezone
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse

from ..config import SPOTIFY_REDIRECT_URI
from ..database import get_db, now, write_audit_log
from ..deps import require_admin
from ..security import encrypt
from ..spotify_helpers import get_spotify_credentials

router = APIRouter(prefix="/api/spotify", tags=["spotify"])
logger = logging.getLogger("spotify-jam-app")

SCOPES = "user-read-playback-state user-modify-playback-state user-read-currently-playing streaming"


@router.get("/status")
def spotify_status(admin: dict = Depends(require_admin)):
    """Check if a Spotify account is currently linked."""
    with get_db() as conn:
        row = conn.execute("SELECT spotify_user_id, connected_at FROM spotify_account ORDER BY id DESC LIMIT 1").fetchone()
    if row:
        return {"connected": True, "spotify_user_id": row["spotify_user_id"], "connected_at": row["connected_at"]}
    return {"connected": False, "spotify_user_id": None, "connected_at": None}


@router.get("/connect")
def connect(admin: dict = Depends(require_admin)):
    """Admin-only — kicks off OAuth. Frontend opens this URL in a browser
    window; Spotify redirects back to /callback below."""
    client_id, client_secret = get_spotify_credentials()
    if not client_id or not client_secret:
        raise HTTPException(
            status_code=400,
            detail="Spotify Client ID and Secret are not configured yet. Please enter them in Settings.",
        )

    params = (
        f"response_type=code&client_id={client_id}"
        f"&scope={SCOPES.replace(' ', '%20')}"
        f"&redirect_uri={SPOTIFY_REDIRECT_URI}"
    )
    return {"auth_url": f"https://accounts.spotify.com/authorize?{params}"}


@router.get("/callback")
async def callback(code: str):
    client_id, client_secret = get_spotify_credentials()
    if not client_id or not client_secret:
        raise HTTPException(status_code=400, detail="Spotify credentials are not configured")

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://accounts.spotify.com/api/token",
            data={"grant_type": "authorization_code", "code": code, "redirect_uri": SPOTIFY_REDIRECT_URI},
            auth=(client_id, client_secret),
        )
        resp.raise_for_status()
        tokens = resp.json()

        profile_resp = await client.get(
            "https://api.spotify.com/v1/me",
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
        profile = profile_resp.json()

    expires_at = (datetime.now(timezone.utc) + timedelta(seconds=tokens["expires_in"])).isoformat()

    with get_db() as conn:
        conn.execute(
            """INSERT INTO spotify_account
               (spotify_user_id, access_token_enc, refresh_token_enc, scope, expires_at, connected_by, connected_at)
               VALUES (?, ?, ?, ?, ?, (SELECT id FROM users WHERE role='admin' LIMIT 1), ?)""",
            (profile["id"], encrypt(tokens["access_token"]), encrypt(tokens["refresh_token"]),
             tokens["scope"], expires_at, now()),
        )
        write_audit_log(conn, None, "spotify_connected", metadata={"spotify_user_id": profile["id"]})
        conn.commit()

    # This runs in the OS browser (see SpotifyPanel.tsx / main.js openExternal),
    # not inside the Electron window — there's no localhost:3000 to redirect
    # to in a packaged app, so just confirm and tell the user to tab back.
    return HTMLResponse("""
        <html><body style="font-family: system-ui; background:#14151A; color:#EDEDF2;
        display:flex; align-items:center; justify-content:center; height:100vh; margin:0;">
          <div style="text-align:center;">
            <h2>Spotify connected</h2>
            <p style="color:#8B8D98;">You can close this tab and go back to the app.</p>
          </div>
        </body></html>
    """)


@router.get("/devices")
async def list_devices(admin: dict = Depends(require_admin)):
    from .. import spotify_client
    try:
        token = await spotify_client._get_access_token()
    except Exception as e:
        logger.info(f"No active Spotify access token: {e}")
        return []

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                "https://api.spotify.com/v1/me/player/devices",
                headers={"Authorization": f"Bearer {token}"},
                timeout=5.0,
            )
            resp.raise_for_status()
        devices = resp.json().get("devices", [])
    except Exception as e:
        logger.warning(f"Error fetching Spotify devices: {e}")
        return []

    with get_db() as conn:
        target_row = conn.execute("SELECT spotify_device_id FROM playback_devices WHERE is_target = 1").fetchone()
        target_id = target_row["spotify_device_id"] if target_row else None

        for d in devices:
            conn.execute(
                """INSERT INTO playback_devices (spotify_device_id, name, last_seen_at)
                   VALUES (?, ?, ?)
                   ON CONFLICT DO NOTHING""",
                (d["id"], d["name"], now()),
            )
            if target_id and d["id"] == target_id:
                d["is_target"] = True
            else:
                d["is_target"] = False
        conn.commit()
    return devices


@router.post("/devices/{device_id}/select")
def select_target_device(device_id: str, admin: dict = Depends(require_admin)):
    with get_db() as conn:
        conn.execute("UPDATE playback_devices SET is_target = 0")
        conn.execute(
            "UPDATE playback_devices SET is_target = 1, last_seen_at = ? WHERE spotify_device_id = ?",
            (now(), device_id),
        )
        write_audit_log(conn, admin["id"], "target_device_selected", metadata={"device_id": device_id})
        conn.commit()
    return {"ok": True}
