#!/usr/bin/env bash
# Full build: static frontend -> single-file backend binary -> installer
# (.dmg on mac). Output lands in dist/.
set -e
cd "$(dirname "$0")/.."

echo "== 1/4 Building frontend =="
(cd frontend && npm run build)

echo "== 2/4 Flushing test user accounts and playback data from database =="
./backend/.venv/bin/python scripts/clean-build-db.py

echo "== 3/4 Building backend binary (PyInstaller, using project venv) =="
(cd backend && bash build_backend.sh)

echo "== 4/4 Packaging installer (electron-builder) =="
npx electron-builder

echo ""
echo "Done — check dist/ for the installer."
echo "NOTE: unsigned builds will be blocked by Gatekeeper on other Macs."
echo "See README.md for code-signing/notarization steps before distributing."
