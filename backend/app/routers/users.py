import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..database import get_db, now, write_audit_log
from ..deps import get_current_user, require_admin
from ..security import hash_password

router = APIRouter(prefix="/api/users", tags=["users"])


class CreateInviteRequest(BaseModel):
    role: str = "member"
    expires_in_hours: int | None = 72


@router.post("/invites")
def create_invite(body: CreateInviteRequest, admin: dict = Depends(require_admin)):
    code = secrets.token_urlsafe(9)  # shown once to the admin to hand out
    expires_at = None
    if body.expires_in_hours:
        from datetime import datetime, timedelta, timezone
        expires_at = (datetime.now(timezone.utc) + timedelta(hours=body.expires_in_hours)).isoformat()

    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO invites (code_hash, role, created_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
            (hash_password(code), body.role, admin["id"], expires_at, now()),
        )
        write_audit_log(conn, admin["id"], "invite_created", entity_type="invite", entity_id=cur.lastrowid)
        conn.commit()

    return {"invite_code": code, "expires_at": expires_at}


@router.get("")
def list_users(admin: dict = Depends(require_admin)):
    """
    Returns full user list with real-time connection status (seen in last 5 minutes),
    as well as aggregate summary counts for the admin dashboard.
    """
    from datetime import datetime, timedelta, timezone

    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()

    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT id, username, role, display_name, is_active, created_at, last_login_at, last_seen_at
            FROM users
            ORDER BY created_at
            """
        ).fetchall()

    user_list = []
    connected_count = 0
    active_count = 0

    for r in rows:
        d = dict(r)
        last_seen = d.get("last_seen_at") or d.get("last_login_at")
        is_online = bool(last_seen and last_seen >= cutoff and d.get("is_active", 1) == 1)
        d["is_connected"] = is_online
        if is_online:
            connected_count += 1
        if d.get("is_active", 1) == 1:
            active_count += 1
        user_list.append(d)

    return {
        "stats": {
            "total_users": len(user_list),
            "connected_users": connected_count,
            "active_users": active_count,
        },
        "users": user_list,
    }


class ResetPasswordRequest(BaseModel):
    new_password: str | None = None  # if empty, will set must_change_password=1 with temporary password


@router.patch("/{user_id}/reset-password")
def reset_user_password(user_id: int, body: ResetPasswordRequest, admin: dict = Depends(require_admin)):
    """
    Admin can reset the password for any user so they can log back in
    or enter a new password if they forget it.
    """
    if body.new_password and body.new_password.strip():
        temp_pass = body.new_password.strip()
    else:
        temp_pass = secrets.token_urlsafe(6)

    if len(temp_pass) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")

    with get_db() as conn:
        user = conn.execute("SELECT id, username FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        # Set new password and mark must_change_password so user can re-enter their own password on login
        conn.execute(
            "UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?",
            (hash_password(temp_pass), user_id),
        )
        # Revoke existing sessions so old logins cannot persist
        conn.execute("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", (now(), user_id))
        write_audit_log(conn, admin["id"], "user_password_reset_by_admin", entity_type="user", entity_id=user_id)
        conn.commit()

    return {
        "status": "ok",
        "user_id": user_id,
        "username": user["username"],
        "temp_password": temp_pass,
        "must_change_password": True,
    }


@router.patch("/{user_id}/activate")
def activate_user(user_id: int, admin: dict = Depends(require_admin)):
    with get_db() as conn:
        conn.execute("UPDATE users SET is_active = 1 WHERE id = ?", (user_id,))
        write_audit_log(conn, admin["id"], "user_activated", entity_type="user", entity_id=user_id)
        conn.commit()
    return {"ok": True}


@router.patch("/{user_id}/deactivate")
def deactivate_user(user_id: int, admin: dict = Depends(require_admin)):
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Cannot deactivate the currently logged-in admin account")

    with get_db() as conn:
        conn.execute("UPDATE users SET is_active = 0 WHERE id = ?", (user_id,))
        conn.execute("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", (now(), user_id))
        write_audit_log(conn, admin["id"], "user_deactivated", entity_type="user", entity_id=user_id)
        conn.commit()
    return {"ok": True}


@router.delete("/{user_id}")
def delete_user(user_id: int, admin: dict = Depends(require_admin)):
    """
    Permanently delete a user account.
    Only deactivated accounts can be deleted to prevent accidental deletions.
    Admins cannot delete their own account.
    """
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own admin account")

    with get_db() as conn:
        user = conn.execute("SELECT id, username, role, is_active FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        if user["is_active"] == 1:
            raise HTTPException(
                status_code=400,
                detail="User account must be deactivated before it can be permanently deleted. Please click Deactivate first."
            )

        # Nullify or clean up referencing foreign keys so deletion succeeds cleanly
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        conn.execute("UPDATE invites SET used_by = NULL WHERE used_by = ?", (user_id,))
        conn.execute("UPDATE invites SET created_by = ? WHERE created_by = ?", (admin["id"], user_id))
        conn.execute("UPDATE queue_items SET added_by = ? WHERE added_by = ?", (admin["id"], user_id))
        conn.execute("UPDATE app_settings SET updated_by = ? WHERE updated_by = ?", (admin["id"], user_id))
        conn.execute("UPDATE spotify_account SET connected_by = ? WHERE connected_by = ?", (admin["id"], user_id))
        conn.execute("UPDATE audit_log SET user_id = NULL WHERE user_id = ?", (user_id,))

        # Delete user record
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        write_audit_log(
            conn,
            admin["id"],
            "user_deleted",
            entity_type="user",
            entity_id=user_id,
            metadata={"deleted_username": user["username"]},
        )
        conn.commit()

    return {"ok": True, "deleted_username": user["username"]}

