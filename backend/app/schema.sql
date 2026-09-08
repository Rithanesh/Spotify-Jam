-- Spotify Jam Desktop App — SQLite schema
-- Mirrors docs/db-schema.md. Applied once on first launch (see database.py).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('admin', 'member')),
    display_name    TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT 1,
    must_change_password BOOLEAN NOT NULL DEFAULT 0,
    created_by      INTEGER REFERENCES users(id),
    created_at      TEXT NOT NULL,
    last_login_at   TEXT
);

CREATE TABLE IF NOT EXISTS invites (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    code_hash       TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'member',
    created_by      INTEGER NOT NULL REFERENCES users(id),
    expires_at      TEXT,
    used_by         INTEGER REFERENCES users(id),
    used_at         TEXT,
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id              INTEGER NOT NULL REFERENCES users(id),
    refresh_token_hash   TEXT NOT NULL,
    source               TEXT NOT NULL CHECK (source IN ('desktop', 'lan_web')),
    ip_address           TEXT,
    created_at           TEXT NOT NULL,
    expires_at           TEXT NOT NULL,
    revoked_at           TEXT
);

CREATE TABLE IF NOT EXISTS spotify_account (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    spotify_user_id     TEXT NOT NULL,
    access_token_enc    BLOB NOT NULL,
    refresh_token_enc   BLOB NOT NULL,
    scope               TEXT NOT NULL,
    expires_at          TEXT NOT NULL,
    connected_by        INTEGER NOT NULL REFERENCES users(id),
    connected_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playback_devices (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    spotify_device_id   TEXT NOT NULL,
    name                TEXT NOT NULL,
    is_target           BOOLEAN NOT NULL DEFAULT 0,
    last_seen_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS queue_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    track_uri       TEXT NOT NULL,
    track_name      TEXT NOT NULL,
    artist_name     TEXT NOT NULL,
    album_art_url   TEXT,
    duration_ms     INTEGER,
    added_by        INTEGER NOT NULL REFERENCES users(id),
    position        INTEGER NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','pushed','playing','played','skipped','removed')),
    added_at        TEXT NOT NULL,
    pushed_at       TEXT,
    played_at       TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER REFERENCES users(id),
    action          TEXT NOT NULL,
    entity_type     TEXT,
    entity_id       INTEGER,
    metadata_json   TEXT,
    ip_address      TEXT,
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    updated_by  INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_queue_items_status_position ON queue_items(status, position);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_created ON audit_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_action_created ON audit_log(action, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user_revoked ON sessions(user_id, revoked_at);

-- Default settings (theme + discoverability), inserted only if missing
INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES
    ('discoverable_on_network', 'false', datetime('now')),
    ('lan_port', '9000', datetime('now')),
    ('theme_mode', 'dark', datetime('now')),
    ('theme_accent', '#7C5CFF', datetime('now')),
    ('queue_log_retention_days', '60', datetime('now'));
