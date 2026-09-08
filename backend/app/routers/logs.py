import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse

from ..config import LOG_DIR
from ..database import get_db
from ..deps import get_current_user, require_admin

router = APIRouter(prefix="/api/logs", tags=["logs"])


@router.get("/dashboard/me")
def my_dashboard(user: dict = Depends(get_current_user)):
    """Songs added by day, for the logged-in user — 'how many songs he
    has requested' from the brief."""
    with get_db() as conn:
        rows = conn.execute(
            """SELECT date(created_at) AS day, COUNT(*) AS count
               FROM audit_log
               WHERE user_id = ? AND action = 'song_added'
               GROUP BY day ORDER BY day DESC""",
            (user["id"],),
        ).fetchall()
    return [dict(r) for r in rows]


@router.get("/dashboard/admin")
def admin_dashboard(admin: dict = Depends(require_admin)):
    """Per-user split, date-wise — admin's view across everyone."""
    with get_db() as conn:
        rows = conn.execute(
            """SELECT u.username, date(a.created_at) AS day, COUNT(*) AS count
               FROM audit_log a JOIN users u ON u.id = a.user_id
               WHERE a.action = 'song_added'
               GROUP BY u.username, day ORDER BY day DESC, u.username"""
        ).fetchall()
    return [dict(r) for r in rows]


@router.get("/export")
def export_logs(admin: dict = Depends(require_admin)):
    """Zip the whole log directory and hand back a downloadable file —
    matches 'export logs' from the brief."""
    tmp_dir = Path(tempfile.mkdtemp())
    archive_path = tmp_dir / "spotify-jam-logs"
    shutil.make_archive(str(archive_path), "zip", LOG_DIR)
    return FileResponse(str(archive_path) + ".zip", filename="spotify-jam-logs.zip")
