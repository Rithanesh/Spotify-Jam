"""
Spotify credentials helper. Dynamically reads credentials from `app_settings`
(configured via the UI by the admin), falling back to environment variables.
"""
import base64
import socket
from .config import SPOTIFY_CLIENT_ID as ENV_CLIENT_ID, SPOTIFY_CLIENT_SECRET as ENV_CLIENT_SECRET, SPOTIFY_REDIRECT_URI
from .database import get_db, now, write_audit_log
from .security import encrypt, decrypt


def get_spotify_credentials() -> tuple[str, str]:
    """
    Returns (client_id, client_secret).
    Checks SQLite app_settings first, then falls back to environment variables.
    """
    with get_db() as conn:
        rows = conn.execute(
            "SELECT key, value FROM app_settings WHERE key IN ('spotify_client_id', 'spotify_client_secret')"
        ).fetchall()
        settings = {r["key"]: r["value"] for r in rows}

    client_id = settings.get("spotify_client_id") or ENV_CLIENT_ID or ""
    client_secret_raw = settings.get("spotify_client_secret") or ""

    if client_secret_raw:
        try:
            raw_bytes = base64.b64decode(client_secret_raw.encode("ascii"))
            client_secret = decrypt(raw_bytes)
        except Exception:
            client_secret = client_secret_raw
    else:
        client_secret = ENV_CLIENT_SECRET or ""

    return client_id.strip(), client_secret.strip()


def save_spotify_credentials(admin_id: int, client_id: str, client_secret: str):
    """
    Saves encrypted Spotify credentials into app_settings and records an audit log.
    """
    client_id = client_id.strip()
    client_secret = client_secret.strip()

    secret_enc = encrypt(client_secret)
    secret_b64 = base64.b64encode(secret_enc).decode("ascii")

    with get_db() as conn:
        for key, val in [("spotify_client_id", client_id), ("spotify_client_secret", secret_b64)]:
            conn.execute(
                """
                INSERT INTO app_settings (key, value, updated_at, updated_by)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at,
                    updated_by = excluded.updated_by
                """,
                (key, val, now(), admin_id),
            )
        write_audit_log(conn, admin_id, "spotify_credentials_updated", metadata={"client_id": client_id})
        conn.commit()


def get_lan_ip() -> str:
    """
    Detect the machine's local LAN IP address.
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
    except Exception:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip
