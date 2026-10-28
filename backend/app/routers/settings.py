import re
import socket
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..config import SPOTIFY_REDIRECT_URI
from ..database import get_db, now, write_audit_log
from ..deps import get_current_user, require_admin
from ..spotify_helpers import get_lan_ip, get_spotify_credentials, save_spotify_credentials
from ..mdns import start_mdns, stop_mdns

router = APIRouter(prefix="/api/settings", tags=["settings"])


class ToggleDiscoverableRequest(BaseModel):
    enabled: bool


class ThemeRequest(BaseModel):
    mode: str          # 'light' | 'dark' | 'custom'
    accent: str | None = None  # hex, only used when mode == 'custom' (or to recolor light/dark accents)


class SpotifyCredentialsRequest(BaseModel):
    client_id: str
    client_secret: str


class ShareableUrlRequest(BaseModel):
    url: str


def check_host_status(url: str, lan_ip: str) -> dict:
    """Check whether the host in the URL resolves to the local machine or an external IP."""
    normalized = url if "://" in url else f"http://{url}"
    try:
        parsed = urlparse(normalized)
        hostname = parsed.hostname or "127.0.0.1"
    except Exception:
        hostname = "127.0.0.1"

    try:
        resolved_ip = socket.gethostbyname(hostname)
        is_local = resolved_ip in ("127.0.0.1", "::1", "localhost", lan_ip)
        return {
            "hostname": hostname,
            "resolved_ip": resolved_ip,
            "is_local": is_local,
        }
    except Exception as e:
        return {
            "hostname": hostname,
            "resolved_ip": None,
            "is_local": False,
            "error": str(e),
        }


@router.get("")
def get_settings(user: dict = Depends(get_current_user)):
    with get_db() as conn:
        rows = conn.execute("SELECT key, value FROM app_settings").fetchall()
    settings = {r["key"]: r["value"] for r in rows}

    lan_ip = get_lan_ip()
    lan_port = settings.get("lan_port", "9000")
    shareable_url = settings.get("shareable_url")

    # Migrate legacy app.spotify.com or missing shareable_url to guaranteed LAN IP
    if not shareable_url or "app.spotify.com" in shareable_url:
        shareable_url = f"http://{lan_ip}:{lan_port}"
        with get_db() as conn:
            conn.execute("UPDATE app_settings SET value = ? WHERE key = 'shareable_url'", (shareable_url,))
            conn.commit()
    else:
        try:
            parsed = urlparse(shareable_url)
            host = parsed.hostname
            if host and re.match(r"^\d{1,3}(\.\d{1,3}){3}$", host) and host not in ("127.0.0.1", lan_ip):
                new_url = f"{parsed.scheme}://{lan_ip}:{parsed.port or lan_port}{parsed.path}"
                with get_db() as conn:
                    conn.execute("UPDATE app_settings SET value = ? WHERE key = 'shareable_url'", (new_url,))
                    conn.commit()
                shareable_url = new_url
        except Exception:
            pass

    client_id, client_secret = get_spotify_credentials()

    # Never send the plain client secret over the wire
    settings.pop("spotify_client_secret", None)

    host_status = check_host_status(shareable_url, lan_ip)

    raw_hostname = socket.gethostname()
    bonjour_host = raw_hostname if raw_hostname.endswith(".local") else f"{raw_hostname}.local"

    settings.update({
        "lan_ip": lan_ip,
        "lan_url": shareable_url,
        "shareable_url": shareable_url,
        "lan_ip_url": f"http://{lan_ip}:{lan_port}",
        "bonjour_host": bonjour_host,
        "bonjour_url": f"http://{bonjour_host}:{lan_port}",
        "spotify_client_id": client_id,
        "has_spotify_secret": bool(client_secret),
        "spotify_redirect_uri": SPOTIFY_REDIRECT_URI,
        "host_status": host_status,
    })
    return settings


@router.patch("/discoverable")
async def toggle_discoverable(body: ToggleDiscoverableRequest, admin: dict = Depends(require_admin)):
    value = "true" if body.enabled else "false"
    with get_db() as conn:
        conn.execute(
            "UPDATE app_settings SET value = ?, updated_at = ?, updated_by = ? WHERE key = 'discoverable_on_network'",
            (value, now(), admin["id"]),
        )
        write_audit_log(conn, admin["id"], "discoverable_toggled", metadata={"enabled": body.enabled})
        conn.commit()
    
    if body.enabled:
        await stop_mdns()
        await start_mdns()
    else:
        await stop_mdns()

    return {"discoverable_on_network": body.enabled}


@router.patch("/shareable-url")
async def update_shareable_url(body: ShareableUrlRequest, admin: dict = Depends(require_admin)):
    url = body.url.strip() or "http://app.spotify.com:9000"
    if not url.startswith("http://") and not url.startswith("https://"):
        url = f"http://{url}"

    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO app_settings (key, value, updated_at, updated_by)
            VALUES ('shareable_url', ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at,
                updated_by = excluded.updated_by
            """,
            (url, now(), admin["id"]),
        )
        write_audit_log(conn, admin["id"], "shareable_url_updated", metadata={"url": url})
        conn.commit()

    lan_ip = get_lan_ip()
    host_status = check_host_status(url, lan_ip)

    # Refresh mDNS advertisement if currently discoverable
    with get_db() as conn:
        disc_row = conn.execute(
            "SELECT value FROM app_settings WHERE key = 'discoverable_on_network'"
        ).fetchone()
        if disc_row and disc_row["value"] == "true":
            await stop_mdns()
            await start_mdns()

    return {
        "shareable_url": url,
        "lan_url": url,
        "host_status": host_status,
    }


@router.post("/spotify-credentials")
def update_spotify_credentials(body: SpotifyCredentialsRequest, admin: dict = Depends(require_admin)):
    client_id = body.client_id.strip()
    client_secret = body.client_secret.strip()
    if not client_id or not client_secret:
        raise HTTPException(status_code=400, detail="Both Client ID and Client Secret are required")

    save_spotify_credentials(admin["id"], client_id, client_secret)
    return {
        "status": "ok",
        "spotify_client_id": client_id,
        "has_spotify_secret": True,
    }


@router.patch("/theme")
def set_theme(body: ThemeRequest, user: dict = Depends(get_current_user)):
    """Any user can set their own theme preference client-side; this
    endpoint persists the *device/app-wide* default so it survives restarts.
    Frontend still lets each browser/tab override locally if it wants."""
    with get_db() as conn:
        conn.execute(
            "UPDATE app_settings SET value = ?, updated_at = ?, updated_by = ? WHERE key = 'theme_mode'",
            (body.mode, now(), user["id"]),
        )
        if body.accent:
            conn.execute(
                "UPDATE app_settings SET value = ?, updated_at = ?, updated_by = ? WHERE key = 'theme_accent'",
                (body.accent, now(), user["id"]),
            )
        conn.commit()
    return {"mode": body.mode, "accent": body.accent}
