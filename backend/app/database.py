import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .config import DB_PATH

SCHEMA_FILE = Path(__file__).parent / "schema.sql"


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn


# One shared connection is fine for SQLite at this scale (single desktop
# app, low concurrency); FastAPI still awaits handlers, DB calls are quick.
_conn = _connect()


def init_db() -> None:
    with open(SCHEMA_FILE, "r") as f:
        _conn.executescript(f.read())
    _conn.commit()
    _run_light_migrations()


def _run_light_migrations() -> None:
    """CREATE TABLE IF NOT EXISTS won't add a column to a table that
    already existed from an earlier run — cover that here instead of
    asking anyone testing this early to delete their DB by hand."""
    cols = {row["name"] for row in _conn.execute("PRAGMA table_info(users)").fetchall()}
    if "must_change_password" not in cols:
        _conn.execute("ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT 0")
        _conn.commit()

    if "last_seen_at" not in cols:
        _conn.execute("ALTER TABLE users ADD COLUMN last_seen_at TEXT")
        _conn.commit()

    _conn.execute(
        """
        INSERT OR IGNORE INTO app_settings (key, value, updated_at)
        VALUES ('shareable_url', 'http://app.spotify.com:9000', datetime('now'))
        """
    )
    _conn.commit()

    legacy_admin_hash = "$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW"
    row = _conn.execute("SELECT id FROM users WHERE password_hash = ?", (legacy_admin_hash,)).fetchone()
    if row:
        from .security import hash_password
        _conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password("admin"), row["id"]))
        _conn.commit()


@contextmanager
def get_db():
    try:
        yield _conn
    finally:
        pass  # shared connection — nothing to close per-request


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_audit_log(
    conn: sqlite3.Connection,
    user_id: int | None,
    action: str,
    entity_type: str | None = None,
    entity_id: int | None = None,
    metadata: dict | None = None,
    ip_address: str | None = None,
) -> None:
    """Every add/update/delete/login/toggle event goes through here —
    single source of truth for both the dashboards and log export."""
    conn.execute(
        """INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata_json, ip_address, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (user_id, action, entity_type, entity_id, json.dumps(metadata or {}), ip_address, now()),
    )
    conn.commit()
