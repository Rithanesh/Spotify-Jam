# Spotify Jam App

Electron desktop app (Mac + Windows) for a shared queue: one device stays
connected to the speaker via Spotify, everyone else adds/reorders songs
from the app or, when the admin turns on "network access," from a
browser on the same Wi-Fi.

## Structure

```
electron/     Electron main process + preload (spawns backend, owns the window)
backend/      FastAPI + SQLite — auth, queue engine, Spotify client, scheduler
frontend/     Next.js (static export), theming, loader, all pages
docs/         db-schema.md — full schema documentation
```

## Important design note: Spotify's queue API

Spotify's Web API has **no endpoint to reorder or remove tracks from a
device's live playback queue** — only "add to queue" exists, and the
live queue can't even be read back. So this app keeps its own queue in
SQLite (`queue_items`) as the source of truth, and only pushes the next
song to Spotify right before it's due to play. Move up/down/delete only
work on songs that haven't been pushed yet (see `backend/app/queue_engine.py`).
Once a song is "now playing" you can skip it, but not un-add it.

## Quick start (scripts do the rest)

```
npm run setup          # mac/linux — or scripts\setup.bat on Windows
                        # installs backend + frontend + root deps, creates .env

# fill in SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET in .env, then:

npm run dev             # backend --reload + next dev, opens the real
                        # Electron window pointed at localhost:3000 —
                        # hot reload AND actual app look/feel, not a tab
                        # (scripts\dev.bat on Windows)

npm run electron-dev    # builds frontend, launches the real Electron shell
                        # (scripts\electron-dev.bat on Windows)

npm run build            # full production installer -> dist/
                        # (scripts\build.bat on Windows)
```

`npm run dev` is the fast loop — hot reload, test in a normal browser,
no Electron packaging step. `npm run electron-dev` is for checking the
actual desktop shell (window chrome, tray, spawned backend) before a
full build. Both skip PyInstaller — `electron/main.js` falls back to
running the Python source directly via `python3`/`python` when it can't
find a built binary, so you don't need to rebuild the backend binary on
every change during dev.

## First-time setup (manual, if you'd rather not use the scripts)

1. **Spotify dev app**: create one at https://developer.spotify.com/dashboard,
   set the redirect URI to `http://127.0.0.1:9000/api/spotify/callback`,
   and set `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` as env vars (or
   bake them into `backend/app/config.py` before building — never ship
   them in a public repo).

2. **Backend**:
   ```
   cd backend
   pip install -r requirements.txt --break-system-packages
   python run.py          # dev server, http://0.0.0.0:9000
   ```
   First run prints a generated admin password to the console and to
   `~/.spotify-jam-app/logs/app.log` — log in as `admin` with that
   password and change it.

3. **Frontend**:
   ```
   cd frontend
   npm install
   npm run dev             # dev server, http://localhost:3000
   ```

4. **Electron (dev)**:
   ```
   npm install
   npm start                # loads frontend/out — run `npm run build:frontend` first
   ```

## Building the installer (single file, no dependencies for the user)

```
npm run build:frontend    # next build -> frontend/out (static)
npm run build:backend     # pyinstaller -> backend/dist/spotify-jam-backend(.exe)
npm run build              # electron-builder -> dist/ (.dmg for mac, .exe/.msi for Windows)
```

`electron-builder` bundles the PyInstaller binary as an extra resource
and the static Next.js export as app files — the end user installs one
file with nothing else to set up. macOS needs code signing + notarization
for Gatekeeper to allow the bundled backend binary to run; Windows
benefits from a code-signing cert to avoid SmartScreen warnings.

## What's implemented vs. stubbed

Implemented: schema + migrations, argon2 auth, JWT sessions, invite-based
member onboarding, RBAC (admin/member), the own-queue engine with
add/reorder/remove, discoverable-on-network gate (checked per-request,
so the toggle is instant), OS-keychain-backed encryption for Spotify
tokens, rotating file logs, structured audit log, log export as a zip,
per-user and admin dashboards (date-wise, derived from the audit log),
daily cleanup of audit/queue rows older than the configurable retention
window (default 60 days), light/dark/custom theming with a live accent
picker, and a music-themed loader screen.

Also now wired up: the Spotify "Connect" button and device picker
(Settings page → `components/SpotifyPanel.tsx`), opening Spotify's OAuth
page in the OS browser via `electronAPI.openExternal` (not inside the
Electron window itself — mixing app chrome with a login page is a bad
idea), and a plain confirmation page returned by `/api/spotify/callback`
since a packaged app has no `localhost:3000` to redirect back to.

Still left for you: swapping the queue page's polling for a websocket if
you want push updates instead of a 4-second refresh, and testing the
whole OAuth round-trip against a real Spotify dev app (untested here —
no internet access in the environment that built this).

## venv, default login, and running both modes at once

- **Backend venv**: `npm run setup` creates `backend/.venv` and installs everything into it — nothing goes to system Python. Every dev/build script uses that venv's Python directly, no manual activation needed. `npm run build` also builds the PyInstaller binary from that same venv (`--clean` build, `--noconsole` on Windows since it runs as a background process with no terminal of its own).
- **First login is `admin` / `admin`**, and the app forces a password change before anything else works — `must_change_password` on the user, checked by every page via `frontend/lib/useAuthGuard.ts`, enforced server-side too so it can't be skipped by hitting the API directly.
- **Testing both admin-desktop and LAN-web at once**: run `npm run electron-dev`. The one FastAPI backend Electron spawns now serves both — the same static frontend for LAN browsers (`FRONTEND_DIR`, mounted in `backend/app/main.py`) and the Electron window itself over loopback. A single middleware (`discoverable_gate` in `main.py`) allows loopback always and gates everything else — API and pages both — behind the admin's network-access toggle, so there's exactly one place that decision lives. To test: launch with `electron-dev`, log in as admin, flip "network access" on in Settings, then from another device on the same Wi-Fi open `http://<your-computer-name>.local:9000` (or the LAN IP electron-dev prints) and log in with a member account/invite code.

## Building for both Mac and Windows, from a Mac

```
npm run build:mac    # everything, on this Mac -> dist/*.dmg
npm run build:win    # packages a Windows installer, on this Mac -> dist/*.exe
```

**The catch**: PyInstaller does not cross-compile. A Mac can only ever
produce a mac backend binary — there's no way around this from mac
alone. So `build:win` needs `backend/dist/spotify-jam-backend.exe`
already sitting there, built on an actual Windows machine or a Windows
CI runner (e.g. a `windows-latest` GitHub Actions job running
`scripts\build.bat`, or just its PyInstaller step). Copy that `.exe`
into `backend/dist/` on this Mac, then run `npm run build:win` —
electron-builder itself packages a Windows NSIS installer from mac
fine, it just needs `wine` for that one step:
`brew install --cask wine-stable`.

The frontend build is the same static export either way — no
cross-compile issue there, ever.
