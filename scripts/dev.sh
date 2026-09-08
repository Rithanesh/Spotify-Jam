#!/usr/bin/env bash
# Dev loop, but in the actual Electron window (not a browser tab) so you
# see the real app chrome/look-and-feel while still getting Next.js hot
# reload. Backend runs once here; Electron is told to skip spawning its
# own copy and just point at the dev server.
set -e
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "No .env found — run ./scripts/setup.sh first."
  exit 1
fi
set -a; source .env; set +a

cleanup() { kill 0; }
trap cleanup EXIT INT TERM

(cd backend && ./.venv/bin/python -m uvicorn app.main:app --reload --host 0.0.0.0 --port "${LAN_PORT:-9000}") &
(cd frontend && npm run dev) &

echo "Waiting for Next.js dev server on :3000…"
until curl -s http://localhost:3000 > /dev/null; do sleep 0.5; done

ELECTRON_START_URL=http://localhost:3000 ELECTRON_SKIP_BACKEND=1 npx electron .

wait
