# Echo — Step Inside Your Stories

Paste a story, step inside it. Text gets decomposed into scenes, each scene becomes a navigable 3D world (via World Labs Marble) with AI-generated background music (via Lyria 3) and a proactive voice guide (via Gemini Live).

## Architecture

```
worldlabs/
├── backend/          Python FastAPI server (port 8002 dev, 8003 serve)
│   ├── main.py       All API endpoints + background pipeline
│   ├── db.py         SQLite persistence layer (data in ECHO_DATA_DIR)
│   ├── db/           Static data (samples.json, book texts) — NOT runtime data
│   ├── test_api.py   End-to-end test script
│   └── requirements.txt
├── frontend/         React/SparkJS viewer (port 8080 dev, Vercel prod)
│   ├── src/pages/    Index, Processing, Experience, Gallery
│   ├── src/hooks/    useGeminiLive (voice chat), useAudioMixer (BGM + ducking)
│   ├── vite.config.ts  Proxy /api → localhost:8002 (dev only)
│   └── vercel.json   Vercel deployment config
├── .agents/skills/   Project-specific skills (grab-story)
├── run.sh            Starts backend + frontend / serve mode with tunnel
└── .env              API keys + ECHO_DATA_DIR (not committed)
```

Backend and frontend are fully separated. Backend exposes REST JSON API. In dev, frontend proxies `/api` → `localhost:8002`. In production, frontend talks directly to backend via `VITE_API_URL`.

## Backend API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/generations` | POST | Create generation — starts full pipeline as background task |
| `/generations` | GET | List all generations (gallery) |
| `/generations/{id}` | GET | Get generation status + data |
| `/generations/{id}/scenes/{scene_id}/bgm` | GET | Serve BGM audio for a scene |
| `/extract-scenes` | POST | Gemini decomposes story text into 2-5 scene JSON |
| `/generate-worlds` | POST | Fires parallel Marble API requests, returns operation IDs |
| `/poll-worlds` | GET | Polls Marble operations, returns status + SPZ URLs |
| `/samples` | GET | Sample stories for the landing page |
| `/health` | GET | Shows which API keys are configured |
| `/ws/gemini-live` | WS | Bidirectional voice chat with Gemini Live (proactive narrator) |

## Running

```bash
./run.sh              # Dev: backend (8002, reload) + frontend (8080)
./run.sh --serve      # Server: backend (8003, no reload) + Cloudflare tunnel
./run.sh --backend-only  # Backend only (8002, reload)

# Or manually:
cd backend && source .venv/bin/activate && python main.py  # port 8002
cd frontend && npm run dev                                  # port 8080
```

### Remote development (VS Code tunnel / LAN)

Both backend and frontend bind to `0.0.0.0`, so they're accessible on the local network. From another device on the same network, open `http://<machine-ip>:8080`. The frontend auto-detects non-localhost access and hits the backend at `<same-host>:8002` directly (no Vite proxy). No tunnel configuration needed for LAN access.

## Frontend Routes

| Route | Page |
|-------|------|
| `/` | Landing — paste story, pick sample |
| `/processing/:id` | Pipeline progress (polls backend) |
| `/experience/:id` | "Enter World" gate → 3D viewer with auto-start BGM + voice |
| `/gallery` | All past generations |

## Env Vars (root .env)

- `ECHO_DATA_DIR` — Runtime data directory (default: `~/.echo-data/`). SQLite DB + audio files.
- `GEMINI_API_KEY` — Google Gemini (scene extraction, BGM generation via Lyria 3, voice chat)
- `ELEVEN_LABS_API` — ElevenLabs TTS (currently unused, narration removed)
- `WORLD_LABS_API_KEY` — World Labs Marble API (3D world generation)

## Deployment

- **Backend**: Local machine, exposed via named Cloudflare Tunnel. `./run.sh --serve` starts backend on :8003 + tunnel.
- **Frontend**: Vercel. `cd frontend && vercel --prod`. Set `VITE_API_URL` env var in Vercel to the tunnel URL.

## Key Technical Details

- Scene extraction uses Gemini 3 Flash with `response_mime_type: "application/json"` for structured output
- Extraction prompt outputs `music_description` per scene for BGM generation
- World generation + BGM generation fire in parallel via `asyncio.gather`
- BGM uses Lyria 3 Clip (`lyria-3-clip-preview`) — 30s instrumental clips, looped
- Marble API: `Marble 0.1-mini` for dev (~30s), rate limit ~6 req/min
- SQLite persistence (WAL mode) — generations survive page refresh and server restart
- Background pipeline via `asyncio.create_task` — no Celery/Redis needed for 4-5 users
- Shareable links: `/experience/:id` loads directly from backend

## Audio Architecture

```
"Enter World" click → audioContext.resume()
         │
         ├── BGM: <audio> → createMediaElementSource → bgmGain → destination
         │        (Lyria 3 Clip, looped, fade-in 1s)
         │
         └── Voice: PCM chunks → AudioBufferSource → voiceGain → destination
                    (Gemini Live, 24kHz, 16-bit PCM)

Ducking: voice speaking → bgmGain ramps to 0.05 (200ms)
         voice stops   → bgmGain ramps to 0.15 (200ms)
```

- Single shared AudioContext for all audio (useAudioMixer hook)
- GainNode.linearRampToValueAtTime for smooth ducking
- BGM 404 handled gracefully (no crash, no music for that scene)
- Voice guide failure shows toast, experience continues with BGM only

## Voice Guide Behavior

- System prompt: brief 1-2 sentence welcome, then STOP and WAIT for user
- Initial trigger sent via `send_realtime_input(text=...)` after session connects
- Canvas frames sent at 1 FPS so guide can reference what user sees
- Scene changes notified to guide via text message

## Pipeline Flow

```
Text → POST /generations → backend runs full pipeline as background task:
     → Extract scenes (Gemini) → includes music_description per scene
     → Build worlds (Marble, parallel) + Generate BGM (Lyria 3, parallel)
     → Poll worlds until ready → store BGM paths on scenes
     → Frontend polls GET /generations/:id for status updates
     → Processing page shows: extracting → building worlds + music → polling → ready
     → "Enter World" gate → BGM auto-starts + voice guide connects
```

## Conventions

- Backend is Python (FastAPI + httpx + google-genai), SQLite for persistence
- Frontend is React + THREE.js + SparkJS (@sparkjsdev/spark) for Gaussian splat rendering
- Frontend uses Vite proxy (`/api/*` → `localhost:8002`) on localhost; auto-detects LAN/tunnel and hits backend directly on port 8002
- All API keys loaded from root `.env` via python-dotenv
- Never commit `.env` or API keys
- Use `Marble 0.1-mini` for testing (not plus) — cheaper
- Named Cloudflare Tunnel for stable backend URL
- Frontend deployed on Vercel, talks to backend via `VITE_API_URL`
