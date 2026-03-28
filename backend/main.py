import os
import json
import asyncio
from contextlib import asynccontextmanager
from typing import Optional

import httpx
from google import genai
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

# Load env from parent directory's .env
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    missing = []
    if not os.getenv("GEMINI_API_KEY"):
        missing.append("GEMINI_API_KEY")
    if not os.getenv("ELEVEN_LABS_API"):
        missing.append("ELEVEN_LABS_API")
    if not os.getenv("WORLD_LABS_API_KEY"):
        missing.append("WORLD_LABS_API_KEY")
    if missing:
        print(f"\n⚠️  Missing env vars: {', '.join(missing)}")
        print("   Some endpoints will return errors. Check your .env file.\n")
    yield


app = FastAPI(
    title="Echo API",
    version="0.1.0",
    description="Backend for Echo — paste a story, step inside it. Extracts scenes via Claude, generates 3D worlds via World Labs Marble, and narration audio via ElevenLabs.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
ELEVEN_LABS_API = os.getenv("ELEVEN_LABS_API", "")
WORLD_LABS_API_KEY = os.getenv("WORLD_LABS_API_KEY", "")

MARBLE_BASE = "https://api.worldlabs.ai/marble/v1"
ELEVENLABS_BASE = "https://api.elevenlabs.io/v1"
# ElevenLabs "Adam" voice - good narrative voice
ELEVENLABS_VOICE_ID = "pNInz6obpgDQGcFmaJgB"

gemini_client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None


# ─── Models ───

class ExtractRequest(BaseModel):
    text: str

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "text": "The detective's office was dimly lit, rain streaking down the window. He stepped outside into the narrow alley, neon signs reflecting off wet cobblestones."
                }
            ]
        }
    }

class SpeechRequest(BaseModel):
    text: str
    voice_id: Optional[str] = None

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "text": "The rain had not stopped for three days. From the window of his office, the detective watched the city drown.",
                    "voice_id": None,
                }
            ]
        }
    }

class ScenePrompt(BaseModel):
    id: str
    marble_prompt: str

class GenerateWorldsRequest(BaseModel):
    scenes: list[ScenePrompt]

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "scenes": [
                        {
                            "id": "scene_1",
                            "marble_prompt": "Dimly lit 1940s private detective office with a heavy oak desk, brass desk lamp, venetian blinds, rain-streaked window, whiskey bottle on the desk corner, wooden filing cabinets, worn leather chair, checkered linoleum floor.",
                        }
                    ]
                }
            ]
        }
    }


# ─── POST /extract-scenes ───

EXTRACTION_PROMPT = """You are a story-to-3D-world decomposer for the "Echo" experience platform. Given input text (a story, transcript, or description), identify 2-5 distinct physical scenes/locations mentioned or implied.

For each scene, produce:
- id: "scene_1", "scene_2", etc.
- title: Short descriptive name (3-5 words)
- source_ref: If the input text contains chapter numbers, page numbers, section headers, act/scene labels, episode numbers, or any structural markers, include them here (e.g., "Chapter 3", "Page 42", "Act II Scene 1", "Episode 4 - 12:30"). If no structural markers exist, set to null.
- marble_prompt: A prompt optimized for 3D world generation with World Labs Marble API. Be CONCRETE and PHYSICAL. Describe: the space layout, key objects and furniture with positions, materials and textures, colors, lighting conditions (direction, color, intensity), architectural features (walls, floors, ceiling, windows, doors). Do NOT include emotions, abstract concepts, character actions, or narrative. Think "what would a camera see?" Example good prompt: "Dimly lit 1940s private detective office with a heavy oak desk centered in the room, brass desk lamp casting warm light, venetian blinds on a tall window with rain streaks, whiskey bottle and glass on the desk corner, wooden filing cabinets against the wall, worn leather chair, ceiling fan, checkered linoleum floor." Example bad prompt: "A room filled with decades of secrets and the weight of unsolved cases."
- narration_text: The portion of the original input text that corresponds to this scene. Use the original wording.
- time_start: Fractional start time (0.0 to 1.0) representing when this scene starts in the narration
- time_end: Fractional end time (0.0 to 1.0) representing when this scene ends in the narration
- camera_direction: One of "forward", "left", "right", "up", "orbit" - suggests how the camera should move through the scene
- mood: A single word describing the mood/atmosphere for color grading (e.g., "noir", "warm", "eerie", "bright", "tense")

Also produce:
- title: An overall title for the experience
- narration_text: The full input text, lightly cleaned up for narration (fix grammar, remove filler words, but keep the voice and content)

Return ONLY valid JSON with this exact structure, no markdown, no explanation:
{
  "title": "...",
  "narration_text": "...",
  "scenes": [
    {
      "id": "scene_1",
      "title": "...",
      "source_ref": "Chapter 3" or null,
      "marble_prompt": "...",
      "narration_text": "...",
      "time_start": 0.0,
      "time_end": 0.45,
      "camera_direction": "forward",
      "mood": "..."
    }
  ]
}

Important:
- Scenes must cover the entire narration (time_start of first = 0.0, time_end of last = 1.0)
- Scenes must not overlap in time
- Each marble_prompt should be 2-4 sentences of pure physical description
- If the text describes only one location, still return it as a single scene
"""


