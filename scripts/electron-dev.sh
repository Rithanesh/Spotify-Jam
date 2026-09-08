#!/usr/bin/env bash
# Full end-to-end test: builds the static frontend, then launches the real
# Electron app (which spawns the backend itself — python fallback if you
# haven't built the PyInstaller binary yet, see electron/main.js).
set -e
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "No .env found — run ./scripts/setup.sh first."
  exit 1
fi
set -a; source .env; set +a

echo "== Building frontend (static export) =="
(cd frontend && npm run build)

echo "== Launching Electron =="
npx electron .
