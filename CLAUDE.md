# Echo — Step Inside Your Stories

Paste a story, step inside it. Text gets decomposed into scenes, each scene becomes a navigable 3D world (via World Labs Marble), with narrated audio (via ElevenLabs) synced to cinematic camera movement.

## Architecture

```
worldlabs/
├── backend/          Python FastAPI server (port 8002)
│   ├── main.py       All API endpoints
│   ├── db.py         SQLite persistence layer
│   ├── db/           Data directory (echo.db, audio/, samples)
│   ├── test_api.py   End-to-end test script
│   └── requirements.txt
├── frontend/         React/SparkJS viewer (port 8080)
├── src/              Legacy Next.js app (single-scene, kept as reference)
└── .env              API keys (not committed)
```

Backend and frontend are fully separated. Backend exposes REST JSON API, frontend consumes it via Vite proxy (`/api` → `localhost:8002`).

## Backend API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/generations` | POST | Create generation — starts full pipeline as background task |
| `/generations` | GET | List all generations (gallery) |
| `/generations/:id` | GET | Get generation status + data |
| `/generations/:id/audio` | GET | Stream narration MP3 |
| `/extract-scenes` | POST | Gemini decomposes story text into 2-5 scene JSON with Marble-optimized prompts |
| `/generate-speech` | POST | ElevenLabs TTS, returns MP3 binary |
| `/generate-worlds` | POST | Fires parallel Marble API requests, returns operation IDs |
| `/poll-worlds` | GET | Polls Marble operations, returns status + SPZ URLs |
| `/health` | GET | Shows which API keys are configured |
| `/docs` | GET | Swagger UI (auto-generated) |

## Running

```bash
# Backend
cd backend && pip install -r requirements.txt && python main.py
# Runs on http://localhost:8002, Swagger at http://localhost:8002/docs

# Test all endpoints end-to-end
cd backend && python test_api.py
```

## Env Vars (root .env)

- `GEMINI_API_KEY` — Google Gemini (scene extraction)
- `ELEVEN_LABS_API` — ElevenLabs TTS (narration audio)
- `WORLD_LABS_API_KEY` — World Labs Marble API (3D world generation)

## Key Technical Details

- Scene extraction uses Gemini 2.5 Flash with `response_mime_type: "application/json"` for structured output
- World generation fires all scenes in parallel via `asyncio.gather` + `httpx.AsyncClient`
- Marble API: `Marble 0.1-mini` for dev (~30s), rate limit ~6 req/min
- SPZ URL extraction handles multiple response paths (assets.splats.spz_urls, legacy paths)
- ElevenLabs uses "Adam" voice (pNInz6obpgDQGcFmaJgB), eleven_multilingual_v2 model

## Pipeline Flow

```
Text → POST /generations → backend runs full pipeline as background task:
     → Extract scenes (Gemini) → Generate speech (ElevenLabs) → Build worlds (Marble, parallel) → Poll until ready
     → Frontend polls GET /generations/:id for status updates
     → Experience page loads SPZ files in SparkJS, syncs camera to audio
```

## Conventions

- Backend is Python (FastAPI + httpx + google-genai), SQLite for persistence (WAL mode)
- Frontend is React + THREE.js + SparkJS (@sparkjsdev/spark) for Gaussian splat rendering
- All API keys loaded from root `.env` via python-dotenv
- Never commit `.env` or API keys
