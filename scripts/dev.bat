@echo off
REM Dev loop in the actual Electron window (not a browser tab) so you
REM see real app chrome while keeping Next.js hot reload. Backend runs
REM once here; Electron skips spawning its own and points at :3000.
cd /d "%~dp0.."

if not exist .env (
  echo No .env found — run scripts\setup.bat first.
  exit /b 1
)

set LAN_PORT=9000
for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do (
  if not "%%a"=="" set "%%a=%%b"
)

start "backend" cmd /k "cd backend && .venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port %LAN_PORT%"
start "frontend" cmd /k "cd frontend && npm run dev"

echo Waiting for Next.js dev server on :3000...
:waitloop
curl -s http://localhost:3000 >nul 2>&1
if errorlevel 1 (
  timeout /t 1 >nul
  goto waitloop
)

set ELECTRON_START_URL=http://localhost:3000
set ELECTRON_SKIP_BACKEND=1
call npx electron .
