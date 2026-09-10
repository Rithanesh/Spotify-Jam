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
    """Songs added by day, for the logged-in user."""
    with get_db() as conn:
        rows = conn.execute(
            """SELECT date(created_at) AS day, 
                      COUNT(*) AS count,
                      json_group_array(json_extract(metadata_json, '$.track_name')) AS track_names
               FROM audit_log
               WHERE user_id = ? AND action = 'song_added'
               GROUP BY day ORDER BY day DESC""",
            (user["id"],),
        ).fetchall()
    
    result = []
    import json
    for r in rows:
        d = dict(r)
        d["track_names"] = json.loads(d["track_names"]) if d["track_names"] else []
        result.append(d)
    return result


@router.get("/dashboard/admin")
def admin_dashboard(admin: dict = Depends(require_admin)):
    """Per-user split, date-wise — admin's view across everyone."""
    with get_db() as conn:
        rows = conn.execute(
            """SELECT u.username, 
                      date(a.created_at) AS day, 
                      COUNT(*) AS count,
                      json_group_array(json_extract(a.metadata_json, '$.track_name')) AS track_names
               FROM audit_log a JOIN users u ON u.id = a.user_id
               WHERE a.action = 'song_added'
               GROUP BY u.username, day ORDER BY day DESC, u.username"""
        ).fetchall()

    result = []
    import json
    for r in rows:
        d = dict(r)
        d["track_names"] = json.loads(d["track_names"]) if d["track_names"] else []
        result.append(d)
    return result


@router.get("/dashboard/stats")
def dashboard_stats(admin: dict = Depends(require_admin)):
    """Admin only: overall stats for charts and top tracks."""
    with get_db() as conn:
        top_users = conn.execute(
            """SELECT u.username, COUNT(*) as count 
               FROM audit_log a JOIN users u ON u.id = a.user_id 
               WHERE a.action = 'song_added' 
               GROUP BY u.id ORDER BY count DESC"""
        ).fetchall()

        def get_repeated(days: int):
            return conn.execute(
                f"""SELECT json_extract(metadata_json, '$.track_name') as track_name,
                          COUNT(*) as count
                   FROM audit_log
                   WHERE action = 'song_added' AND created_at >= datetime('now', '-{days} days')
                   GROUP BY track_name
                   ORDER BY count DESC
                   LIMIT 5"""
            ).fetchall()

        return {
            "top_users": [dict(r) for r in top_users],
            "repeated": {
                "day": [dict(r) for r in get_repeated(1)],
                "week": [dict(r) for r in get_repeated(7)],
                "month": [dict(r) for r in get_repeated(30)]
            }
        }


@router.get("/export")
def export_logs(admin: dict = Depends(require_admin)):
    """Zip the whole log directory and hand back a downloadable file —
    matches 'export logs' from the brief."""
    tmp_dir = Path(tempfile.mkdtemp())
    archive_path = tmp_dir / "spotify-jam-logs"
    shutil.make_archive(str(archive_path), "zip", LOG_DIR)
    return FileResponse(str(archive_path) + ".zip", filename="spotify-jam-logs.zip")
