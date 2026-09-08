#!/usr/bin/env bash
# Builds a single-file backend binary using the project's own venv (not
# system Python) so the build is reproducible and doesn't pick up
# unrelated packages. Output lands in backend/dist/, picked up by
# electron-builder's extraResources (see ../package.json).
set -e
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "No venv found — run ../scripts/setup.sh first."
  exit 1
fi

./.venv/bin/pip install -r requirements.txt --upgrade
./.venv/bin/pyinstaller --onefile --clean --name spotify-jam-backend \
  --add-data "app/schema.sql:app" \
  run.py

echo "Built: backend/dist/spotify-jam-backend"