@app.post("/extract-scenes", tags=["Pipeline"], summary="Extract scenes from story text",
           description="Uses Gemini to decompose input text into 2-5 distinct physical scenes with Marble-optimized prompts, timestamps, and camera directions.")
async def extract_scenes(req: ExtractRequest):
    if not req.text.strip():
        raise HTTPException(400, "Text is required")
    if not gemini_client:
        raise HTTPException(500, "GEMINI_API_KEY not configured")

    try:
        response = gemini_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=f"{EXTRACTION_PROMPT}\n\nInput text:\n{req.text}",
            config={
                "response_mime_type": "application/json",
            },
        )

        raw = response.text.strip()
        result = json.loads(raw)

        # Validate structure
        if "scenes" not in result or not isinstance(result["scenes"], list):
            raise HTTPException(500, "Invalid scene extraction: missing scenes array")
        if len(result["scenes"]) == 0:
            raise HTTPException(500, "No scenes extracted from text")

        return result

    except json.JSONDecodeError as e:
        raise HTTPException(500, f"Failed to parse Gemini response as JSON: {e}")
    except Exception as e:
        raise HTTPException(500, f"Gemini API error: {e}")


# ─── POST /generate-speech ───

@app.post("/generate-speech", tags=["Pipeline"], summary="Generate narration audio",
           description="Converts text to speech using ElevenLabs API. Returns MP3 audio bytes.")
async def generate_speech(req: SpeechRequest):
    if not req.text.strip():
        raise HTTPException(400, "Text is required")
    if not ELEVEN_LABS_API:
        raise HTTPException(501, "ELEVEN_LABS_API not configured")

    voice_id = req.voice_id or ELEVENLABS_VOICE_ID

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{ELEVENLABS_BASE}/text-to-speech/{voice_id}",
            headers={
                "xi-api-key": ELEVEN_LABS_API,
                "Content-Type": "application/json",
                "Accept": "audio/mpeg",
            },
            json={
                "text": req.text,
                "model_id": "eleven_multilingual_v2",
                "voice_settings": {
                    "stability": 0.5,
                    "similarity_boost": 0.75,
                },
            },
        )

        if response.status_code != 200:
            raise HTTPException(
                response.status_code,
                f"ElevenLabs API error: {response.text}",
            )

        return Response(
            content=response.content,
            media_type="audio/mpeg",
            headers={"Content-Disposition": "inline; filename=narration.mp3"},
        )


# ─── POST /generate-worlds ───

async def _generate_single_world(
    client: httpx.AsyncClient, scene_id: str, marble_prompt: str
) -> dict:
    """Fire a single Marble world generation request."""
    response = await client.post(
        f"{MARBLE_BASE}/worlds:generate",
        headers={
            "Content-Type": "application/json",
            "WLT-Api-Key": WORLD_LABS_API_KEY,
        },
        json={
            "display_name": f"Echo - {scene_id}",
            "world_prompt": {
                "type": "text",
                "text_prompt": marble_prompt,
            },
            "model": "Marble 0.1-mini",
        },
    )

    if response.status_code != 200:
        return {
            "scene_id": scene_id,
            "error": f"Marble API error {response.status_code}: {response.text}",
        }

    data = response.json()
    operation_id = data.get("name") or data.get("operation_id") or data.get("id")

    if not operation_id:
        return {"scene_id": scene_id, "error": "No operation ID in response"}

    return {"scene_id": scene_id, "operation_id": operation_id}


