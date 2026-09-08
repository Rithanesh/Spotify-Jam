from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from jose import jwt
from pydantic import BaseModel

from ..config import ACCESS_TOKEN_EXPIRE_MINUTES, JWT_ALGORITHM, REFRESH_TOKEN_EXPIRE_DAYS
from ..database import get_db, now, write_audit_log
from ..deps import get_current_user, require_discoverable_for_lan
from ..security import get_jwt_secret, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    name: str
    username: str
    password: str


class RedeemInviteRequest(BaseModel):
    invite_code: str
    username: str
    password: str
    display_name: str | None = None


def _make_access_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": str(user_id), "exp": expire}, get_jwt_secret(), algorithm=JWT_ALGORITHM)


@router.post("/login", dependencies=[Depends(require_discoverable_for_lan)])
def login(body: LoginRequest, request: Request):
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE username = ? AND is_active = 1", (body.username,)
        ).fetchone()
        if row is None or not verify_password(body.password, row["password_hash"]):
            raise HTTPException(status_code=401, detail="Incorrect username or password")

        conn.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (now(), row["id"]))
        conn.commit()

        source = "lan_web" if (request.client and request.client.host not in ("127.0.0.1", "::1")) else "desktop"
        write_audit_log(conn, row["id"], "login", ip_address=request.client.host if request.client else None)

    token = _make_access_token(row["id"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": row["id"], "username": row["username"], "role": row["role"], "display_name": row["display_name"]},
        "must_change_password": bool(row["must_change_password"]),
    }


@router.post("/logout")
def logout(user: dict = Depends(get_current_user)):
    """
    Explicit sign-out: clears last_seen_at so the admin instantly sees
    the user change to Offline without waiting for the timeout.
    """
    with get_db() as conn:
        conn.execute("UPDATE users SET last_seen_at = NULL WHERE id = ?", (user["id"],))
        conn.execute("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", (now(), user["id"]))
        write_audit_log(conn, user["id"], "logout", entity_type="user", entity_id=user["id"])
        conn.commit()
    return {"ok": True}


@router.post("/register", dependencies=[Depends(require_discoverable_for_lan)])
def register(body: RegisterRequest, request: Request):
    """
    Direct self-registration for users opening the shareable web link.
    Asks for name, username, and password.
    """
    name = body.name.strip()
    username = body.username.strip().lower()
    password = body.password

    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    if not username:
        raise HTTPException(status_code=400, detail="Username is required")
    if len(password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")

    with get_db() as conn:
        existing = conn.execute("SELECT id FROM users WHERE LOWER(username) = ?", (username,)).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="Username is already taken")

        cur = conn.execute(
            """INSERT INTO users (username, password_hash, role, display_name, created_at)
               VALUES (?, ?, 'member', ?, ?)""",
            (username, hash_password(password), name, now()),
        )
        user_id = cur.lastrowid
        write_audit_log(
            conn,
            user_id,
            "user_registered",
            entity_type="user",
            entity_id=user_id,
            ip_address=request.client.host if request.client else None,
        )
        conn.commit()

    token = _make_access_token(user_id)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user_id,
            "username": username,
            "role": "member",
            "display_name": name,
        },
        "must_change_password": False,
    }


@router.post("/redeem-invite", dependencies=[Depends(require_discoverable_for_lan)])
def redeem_invite(body: RedeemInviteRequest, request: Request):
    """Members set up their own account from an admin-issued invite code —
    the admin never has to type a password on someone else's behalf."""
    from ..security import hash_password as _hash  # local import avoids unused-warning confusion above

    with get_db() as conn:
        invites = conn.execute(
            "SELECT * FROM invites WHERE used_by IS NULL"
        ).fetchall()
        matched = None
        for inv in invites:
            if verify_password(body.invite_code, inv["code_hash"]):
                matched = inv
                break
        if matched is None:
            raise HTTPException(status_code=400, detail="Invalid or already-used invite code")
        if matched["expires_at"] and matched["expires_at"] < now():
            raise HTTPException(status_code=400, detail="This invite code has expired")

        existing = conn.execute("SELECT id FROM users WHERE username = ?", (body.username,)).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="Username already taken")

        cur = conn.execute(
            """INSERT INTO users (username, password_hash, role, display_name, created_by, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (body.username, _hash(body.password), matched["role"], body.display_name or body.username,
             matched["created_by"], now()),
        )
        user_id = cur.lastrowid
        conn.execute(
            "UPDATE invites SET used_by = ?, used_at = ? WHERE id = ?", (user_id, now(), matched["id"])
        )
        write_audit_log(conn, user_id, "user_created", entity_type="user", entity_id=user_id)
        conn.commit()

    token = _make_access_token(user_id)
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me")
def me(user: dict = Depends(get_current_user)):
    return {
        "id": user["id"], "username": user["username"], "role": user["role"],
        "display_name": user["display_name"], "must_change_password": bool(user["must_change_password"]),
    }


class ChangePasswordRequest(BaseModel):
    new_password: str


@router.patch("/change-password")
def change_password(body: ChangePasswordRequest, user: dict = Depends(get_current_user)):
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if body.new_password == "admin":
        raise HTTPException(status_code=400, detail="Choose something other than the default password")
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?",
            (hash_password(body.new_password), user["id"]),
        )
        write_audit_log(conn, user["id"], "password_changed", entity_type="user", entity_id=user["id"])
        conn.commit()
    return {"ok": True}
