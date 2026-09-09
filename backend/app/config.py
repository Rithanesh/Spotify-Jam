"""
Central config. APP_DATA_DIR is passed in by Electron's main process
(via the APP_DATA_DIR env var) so the DB and logs live in the OS-correct
per-user app data folder — never inside the installed app bundle, which
is read-only after code signing on both mac and Windows.
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

# In dev, .env sits at the repo root (two levels up from this file).
# In a PyInstaller frozen build, __file__ is inside _MEIPASS so that
# path doesn't exist — try the process CWD (set by Electron) as a
# secondary location, and silently skip if neither exists.
_dev_env = Path(__file__).resolve().parents[2] / ".env"
_cwd_env = Path.cwd() / ".env"
if _dev_env.is_file():
    load_dotenv(_dev_env)
elif _cwd_env.is_file():
    load_dotenv(_cwd_env)

APP_DATA_DIR = Path(os.environ.get("APP_DATA_DIR", Path.home() / ".spotify-jam-app"))
APP_DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = APP_DATA_DIR / "app.db"
LOG_DIR = APP_DATA_DIR / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

# Spotify dev app credentials — client secret must never be sent to the
# frontend/LAN clients, only used here server-side.
SPOTIFY_CLIENT_ID = os.environ.get("SPOTIFY_CLIENT_ID", "")
SPOTIFY_CLIENT_SECRET = os.environ.get("SPOTIFY_CLIENT_SECRET", "")
SPOTIFY_REDIRECT_URI = os.environ.get("SPOTIFY_REDIRECT_URI", "http://127.0.0.1:9000/api/spotify/callback")

# JWT
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
REFRESH_TOKEN_EXPIRE_DAYS = 14

# Ports: loopback-only port for the Electron UI, LAN-facing port gated by
# the "discoverable" toggle (see middleware in main.py)
LOOPBACK_PORT = 8000
LAN_PORT = int(os.environ.get("LAN_PORT", "9000"))

APP_VERSION = os.environ.get("APP_VERSION", "0.1.0")

# Frontend serving target for LAN browser clients: dev points into the
# repo's Next.js static export; packaged builds get this from Electron
# (frontend/out copied as a plain extraResource, not locked inside
# app.asar, since this separate backend process reads it straight off disk).
FRONTEND_DIR = Path(os.environ.get("FRONTEND_DIR", Path(__file__).resolve().parents[2] / "frontend" / "out"))
