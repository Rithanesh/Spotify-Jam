#!/usr/bin/env bash
# Full mac build, run on a Mac. Produces backend/dist/spotify-jam-backend
# (mac binary — PyInstaller does NOT cross-compile, this only runs here)
# and dist/*.dmg.
set -e
cd "$(dirname "$0")/.."

echo "== 1/4 Building frontend =="
(cd frontend && npm run build)

echo "== 2/4 Flushing test user accounts and playback data from database =="
./backend/.venv/bin/python scripts/clean-build-db.py

echo "== 3/4 Building backend binary (mac, via project venv) =="
(cd backend && bash build_backend.sh)

echo "== 4/4 Packaging mac installer (electron-builder --mac) =="
NODE_OPTIONS="--experimental-require-module" npx electron-builder --mac

echo ""
echo "Done — dist/*.dmg"
echo "NOTE: unsigned builds are blocked by Gatekeeper on other Macs."
echo "Sign + notarize before distributing (see README.md)."
