#!/usr/bin/env python3
"""
Flushes user data, sessions, invites, queue items, playback device cache,
and audit logs before packaging the app into a production binary/installer.
Resets the admin account to default (admin / admin with must_change_password=1)
and clears playback data so the distributed build is clean for any user.
"""
import os
import sqlite3
from pathlib import Path

APP_DATA_DIR = Path(os.environ.get("APP_DATA_DIR", Path.home() / ".spotify-jam-app"))
DB_PATH = APP_DATA_DIR / "app.db"

# Also check workspace local database if any exists
LOCAL_DB_PATH = Path(__file__).resolve().parents[1] / "backend" / "app.db"

TARGET_DBS = [p for p in (DB_PATH, LOCAL_DB_PATH) if p.exists()]

def clean_database(db_path: Path):
    print(f"[*] Flushing application database at: {db_path}")
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = OFF")

    # Check existing tables in this database file
    existing_tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    if not existing_tables:
        conn.close()
        try:
            db_path.unlink()
        except Exception:
            pass
        print(f"[-] Removed empty database file: {db_path}")
        return

    # 1. Clear playback and queue items
    if "queue_items" in existing_tables:
        conn.execute("DELETE FROM queue_items")
    if "playback_devices" in existing_tables:
        conn.execute("DELETE FROM playback_devices")
    if "spotify_account" in existing_tables:
        conn.execute("DELETE FROM spotify_account")

    # 2. Clear sessions, invites, and audit logs
    if "sessions" in existing_tables:
        conn.execute("DELETE FROM sessions")
    if "invites" in existing_tables:
        conn.execute("DELETE FROM invites")
    if "audit_log" in existing_tables:
        conn.execute("DELETE FROM audit_log")

    # 3. Clear non-admin users
    if "users" in existing_tables:
        conn.execute("DELETE FROM users WHERE role != 'admin' OR username != 'admin'")

    # 4. Reset admin account to initial clean state (admin / admin, force password change)
    # sha256 of 'admin' using project's hash_password logic
    # Import passlib / hashlib if available, or compute PBKDF2 / standard bcrypt
    try:
        from argon2 import PasswordHasher
        hasher = PasswordHasher()
        admin_hash = hasher.hash("admin")
    except Exception:
        # Fallback to known pre-computed Argon2id hash for 'admin'
        admin_hash = "$argon2id$v=19$m=65536,t=3,p=4$lC7HG08Ouf2WMAQGbRrfoQ$mqbCA7XsHAnueL9nyKZGIlIq1zTDWNAfPD2P42o75yI"

    admin_exists = conn.execute("SELECT id FROM users WHERE username = 'admin'").fetchone()
    if admin_exists:
        conn.execute(
            """
            UPDATE users SET
                password_hash = ?,
                must_change_password = 1,
                last_login_at = NULL,
                last_seen_at = NULL,
                display_name = 'Admin'
            WHERE username = 'admin'
            """,
            (admin_hash,),
        )
    else:
        conn.execute(
            """
            INSERT INTO users (username, password_hash, role, display_name, must_change_password, created_at)
            VALUES ('admin', ?, 'admin', 'Admin', 1, datetime('now'))
            """,
            (admin_hash,),
        )

    # 5. Reset app settings updated_by and sensitive tokens
    conn.execute("UPDATE app_settings SET updated_by = NULL")
    conn.execute("DELETE FROM app_settings WHERE key LIKE '%spotify_token%' OR key = 'spotify_client_secret'")

    conn.execute("PRAGMA foreign_keys = ON")
    conn.commit()
    conn.execute("VACUUM")
    conn.close()
    print(f"[✓] Database {db_path.name} clean: Users and playback queue flushed.")

def main():
    if not TARGET_DBS:
        print("[!] No existing app database found to flush (clean slate).")
        return

    for db_path in TARGET_DBS:
        clean_database(db_path)

if __name__ == "__main__":
    main()
