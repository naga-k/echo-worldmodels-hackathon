# Echo — Step Inside Your Stories

Paste a story, step inside it. Echo transforms text into navigable 3D worlds with synchronized narration and an AI guide you can talk to.

Built at the [**World Models Hackathon**](https://luma.com/ke72olgc?tk=otndVe) (World Labs x Lovable, NYC — March 28, 2026) using World Labs Marble, Google Gemini, and ElevenLabs.

## How It Works

```
Text  -->  Gemini extracts scenes  -->  ElevenLabs narrates  -->  Marble generates 3D worlds
                                                                         |
                                                          SparkJS renders Gaussian splats
                                                                         |
                                                     Gemini Live voice chat guides you through
```

1. **Paste any story** — a book chapter, podcast transcript, or scene description
2. **Scene extraction** — Gemini decomposes the text into 2-5 distinct physical locations with Marble-optimized prompts
3. **Narration** — ElevenLabs generates voice-over audio from the original text
4. **3D world generation** — World Labs Marble API creates Gaussian splat environments for each scene in parallel
5. **Immersive experience** — Navigate the 3D worlds with WASD controls while narration plays, scenes transition automatically synced to audio timestamps
6. **Voice chat** — Talk to an AI guide (Gemini Live) that can see your scene and answer questions about the story

## Demo

Try it with public domain classics — Sherlock Holmes, Poe, Dracula, or Jules Verne are included as sample stories.

## Tech Stack

| Layer | Tech |
|-------|------|
| 3D Rendering | [SparkJS](https://www.sparkjs.dev/) (Gaussian splat renderer) + THREE.js |
| World Generation | [World Labs Marble API](https://www.worldlabs.ai/) (`Marble 0.1-mini`) |
| Scene Extraction | Google Gemini (`gemini-3-flash-preview`) with structured JSON output |
| Voice Chat | Gemini Live API with bidirectional audio + video streaming |
| Narration | ElevenLabs TTS (`eleven_multilingual_v2`, "Adam" voice) |
| Frontend | React + TypeScript + Vite + Tailwind + shadcn/ui |
| Backend | Python FastAPI + httpx + uvicorn |

## Architecture

```
worldlabs/
├── backend/             Python FastAPI server (port 8002)
│   ├── main.py          All API endpoints + WebSocket
│   ├── db/samples.json  Sample stories database
│   ├── test_api.py      End-to-end test script
│   └── requirements.txt
├── frontend/            React + SparkJS viewer (port 8080)
│   └── src/
│       ├── pages/       Index, Processing pipeline, Experience viewer
│       ├── components/  SceneViewer (3D), VoiceChatButton
│       ├── hooks/       useGeminiLive (voice chat)
│       └── lib/         API client, audio utilities
├── run.sh               Start both servers in parallel
└── .env                 API keys (not committed)
```

## Setup

### API Keys

Create a `.env` file in the project root:

```
GEMINI_API_KEY=your_gemini_key
ELEVEN_LABS_API=your_elevenlabs_key
WORLD_LABS_API_KEY=your_worldlabs_key
```

### Run

```bash
# Both servers at once
./run.sh

# Or separately:

# Backend
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py
# http://localhost:8002 — Swagger docs at /docs

# Frontend
cd frontend
npm install
npm run dev
# http://localhost:8080
```

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/extract-scenes` | POST | Gemini decomposes story text into scene JSON with Marble prompts, timestamps, camera directions |
| `/generate-speech` | POST | ElevenLabs TTS, returns MP3 audio |
| `/generate-worlds` | POST | Fires parallel Marble API requests, returns operation IDs |
| `/poll-worlds` | GET | Polls Marble operations, returns status + SPZ URLs |
| `/samples` | GET | Sample stories for the landing page |
| `/ws/gemini-live` | WebSocket | Bidirectional voice chat with Gemini Live |
| `/health` | GET | API status and key configuration |

## Pipeline Flow

```
User pastes text
    ↓
POST /extract-scenes → scene JSON (prompts, timestamps, camera dirs, moods)
    ↓                          ↓
POST /generate-speech    POST /generate-worlds (parallel per scene)
    ↓                          ↓
MP3 audio blob           GET /poll-worlds (loop until ready)
    ↓                          ↓
    └──────────────────────────┘
                ↓
    Experience page loads:
    - SparkJS renders SPZ Gaussian splats
    - Audio plays with scene transitions synced to timestamps
    - WASD/mouse navigation through 3D worlds
    - Gemini Live voice chat available via mic button
```

## Controls

| Input | Action |
|-------|--------|
| WASD | Fly through scene |
| Q / E | Move up / down |
| Mouse drag | Look around |
| Scroll | Zoom |
| Mic button | Talk to AI guide (Gemini Live) |

## Team

Built by [Naga Karumuri](https://github.com/naga-k)
