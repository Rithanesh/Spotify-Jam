"""
Two recurring jobs:
  1. push_next_if_needed — every few seconds, push the next pending song
     to Spotify's real queue once the current one's about to finish.
  2. cleanup_old_logs — daily, delete queue_items/audit_log rows older
     than the retention window (default 60 days, app_settings-configurable)
     so the SQLite file — and the app — stay light over time.
"""
import asyncio
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from .database import get_db, now
from .queue_engine import push_next_if_needed

logger = logging.getLogger("spotify-jam-app.scheduler")


def cleanup_old_logs():
    with get_db() as conn:
        retention_row = conn.execute(
            "SELECT value FROM app_settings WHERE key = 'queue_log_retention_days'"
        ).fetchone()
        retention_days = int(retention_row["value"]) if retention_row else 60

        cutoff = conn.execute(
            "SELECT datetime('now', ? ) AS cutoff", (f"-{retention_days} days",)
        ).fetchone()["cutoff"]

        deleted_audit = conn.execute(
            "DELETE FROM audit_log WHERE created_at < ?", (cutoff,)
        ).rowcount
        deleted_queue = conn.execute(
            "DELETE FROM queue_items WHERE status IN ('played','removed','skipped') AND added_at < ?",
            (cutoff,),
        ).rowcount
        conn.commit()
        # keep DB file compact after a bulk delete
        conn.execute("VACUUM")

    logger.info(
        "log cleanup: removed %d audit_log rows and %d queue_items rows older than %d days",
        deleted_audit, deleted_queue, retention_days,
    )


async def _push_loop_tick():
    try:
        await push_next_if_needed()
    except Exception:
        logger.exception("push_next_if_needed failed")


def start_scheduler() -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler()
    scheduler.add_job(_push_loop_tick, "interval", seconds=5, id="push_next_song")
    scheduler.add_job(cleanup_old_logs, "cron", hour=3, minute=0, id="cleanup_old_logs")  # daily at 3am
    scheduler.start()
    return scheduler
