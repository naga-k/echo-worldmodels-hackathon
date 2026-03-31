#!/bin/bash
# Usage:
#   ./run.sh              Dev mode: backend (reload) + frontend
#   ./run.sh --serve      Server mode: backend (no reload) + cloudflare tunnel on :8002
#   ./run.sh --backend-only  Backend only (reload, no frontend)

BACKEND_PID=""
FRONTEND_PID=""
TUNNEL_PID=""

cleanup() {
  echo "Shutting down..."
  kill $BACKEND_PID $FRONTEND_PID $TUNNEL_PID 2>/dev/null
  exit 0
}
trap cleanup SIGINT SIGTERM

DIR="$(cd "$(dirname "$0")" && pwd)"

# Load .env for ECHO_DATA_DIR
if [ -f "$DIR/.env" ]; then
  export $(grep -v '^#' "$DIR/.env" | xargs)
fi
DATA_DIR="${ECHO_DATA_DIR:-$HOME/.echo-data}"
DATA_DIR="${DATA_DIR/#\~/$HOME}"

# Migrate existing data from backend/db/ to ECHO_DATA_DIR if needed
OLD_DB="$DIR/backend/db/echo.db"
NEW_DB="$DATA_DIR/echo.db"
if [ -f "$OLD_DB" ] && [ ! -f "$NEW_DB" ]; then
  echo "Migrating data to $DATA_DIR..."
  mkdir -p "$DATA_DIR/audio"
  cp "$OLD_DB" "$NEW_DB"
  [ -f "${OLD_DB}-wal" ] && cp "${OLD_DB}-wal" "${NEW_DB}-wal"
  [ -f "${OLD_DB}-shm" ] && cp "${OLD_DB}-shm" "${NEW_DB}-shm"
  if [ -d "$DIR/backend/db/audio" ]; then
    cp -r "$DIR/backend/db/audio/"* "$DATA_DIR/audio/" 2>/dev/null
  fi
  echo "Migration complete."
fi

SERVE_MODE=false
BACKEND_ONLY=false
[[ "$*" == *"--serve"* ]] && SERVE_MODE=true
[[ "$*" == *"--backend-only"* ]] && BACKEND_ONLY=true

# Backend
cd "$DIR/backend"
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
fi

SERVE_PORT="${SERVE_PORT:-8003}"

if $SERVE_MODE; then
  echo "Starting backend on :$SERVE_PORT (server mode, no reload)..."
  PORT=$SERVE_PORT .venv/bin/python main.py --no-reload &
  BACKEND_PID=$!

  sleep 2
  if command -v cloudflared &> /dev/null; then
    echo "Starting Cloudflare tunnel → echo-backend.nagak.me..."
    cloudflared tunnel run echo-backend &
    TUNNEL_PID=$!
  else
    echo "cloudflared not found — install it to expose the backend"
  fi
else
  echo "Starting backend on :8002 (dev mode, reload)..."
  .venv/bin/python main.py &
  BACKEND_PID=$!

  if ! $BACKEND_ONLY; then
    echo "Starting frontend on :8080..."
    cd "$DIR/frontend"
    if [ ! -d "node_modules" ]; then
      npm install
    fi
    npm run dev &
    FRONTEND_PID=$!
  fi
fi

echo ""
echo "───────────────────────────────────────"
if $SERVE_MODE; then
  echo "Backend:  http://localhost:$SERVE_PORT  (docs: http://localhost:$SERVE_PORT/docs)"
else
  echo "Backend:  http://localhost:8002  (docs: http://localhost:8002/docs)"
fi
echo "Data dir: $DATA_DIR"
if ! $SERVE_MODE && ! $BACKEND_ONLY; then
  echo "Frontend: http://localhost:8080"
fi
echo "───────────────────────────────────────"
echo ""
echo "Press Ctrl+C to stop everything."

wait
