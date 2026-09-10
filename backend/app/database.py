import json
import sqlite3
import sys
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .config import DB_PATH


def _resolve_data_path(relative: str) -> Path:
    """Resolve a bundled data file path that works both in development and
    inside a PyInstaller --onefile build.  In a frozen build, data files
    specified via --add-data are extracted to sys._MEIPASS; in dev they
    sit next to the source files."""
    if getattr(sys, "frozen", False):
        base = Path(sys._MEIPASS)
    else:
        base = Path(__file__).parent
    return base / relative


SCHEMA_FILE = _resolve_data_path("app" if getattr(sys, "frozen", False) else "") / "schema.sql"


import threading

_local = threading.local()

def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 30000")
    conn.execute("PRAGMA synchronous = NORMAL")
    return conn

def _get_connection() -> sqlite3.Connection:
    if not hasattr(_local, "conn") or _local.conn is None:
        _local.conn = _connect()
    return _local.conn


def init_db() -> None:
    conn = _get_connection()
    with open(SCHEMA_FILE, "r") as f:
        conn.executescript(f.read())
    conn.commit()
    _run_light_migrations()


def _run_light_migrations() -> None:
    """Run sequential migrations tracked by app_version table to safely
    update existing databases on app upgrade without erasing data."""
    conn = _get_connection()
    conn.execute("CREATE TABLE IF NOT EXISTS app_version (version INTEGER PRIMARY KEY)")
    row = conn.execute("SELECT MAX(version) as v FROM app_version").fetchone()
    current_version = row["v"] if row and row["v"] is not None else 0

    if current_version < 1:
        cols = {row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "must_change_password" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT 0")
        if "last_seen_at" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN last_seen_at TEXT")

        conn.execute(
            """
            INSERT OR IGNORE INTO app_settings (key, value, updated_at)
            VALUES ('shareable_url', 'http://app.spotify.com:9000', datetime('now'))
            """
        )
        legacy_admin_hash = "$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW"
        admin_row = conn.execute("SELECT id FROM users WHERE password_hash = ?", (legacy_admin_hash,)).fetchone()
        if admin_row:
            from .security import hash_password
            conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password("admin"), admin_row["id"]))
        
        conn.execute("INSERT INTO app_version (version) VALUES (1)")
        conn.commit()

    if current_version < 2:
        cols = {row["name"] for row in conn.execute("PRAGMA table_info(queue_items)").fetchall()}
        if "album_art_url" not in cols:
            conn.execute("ALTER TABLE queue_items ADD COLUMN album_art_url TEXT")
        conn.execute("INSERT INTO app_version (version) VALUES (2)")
        conn.commit()


@contextmanager
def get_db():
    conn = _get_connection()
    try:
        yield conn
    finally:
        pass


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
