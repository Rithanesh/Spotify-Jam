@echo off
REM One-time setup: creates a backend venv, installs backend + frontend +
REM root deps, and creates .env from the template if it doesn't exist yet.
cd /d "%~dp0.."

echo == Backend venv ==
cd backend
python -m venv .venv
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install -r requirements.txt
cd ..

echo == Frontend deps ==
cd frontend
call npm install
cd ..

echo == Root deps (electron, electron-builder) ==
call npm install

if not exist .env (
  copy .env.example .env
  echo.
  echo ^>^>^> Created .env from .env.example — fill in your Spotify
  echo ^>^>^> SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET before running dev.bat
)

echo.
echo Setup done. Backend venv lives at backend\.venv — scripts use it
echo automatically, no manual activation needed. Next: scripts\dev.bat
