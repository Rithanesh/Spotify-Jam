@echo off
REM Full end-to-end test: builds the static frontend, then launches the
REM real Electron app (spawns the backend itself, python fallback if no
REM PyInstaller build yet).
cd /d "%~dp0.."

if not exist .env (
  echo No .env found — run scripts\setup.bat first.
  exit /b 1
)

echo == Building frontend (static export) ==
cd frontend
call npm run build
cd ..

echo == Launching Electron ==
call npx electron .
