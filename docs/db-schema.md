# Database Schema — Spotify Jam Desktop App

SQLite, single file, local to the admin's machine (e.g. `app.getPath('userData')/app.db`).
All timestamps are UTC ISO-8601 strings unless noted. All `id` columns are `INTEGER PRIMARY KEY AUTOINCREMENT` unless noted.

---

## 1. `users`

The admin (one per install, created on first run) plus any members the admin creates.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| username | TEXT UNIQUE NOT NULL | |
| password_hash | TEXT NOT NULL | argon2id hash |
| role | TEXT NOT NULL | `admin` \| `member` |
| display_name | TEXT | shown in queue/logs |
| is_active | BOOLEAN NOT NULL DEFAULT 1 | admin can deactivate without deleting (preserves audit history) |
| created_by | INTEGER | FK → users.id (NULL for the admin's own row) |
| created_at | TEXT NOT NULL | |
| last_login_at | TEXT | |

Only one row may have `role = 'admin'` — enforce in application logic (SQLite has no partial-unique-index-on-value-easily, or use a `CHECK` + trigger if you want it DB-enforced).

---

## 2. `invites`

Admin-generated codes/temp-passwords for onboarding members.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| code_hash | TEXT NOT NULL | hash of the invite code, never store plaintext |
| role | TEXT NOT NULL DEFAULT 'member' | roles the invite grants |
| created_by | INTEGER NOT NULL | FK → users.id |
| expires_at | TEXT | NULL = no expiry |
| used_by | INTEGER | FK → users.id, NULL until redeemed |
| used_at | TEXT | |
| created_at | TEXT NOT NULL | |

---

## 3. `sessions`

Tracked so the admin can revoke access (e.g. remove a member's active session) rather than relying purely on stateless JWT expiry.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| user_id | INTEGER NOT NULL | FK → users.id |
| refresh_token_hash | TEXT NOT NULL | never store the raw token |
| source | TEXT NOT NULL | `desktop` \| `lan_web` — distinguishes Electron UI sessions from browser (toggle-gated) sessions |
| ip_address | TEXT | useful for LAN sessions |
| created_at | TEXT NOT NULL | |
| expires_at | TEXT NOT NULL | |
| revoked_at | TEXT | NULL = still valid |

---

## 4. `spotify_account`

Single row (or one per admin, if you ever support multiple admins per install — start with one). Holds the OAuth tokens for the Spotify Premium account controlling playback.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| spotify_user_id | TEXT NOT NULL | Spotify's own user id |
| access_token_enc | BLOB NOT NULL | AES-GCM encrypted, key from OS keychain via Electron `safeStorage` |
| refresh_token_enc | BLOB NOT NULL | same |
| scope | TEXT NOT NULL | granted OAuth scopes |
| expires_at | TEXT NOT NULL | access token expiry, drives refresh scheduling |
| connected_by | INTEGER NOT NULL | FK → users.id (admin) |
| connected_at | TEXT NOT NULL | |

Client ID/secret for the Spotify dev app itself live in a config/env file bundled at build time (or also keychain-encrypted) — never sent to any frontend, only used server-side in FastAPI.

---

## 5. `playback_devices`

Spotify Connect devices seen on the account, so the admin can pick which one is "the speaker."

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| spotify_device_id | TEXT NOT NULL | Spotify's device id (changes if device reconnects — refresh periodically) |
| name | TEXT NOT NULL | e.g. "Living Room Speaker" |
| is_target | BOOLEAN NOT NULL DEFAULT 0 | only one should be 1 at a time — this is where playback commands are sent |
| last_seen_at | TEXT NOT NULL | |

---

## 6. `queue_items`

**This is the app's real queue** — not Spotify's. Only the item with `status = 'pushed'` or `'playing'` has actually been sent to Spotify; everything else is pending and freely reorderable/removable by the app. See note below the table.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| track_uri | TEXT NOT NULL | `spotify:track:...` |
| track_name | TEXT NOT NULL | denormalized for fast display/logs without re-hitting Spotify |
| artist_name | TEXT NOT NULL | |
| album_art_url | TEXT | |
| duration_ms | INTEGER | |
| added_by | INTEGER NOT NULL | FK → users.id |
| position | INTEGER NOT NULL | app-managed sort order among `pending` items |
| status | TEXT NOT NULL DEFAULT 'pending' | `pending` \| `pushed` \| `playing` \| `played` \| `skipped` \| `removed` |
| added_at | TEXT NOT NULL | |
| pushed_at | TEXT | when sent to Spotify's actual queue |
| played_at | TEXT | when it finished / was skipped |

**Why this table exists the way it does:** Spotify's Web API has no endpoint to reorder or remove items from a device's live playback queue — only "add to queue" is supported. So the app maintains this table as the source of truth for "what's coming up," and a background job pushes only the next `pending` item to Spotify right before it's due to play. Move-up/down/delete operations are only valid while `status = 'pending'`; once `pushed`/`playing`, the only available action is "skip" (which Spotify does support).

---

## 7. `audit_log`

Every add/reorder/remove/login/toggle event, structured — this is what both the dashboards and the "export logs" feature read from.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| user_id | INTEGER | FK → users.id, NULL for system-generated events |
| action | TEXT NOT NULL | `song_added` \| `song_removed` \| `song_reordered` \| `song_played` \| `login` \| `logout` \| `discoverable_toggled` \| `user_created` \| `user_deactivated` etc. |
| entity_type | TEXT | `queue_item` \| `user` \| `settings` \| ... |
| entity_id | INTEGER | id of the affected row, where applicable |
| metadata_json | TEXT | free-form JSON — e.g. `{"track_name": "...", "from_position": 3, "to_position": 1}` |
| ip_address | TEXT | populated for LAN-web actions |
| created_at | TEXT NOT NULL | |

Index on `(user_id, created_at)` and `(action, created_at)` — these are exactly the query patterns the dashboards need (per-user activity, activity-by-type-over-time).

---

## 8. `app_settings`

Simple key-value store for runtime toggles.

| Column | Type | Notes |
|---|---|---|
| key | TEXT PK | e.g. `discoverable_on_network`, `lan_port`, `app_version` |
| value | TEXT NOT NULL | stored as text, cast in application code |
| updated_at | TEXT NOT NULL | |
| updated_by | INTEGER | FK → users.id |

---

## Relationships summary

```
users 1───* invites (created_by)
users 1───* sessions
users 1───1 spotify_account (connected_by, admin only)
users 1───* queue_items (added_by)
users 1───* audit_log (user_id)
```

## Indexes to add

- `queue_items(status, position)` — fast "give me the pending queue in order"
- `audit_log(user_id, created_at)`
- `audit_log(action, created_at)`
- `sessions(user_id, revoked_at)`
- `users(username)` — already covered by UNIQUE constraint

## Dashboard data note

Per-user "songs requested" and admin's user-split view should be **derived from `audit_log`** (`GROUP BY user_id, date(created_at)` for `action = 'song_added'`), not a separately maintained file — keeps one source of truth. If you still want a daily flat-file export for portability, generate it *from* this table (e.g. a nightly job writing `logs/YYYY-MM-DD.jsonl`) rather than writing to it directly during normal operation.
