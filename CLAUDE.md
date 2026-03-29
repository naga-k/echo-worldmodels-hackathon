# Echo — Step Inside Your Stories

Paste a story, step inside it. Text gets decomposed into scenes, each scene becomes a navigable 3D world (via World Labs Marble) with Gemini Live voice chat.

## Architecture

```
worldlabs/
├── backend/          Python FastAPI server (port 8002)
│   ├── main.py       All API endpoints + background pipeline
│   ├── db.py         SQLite persistence layer
│   ├── db/           Data directory (echo.db, samples, book texts)
│   ├── test_api.py   End-to-end test script
│   └── requirements.txt
├── frontend/         React/SparkJS viewer (port 8080)
│   ├── src/pages/    Index, Processing, Experience, Gallery
│   └── vite.config.ts  Proxy /api → localhost:8002
├── .claude/skills/   Project-specific skills (grab-story)
├── run.sh            Starts backend + frontend + optional Cloudflare tunnel
└── .env              API keys (not committed)
```

Backend and frontend are fully separated. Backend exposes REST JSON API, frontend consumes it via Vite proxy (`/api` → `localhost:8002`).

## Backend API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/generations` | POST | Create generation — starts full pipeline as background task |
| `/generations` | GET | List all generations (gallery) |
| `/generations/{id}` | GET | Get generation status + data |
| `/extract-scenes` | POST | Gemini decomposes story text into 2-5 scene JSON |
| `/generate-worlds` | POST | Fires parallel Marble API requests, returns operation IDs |
| `/poll-worlds` | GET | Polls Marble operations, returns status + SPZ URLs |
| `/samples` | GET | Sample stories for the landing page |
| `/health` | GET | Shows which API keys are configured |
| `/ws/gemini-live` | WS | Bidirectional voice chat with Gemini Live |

## Running

```bash
# Everything at once (recommended)
./run.sh

# Or manually:
cd backend && source .venv/bin/activate && python main.py  # port 8002
cd frontend && npm run dev                                  # port 8080
```

## Frontend Routes

| Route | Page |
|-------|------|
| `/` | Landing — paste story, pick sample |
| `/processing/:id` | Pipeline progress (polls backend) |
| `/experience/:id` | 3D viewer (shareable link) |
| `/gallery` | All past generations |

## Env Vars (root .env)

- `GEMINI_API_KEY` — Google Gemini (scene extraction + voice chat)
- `WORLD_LABS_API_KEY` — World Labs Marble API (3D world generation)

## Key Technical Details

- Scene extraction uses Gemini 3 Flash with `response_mime_type: "application/json"` for structured output
- World generation fires all scenes in parallel via `asyncio.gather` + `httpx.AsyncClient`
- Marble API: `Marble 0.1-mini` for dev (~30s), rate limit ~6 req/min
- SQLite persistence (WAL mode) — generations survive page refresh and server restart
- Background pipeline via `asyncio.create_task` — no Celery/Redis needed for 4-5 users
- Shareable links: `/experience/:id` loads directly from backend

## Pipeline Flow

```
Text → POST /generations → backend runs full pipeline as background task:
     → Extract scenes (Gemini) → Build worlds (Marble, parallel) → Poll until ready
     → Frontend polls GET /generations/:id for status updates
     → Experience page loads SPZ files in SparkJS with scene navigation
     → Gemini Live voice chat available during exploration
```

## Conventions

- Backend is Python (FastAPI + httpx + google-genai), SQLite for persistence
- Frontend is React + THREE.js + SparkJS (@sparkjsdev/spark) for Gaussian splat rendering
- Frontend uses Vite proxy (`/api/*` → `localhost:8002`) — only one port needs tunneling
- All API keys loaded from root `.env` via python-dotenv
- Never commit `.env` or API keys
- Cloudflare tunnel (via `cloudflared`) for sharing with friends — auto-started by `run.sh`
