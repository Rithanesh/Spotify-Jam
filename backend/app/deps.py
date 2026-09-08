from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from .config import JWT_ALGORITHM
from .database import get_db
from .security import get_jwt_secret

bearer_scheme = HTTPBearer(auto_error=False)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def get_current_user(creds: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    if creds is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(creds.credentials)
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE id = ? AND is_active = 1", (payload["sub"],)
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=401, detail="User not found or deactivated")
        
        # Only write to SQLite if last_seen_at is older than 30 seconds
        now_dt = datetime.now(timezone.utc)
        last_seen = row["last_seen_at"]
        should_update = True
        if last_seen:
            try:
                prev_dt = datetime.fromisoformat(last_seen)
                if (now_dt - prev_dt).total_seconds() < 30:
                    should_update = False
            except Exception:
                pass
        if should_update:
            conn.execute("UPDATE users SET last_seen_at = ? WHERE id = ?", (now_dt.isoformat(), row["id"]))
            conn.commit()
    return dict(row)


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def require_discoverable_for_lan(request: Request):
    """
    Gate for any route reachable from the LAN-bound listener. Requests
    coming in on the loopback-only Electron UI connection are always fine;
    requests arriving via the LAN port are only allowed while the admin's
    "discoverable on network" toggle is on. This is checked per-request
    (not just at socket-bind time) so flipping the toggle takes effect
    immediately without restarting anything.
    """
    with get_db() as conn:
        row = conn.execute(
            "SELECT value FROM app_settings WHERE key = 'discoverable_on_network'"
        ).fetchone()
    is_discoverable = row and row["value"] == "true"

    client_host = request.client.host if request.client else ""
    is_loopback = client_host in ("127.0.0.1", "::1", "localhost")

    if not is_loopback and not is_discoverable:
        raise HTTPException(status_code=403, detail="Network access is currently disabled by the admin")
