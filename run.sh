#!/bin/bash
# Run backend and frontend in parallel

cleanup() {
  echo "Shutting down..."
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
  exit 0
}
trap cleanup SIGINT SIGTERM

DIR="$(cd "$(dirname "$0")" && pwd)"

# Backend
echo "Starting backend on :8002..."
cd "$DIR/backend"
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
fi
.venv/bin/python main.py &
BACKEND_PID=$!

# Frontend
echo "Starting frontend on :8080..."
cd "$DIR/frontend"
if [ ! -d "node_modules" ]; then
  npm install
fi
npm run dev &
FRONTEND_PID=$!

echo ""
echo "Backend:  http://localhost:8002  (docs: http://localhost:8002/docs)"
echo "Frontend: http://localhost:8080"
echo ""
echo "Press Ctrl+C to stop both."

wait