@app.post("/generate-worlds", tags=["Pipeline"], summary="Generate 3D worlds for all scenes",
           description="Fires parallel Marble API requests for each scene. Returns operation IDs for polling.")
async def generate_worlds(req: GenerateWorldsRequest):
    if not req.scenes:
        raise HTTPException(400, "At least one scene is required")
    if not WORLD_LABS_API_KEY:
        raise HTTPException(500, "WORLD_LABS_API_KEY not configured")

    async with httpx.AsyncClient(timeout=120.0) as client:
        tasks = [
            _generate_single_world(client, scene.id, scene.marble_prompt)
            for scene in req.scenes
        ]
        results = await asyncio.gather(*tasks)

    return {"operations": results}


# ─── GET /poll-worlds ───

def _extract_spz_url(data: dict) -> Optional[str]:
    """Try multiple paths to find the SPZ URL in a Marble response."""
    response = data.get("response") or data.get("result") or data

    # Direct spz_url
    if isinstance(response, dict):
        # Check assets.splats.spz_urls
        assets = response.get("assets", {})
        splats = assets.get("splats", {})
        spz_urls = splats.get("spz_urls", {})
        if spz_urls:
            # Return the first available SPZ URL (highest quality)
            for key in ["full", "500k", "100k"]:
                if key in spz_urls:
                    return spz_urls[key]
            # Fallback: return any value
            return next(iter(spz_urls.values()), None)

        # Legacy paths
        for path in ["spz_url", "world.spz_url", "output.spz_url"]:
            parts = path.split(".")
            obj = response
            for part in parts:
                if isinstance(obj, dict):
                    obj = obj.get(part)
                else:
                    obj = None
                    break
            if obj:
                return obj

    return None


@app.get("/poll-worlds", tags=["Pipeline"], summary="Poll world generation status",
         description="Checks status of one or more Marble generation operations. Returns status and SPZ URLs for completed worlds.")
async def poll_worlds(operation_ids: str):
    if not operation_ids.strip():
        raise HTTPException(400, "operation_ids query parameter is required")
    if not WORLD_LABS_API_KEY:
        raise HTTPException(500, "WORLD_LABS_API_KEY not configured")

    ids = [oid.strip() for oid in operation_ids.split(",") if oid.strip()]

    async with httpx.AsyncClient(timeout=30.0) as client:

        async def poll_one(operation_id: str) -> dict:
            response = await client.get(
                f"{MARBLE_BASE}/operations/{operation_id}",
                headers={"WLT-Api-Key": WORLD_LABS_API_KEY},
            )
            if response.status_code != 200:
                return {
                    "operation_id": operation_id,
                    "status": "error",
                    "error": f"Poll error {response.status_code}",
                    "spz_url": None,
                }

            data = response.json()

            if data.get("done") or data.get("status") == "SUCCEEDED":
                spz_url = _extract_spz_url(data)
                return {
                    "operation_id": operation_id,
                    "status": "ready",
                    "spz_url": spz_url,
                }

            if data.get("error") or data.get("status") == "FAILED":
                return {
                    "operation_id": operation_id,
                    "status": "failed",
                    "error": str(data.get("error", "Generation failed")),
                    "spz_url": None,
                }

            return {
                "operation_id": operation_id,
                "status": "generating",
                "spz_url": None,
            }

        results = await asyncio.gather(*[poll_one(oid) for oid in ids])

    return {"scenes": results}


# ─── Health check ───

@app.get("/health", tags=["System"], summary="Health check",
         description="Returns API status and which API keys are configured.")
async def health():
    return {
        "status": "ok",
        "apis": {
            "gemini": bool(GEMINI_API_KEY),
            "elevenlabs": bool(ELEVEN_LABS_API),
            "worldlabs": bool(WORLD_LABS_API_KEY),
        },
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8002, reload=True)
