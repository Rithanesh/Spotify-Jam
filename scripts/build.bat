@echo off
REM Full build: static frontend -> single-file backend .exe -> installer.
REM Output lands in dist\.
cd /d "%~dp0.."

echo == 1/4 Building frontend ==
cd frontend
call npm run build
cd ..

echo == 2/4 Flushing test user accounts and playback data from database ==
backend\.venv\Scripts\python.exe scripts\clean-build-db.py

echo == 3/4 Building backend binary (PyInstaller, using project venv) ==
cd backend
if not exist .venv (
  echo No venv found — run scripts\setup.bat first.
  exit /b 1
)
.venv\Scripts\python.exe -m pip install -r requirements.txt --upgrade
REM --noconsole: this runs as a background process spawned by Electron,
REM no terminal window should pop up for the user on Windows.
.venv\Scripts\pyinstaller.exe --onefile --clean --noconsole --name spotify-jam-backend --add-data "app\schema.sql;app" run.py
cd ..

echo == 3/3 Packaging installer (electron-builder) ==
call npx electron-builder

echo.
echo Done — check dist\ for the installer.
echo NOTE: unsigned builds trigger SmartScreen warnings. See README.md
echo for code-signing steps before distributing.
