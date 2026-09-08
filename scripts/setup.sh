#!/usr/bin/env bash
# One-time setup: creates a backend venv, installs backend + frontend +
# root deps, and creates .env from the template if it doesn't exist yet.
set -e
cd "$(dirname "$0")/.."

echo "== Backend venv =="
cd backend
python3 -m venv .venv
./.venv/bin/pip install --upgrade pip
./.venv/bin/pip install -r requirements.txt
cd ..

echo "== Frontend deps =="
cd frontend
npm install
cd ..

echo "== Root deps (electron, electron-builder) =="
npm install

if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo ">>> Created .env from .env.example — fill in your Spotify"
  echo ">>> SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET before running dev.sh"
fi

echo ""
echo "Setup done. Backend venv lives at backend/.venv — scripts use it"
echo "automatically, no manual activation needed. Next: ./scripts/dev.sh"
