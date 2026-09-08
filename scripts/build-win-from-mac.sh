#!/usr/bin/env bash
# Builds the Windows installer FROM a Mac. Two things PyInstaller cannot
# do: cross-compile. A Mac can only ever produce a mac backend binary —
# so backend/dist/spotify-jam-backend.exe has to come from an actual
# Windows machine or Windows CI runner (see backend/build_backend.bat-
# equivalent: scripts/build.bat run there, or a GitHub Actions
# windows-latest job). Copy that .exe into backend/dist/ on THIS Mac,
# then run this script — electron-builder itself can package a Windows
# NSIS installer from mac fine, it just needs wine for that step.
set -e
cd "$(dirname "$0")/.."

EXE_PATH="backend/dist/spotify-jam-backend.exe"
if [ ! -f "$EXE_PATH" ]; then
  echo "Missing $EXE_PATH"
  echo "Build it on a real Windows machine (scripts\\build.bat, or just the"
  echo "PyInstaller step: pip install -r requirements.txt && pyinstaller"
  echo "--onefile --clean --noconsole --name spotify-jam-backend run.py),"
  echo "then copy the resulting .exe here before re-running this script."
  exit 1
fi

if ! command -v wine &> /dev/null; then
  echo "wine not found — required for electron-builder to build the NSIS"
  echo "installer on mac. Install with: brew install --cask wine-stable"
  exit 1
fi

echo "== 1/3 Building frontend =="
(cd frontend && npm run build)

echo "== 2/3 Flushing test user accounts and playback data from database =="
./backend/.venv/bin/python scripts/clean-build-db.py

echo "== 3/3 Packaging Windows installer (electron-builder --win) =="
npx electron-builder --win

echo ""
echo "Done — dist/*.exe (nsis installer)"
echo "NOTE: unsigned builds trigger SmartScreen warnings on Windows."
