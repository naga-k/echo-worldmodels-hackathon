import os
import json
import asyncio
import hashlib
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

import base64

# Load env BEFORE importing db (db reads ECHO_DATA_DIR at import time)
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from db import (
    init_db,
    create_generation,
    get_generation,
    update_generation,
    list_generations as db_list_generations,
    list_generation_diagnostics,
    get_scene_diagnostics,
    upsert_scene_diagnostic,
    AUDIO_DIR,
)
from diagnostics import analyze_prompt, normalize_spz_urls, select_spz_url, source_excerpt

import httpx
from google import genai
from google.genai import types as genai_types
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, FileResponse
from pydantic import BaseModel

# ─── File-based cache ───
# Caches API responses to disk so repeated calls during dev are instant.
# Set CACHE_ENABLED=false in .env to disable.

CACHE_DIR = Path(os.path.dirname(__file__)) / ".cache"
CACHE_ENABLED = os.getenv("CACHE_ENABLED", "true").lower() != "false"


def _cache_key(*parts: str) -> str:
    raw = "|".join(parts)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def cache_get_json(prefix: str, key: str) -> Optional[dict]:
    if not CACHE_ENABLED:
        return None
    path = CACHE_DIR / f"{prefix}_{key}.json"
    if path.exists():
        print(f"  [cache hit] {prefix}_{key}")
        return json.loads(path.read_text())
    return None


def cache_set_json(prefix: str, key: str, data: dict):
    if not CACHE_ENABLED:
        return
    CACHE_DIR.mkdir(exist_ok=True)
    path = CACHE_DIR / f"{prefix}_{key}.json"
    path.write_text(json.dumps(data))


def cache_get_bytes(prefix: str, key: str) -> Optional[bytes]:
    if not CACHE_ENABLED:
        return None
    path = CACHE_DIR / f"{prefix}_{key}.bin"
    if path.exists():
        print(f"  [cache hit] {prefix}_{key}")
        return path.read_bytes()
    return None


def cache_set_bytes(prefix: str, key: str, data: bytes):
    if not CACHE_ENABLED:
        return
    CACHE_DIR.mkdir(exist_ok=True)
    path = CACHE_DIR / f"{prefix}_{key}.bin"
    path.write_bytes(data)


def _worlds_cache_key(scenes: list[Any], model: str, asset_tier: str) -> str:
    prompt_parts = []
    for scene in scenes:
        if isinstance(scene, dict):
            prompt_parts.append(scene.get("marble_prompt", ""))
        else:
            prompt_parts.append(scene.marble_prompt)
    return _cache_key("worlds", model, asset_tier, *prompt_parts)


def _poll_cache_key(operation_ids: list[str], asset_tier: str) -> str:
    return _cache_key("poll", asset_tier, *sorted(operation_ids))


def _extract_world_id(data: dict) -> Optional[str]:
    metadata = data.get("metadata") or {}
    if metadata.get("world_id"):
        return metadata["world_id"]
    response = data.get("response") or data.get("result") or {}
    if isinstance(response, dict):
        if response.get("world_id"):
            return response["world_id"]
        marble_url = response.get("world_marble_url")
        if isinstance(marble_url, str) and marble_url.rstrip("/"):
            return marble_url.rstrip("/").split("/")[-1]
    return None


def _world_asset_metadata(world: dict) -> dict:
    assets = world.get("assets", {}) if isinstance(world, dict) else {}
    mesh = assets.get("mesh", {}) or {}
    imagery = assets.get("imagery", {}) or {}
    splats = assets.get("splats", {}) or {}
    spz_urls = normalize_spz_urls(splats.get("spz_urls"))
    world_prompt = world.get("world_prompt") or {}
    world_prompt_text = world_prompt.get("text_prompt") if isinstance(world_prompt, dict) else None
    selected_spz_url, selected_spz_tier = select_spz_url(spz_urls, DEFAULT_SPZ_TIER)
    return {
        "world_id": world.get("world_id"),
        "model": world.get("model"),
        "world_marble_url": world.get("world_marble_url"),
        "thumbnail_url": assets.get("thumbnail_url"),
        "pano_url": imagery.get("pano_url"),
        "caption": assets.get("caption"),
        "world_prompt_text": world_prompt_text,
        "spz_urls": spz_urls,
        "spz_url": selected_spz_url,
        "selected_spz_tier": selected_spz_tier,
        "collider_mesh_url": mesh.get("collider_mesh_url"),
        "semantics": splats.get("semantics_metadata"),
    }


async def _fetch_world_metadata(client: httpx.AsyncClient, world_id: str) -> dict:
    key = _cache_key(world_id)
    cached = cache_get_json("worldmeta", key)
    if cached:
        return cached

    response = await client.get(
        f"{MARBLE_BASE}/worlds/{world_id}",
        headers={"WLT-Api-Key": WORLD_LABS_API_KEY},
    )
    if response.status_code != 200:
        raise HTTPException(response.status_code, f"World metadata error: {response.text}")

    data = response.json()
    world = data.get("world") or data
    cache_set_json("worldmeta", key, world)
    return world


def _augment_generation_for_diagnostics(generation: dict) -> dict:
    diagnostics = get_scene_diagnostics(generation["id"])
    classification_counts: dict[str, int] = {}
    for scene in generation.get("scenes", []):
        diagnostic_record = diagnostics.get(scene["id"])
        world_prompt_text = scene.get("world_prompt_text")
        prompt_analysis = analyze_prompt(
            scene.get("marble_prompt"),
            caption=scene.get("caption"),
            world_prompt_text=world_prompt_text,
        )
        if diagnostic_record and diagnostic_record.get("classification"):
            key = diagnostic_record["classification"]
            classification_counts[key] = classification_counts.get(key, 0) + 1
        scene["diagnostic_record"] = diagnostic_record
        scene["prompt_analysis"] = prompt_analysis
        scene["source_excerpt"] = source_excerpt(scene.get("narration_text") or generation.get("input_text"))

    generation["diagnostics_summary"] = {
        "scene_count": len(generation.get("scenes", [])),
        "classified_count": sum(classification_counts.values()),
        "classification_counts": classification_counts,
    }
    return generation


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
    init_db()
    print("✅ Database initialized")
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
DEFAULT_MARBLE_MODEL = os.getenv("DEFAULT_MARBLE_MODEL", "Marble 0.1-mini")
DEFAULT_SPZ_TIER = os.getenv("DEFAULT_SPZ_TIER", "full_res")

MARBLE_BASE = "https://api.worldlabs.ai/marble/v1"
ELEVENLABS_BASE = "https://api.elevenlabs.io/v1"
# ElevenLabs "Adam" voice - good narrative voice
ELEVENLABS_VOICE_ID = "pNInz6obpgDQGcFmaJgB"

gemini_client = genai.Client(
    http_options={"api_version": "v1alpha"},
    api_key=GEMINI_API_KEY,
) if GEMINI_API_KEY else None


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
    model: Optional[str] = DEFAULT_MARBLE_MODEL
    asset_tier: Optional[str] = DEFAULT_SPZ_TIER

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "scenes": [
                        {
                            "id": "scene_1",
                            "marble_prompt": "Dimly lit 1940s private detective office with a heavy oak desk, brass desk lamp, venetian blinds, rain-streaked window, whiskey bottle on the desk corner, wooden filing cabinets, worn leather chair, checkered linoleum floor.",
                        }
                    ],
                    "model": DEFAULT_MARBLE_MODEL,
                    "asset_tier": DEFAULT_SPZ_TIER,
                }
            ]
        }
    }


class CreateGenerationRequest(BaseModel):
    text: str
    model: Optional[str] = DEFAULT_MARBLE_MODEL
    asset_tier: Optional[str] = DEFAULT_SPZ_TIER


class DiagnosticUpdateRequest(BaseModel):
    classification: Optional[str] = None
    viewer_mode: Optional[str] = None
    asset_tier: Optional[str] = None
    echo_screenshot_url: Optional[str] = None
    reference_screenshot_url: Optional[str] = None
    notes: Optional[str] = None


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
- music_description: A short description of instrumental background music for this scene. Include genre, instruments, mood, tempo. Always end with "Instrumental only, no vocals."

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
      "mood": "...",
      "music_description": "Slow jazz piano with muted trumpet, smoky noir atmosphere, medium-slow tempo. Instrumental only, no vocals."
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

    key = _cache_key(req.text)
    cached = cache_get_json("extract", key)
    if cached:
        return cached

    try:
        # Run sync Gemini client in thread pool to avoid blocking event loop
        response = await asyncio.to_thread(
            gemini_client.models.generate_content,
            model="gemini-3-flash-preview",
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

        cache_set_json("extract", key, result)
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
    key = _cache_key(req.text, voice_id)
    cached = cache_get_bytes("speech", key)
    if cached:
        return Response(
            content=cached,
            media_type="audio/mpeg",
            headers={"Content-Disposition": "inline; filename=narration.mp3"},
        )

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

        cache_set_bytes("speech", key, response.content)
        return Response(
            content=response.content,
            media_type="audio/mpeg",
            headers={"Content-Disposition": "inline; filename=narration.mp3"},
        )


# ─── BGM generation via Lyria 3 Clip ───

BGM_DIR = AUDIO_DIR


async def generate_bgm(generation_id: str, scene_id: str, music_description: str) -> Optional[str]:
    """Generate background music for a scene using Lyria 3 Clip.

    Returns the file path on success, None on failure.
    """
    if not gemini_client or not music_description:
        return None

    # Ensure prompt ends with the instrumental-only instruction
    prompt = music_description.strip()
    if not prompt.endswith("Instrumental only, no vocals."):
        prompt = f"{prompt} Instrumental only, no vocals."

    cache_key = _cache_key(prompt)
    cached = cache_get_bytes("bgm", cache_key)

    if cached is None:
        try:
            response = await asyncio.to_thread(
                gemini_client.models.generate_content,
                model="lyria-3-clip-preview",
                contents=prompt,
                config={
                    "response_modalities": ["AUDIO"],
                },
            )

            # Extract audio bytes from response
            audio_data = None
            if response.candidates and len(response.candidates) > 0:
                candidate = response.candidates[0]
                if candidate.content and candidate.content.parts:
                    for part in candidate.content.parts:
                        if part.inline_data and part.inline_data.data:
                            audio_data = part.inline_data.data
                            break

            if not audio_data:
                print(f"[bgm] No audio data in Lyria response for {scene_id}")
                return None

            cache_set_bytes("bgm", cache_key, audio_data)

        except Exception as e:
            print(f"[bgm] Lyria generation failed for {scene_id}: {e}")
            return None
    else:
        audio_data = cached

    # Save to db/audio/
    try:
        BGM_DIR.mkdir(parents=True, exist_ok=True)
        file_path = BGM_DIR / f"bgm_{generation_id}_{scene_id}.mp3"
        file_path.write_bytes(audio_data)
        return str(file_path)
    except Exception as e:
        print(f"[bgm] Failed to save BGM file for {scene_id}: {e}")
        return None


# ─── POST /generate-worlds ───

async def _generate_single_world(
    client: httpx.AsyncClient, scene_id: str, marble_prompt: str, model: str = DEFAULT_MARBLE_MODEL
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
            "model": model,
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

    return {"scene_id": scene_id, "operation_id": operation_id, "requested_model": model}


@app.post("/generate-worlds", tags=["Pipeline"], summary="Generate 3D worlds for all scenes",
           description="Fires parallel Marble API requests for each scene. Returns operation IDs for polling.")
async def generate_worlds(req: GenerateWorldsRequest):
    if not req.scenes:
        raise HTTPException(400, "At least one scene is required")
    if not WORLD_LABS_API_KEY:
        raise HTTPException(500, "WORLD_LABS_API_KEY not configured")

    model = req.model or DEFAULT_MARBLE_MODEL
    asset_tier = req.asset_tier or DEFAULT_SPZ_TIER
    key = _worlds_cache_key(req.scenes, model, asset_tier)
    cached = cache_get_json("worlds", key)
    if cached:
        return cached

    async with httpx.AsyncClient(timeout=120.0) as client:
        tasks = [
            _generate_single_world(client, scene.id, scene.marble_prompt, model)
            for scene in req.scenes
        ]
        results = await asyncio.gather(*tasks)

    result = {"operations": results, "model": model, "asset_tier": asset_tier}
    cache_set_json("worlds", key, result)
    return result


# ─── GET /poll-worlds ───

def _extract_spz_urls(data: dict) -> dict[str, str]:
    """Try multiple paths to find all SPZ URLs in a Marble response."""
    response = data.get("response") or data.get("result") or data

    if isinstance(response, dict):
        assets = response.get("assets", {})
        splats = assets.get("splats", {})
        spz_urls = normalize_spz_urls(splats.get("spz_urls"))
        if spz_urls:
            return spz_urls

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
                return {"legacy": obj}

    return {}


async def _poll_operation_status(
    client: httpx.AsyncClient,
    operation_id: str,
    selected_asset_tier: str,
) -> dict:
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
        world_id = _extract_world_id(data)
        world = None
        if world_id:
            try:
                world = await _fetch_world_metadata(client, world_id)
            except Exception as e:
                print(f"[poll-worlds] Failed to fetch world metadata for {world_id}: {e}")

        if world:
            metadata = _world_asset_metadata(world)
            selected_spz_url, selected_spz_tier = select_spz_url(
                metadata.get("spz_urls"),
                selected_asset_tier,
            )
        else:
            spz_urls = _extract_spz_urls(data)
            selected_spz_url, selected_spz_tier = select_spz_url(spz_urls, selected_asset_tier)
            metadata = {
                "world_id": world_id,
                "model": None,
                "world_marble_url": None,
                "thumbnail_url": None,
                "pano_url": None,
                "caption": None,
                "world_prompt_text": None,
                "spz_urls": spz_urls,
                "collider_mesh_url": None,
                "semantics": None,
            }
        return {
            "operation_id": operation_id,
            "status": "ready",
            "spz_url": selected_spz_url,
            "selected_spz_tier": selected_spz_tier,
            **metadata,
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


@app.get("/poll-worlds", tags=["Pipeline"], summary="Poll world generation status",
         description="Checks status of one or more Marble generation operations. Returns status and SPZ URLs for completed worlds.")
async def poll_worlds(operation_ids: str, asset_tier: Optional[str] = None):
    if not operation_ids.strip():
        raise HTTPException(400, "operation_ids query parameter is required")
    if not WORLD_LABS_API_KEY:
        raise HTTPException(500, "WORLD_LABS_API_KEY not configured")

    ids = [oid.strip() for oid in operation_ids.split(",") if oid.strip()]

    selected_asset_tier = asset_tier or DEFAULT_SPZ_TIER
    key = _poll_cache_key(ids, selected_asset_tier)
    cached = cache_get_json("poll", key)
    if cached:
        return cached

    async with httpx.AsyncClient(timeout=30.0) as client:
        results = await asyncio.gather(
            *[_poll_operation_status(client, oid, selected_asset_tier) for oid in ids]
        )

    result = {"scenes": results}
    # Only cache when all scenes are done (ready or failed)
    all_done = all(r["status"] in ("ready", "failed") for r in results)
    if all_done:
        cache_set_json("poll", key, result)
    return result


# ─── Generations (persistent pipeline) ───

_active_pipelines: dict[str, asyncio.Task] = {}

async def _run_pipeline(gen_id: str, text: str, model: str, asset_tier: str):
    """Run the full extract → speech → worlds → poll pipeline as a background task."""
    try:
        # Step 1: Extract scenes
        update_generation(gen_id, status="extracting")
        if not gemini_client:
            raise Exception("GEMINI_API_KEY not configured")

        key = _cache_key(text)
        cached = cache_get_json("extract", key)
        if cached:
            extracted = cached
        else:
            response = await asyncio.to_thread(
                gemini_client.models.generate_content,
                model="gemini-3-flash-preview",
                contents=f"{EXTRACTION_PROMPT}\n\nInput text:\n{text}",
                config={"response_mime_type": "application/json"},
            )
            extracted = json.loads(response.text.strip())
            if "scenes" not in extracted or not extracted["scenes"]:
                raise Exception("No scenes extracted")
            cache_set_json("extract", key, extracted)

        scenes = extracted["scenes"]
        update_generation(
            gen_id,
            status="generating_speech",
            title=extracted.get("title"),
            narration_text=extracted.get("narration_text", ""),
            scenes=scenes,
        )

        # Step 2: Skip speech (narration removed)

        # Step 3: Generate worlds + BGM in parallel
        update_generation(gen_id, status="building_worlds")
        if not WORLD_LABS_API_KEY:
            raise Exception("WORLD_LABS_API_KEY not configured")

        # Build worlds task
        async def _build_worlds():
            worlds_key = _worlds_cache_key(scenes, model, asset_tier)
            cached_worlds = cache_get_json("worlds", worlds_key)
            if cached_worlds:
                return cached_worlds["operations"]
            async with httpx.AsyncClient(timeout=120.0) as client:
                tasks = [
                    _generate_single_world(client, s["id"], s["marble_prompt"], model)
                    for s in scenes
                ]
                ops = await asyncio.gather(*tasks)
            cache_set_json("worlds", worlds_key, {"operations": list(ops), "model": model, "asset_tier": asset_tier})
            return list(ops)

        # Build BGM task (all scenes in parallel)
        async def _build_all_bgm():
            bgm_tasks = [
                generate_bgm(gen_id, s["id"], s.get("music_description", ""))
                for s in scenes
            ]
            return await asyncio.gather(*bgm_tasks)

        # Fire worlds + BGM in parallel
        operations, bgm_results = await asyncio.gather(_build_worlds(), _build_all_bgm())

        # Store BGM paths on scene objects
        for i, scene in enumerate(scenes):
            bgm_path = bgm_results[i] if i < len(bgm_results) else None
            if bgm_path:
                scene["bgm_path"] = bgm_path

        op_ids = [o["operation_id"] for o in operations if "operation_id" in o]
        op_to_scene = {o["operation_id"]: o["scene_id"] for o in operations if "operation_id" in o}
        update_generation(gen_id, status="polling", operations=operations)

        # Step 4: Poll until all worlds ready
        max_attempts = 120
        for attempt in range(max_attempts):
            poll_key = _poll_cache_key(op_ids, asset_tier)
            cached_poll = cache_get_json("poll", poll_key)

            if cached_poll:
                poll_results = cached_poll["scenes"]
            else:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    poll_results = await asyncio.gather(
                        *[_poll_operation_status(client, oid, asset_tier) for oid in op_ids]
                    )
                    poll_results = list(poll_results)

            all_done = all(r["status"] in ("ready", "failed", "error") for r in poll_results)

            # Update scenes with SPZ URLs
            for pr in poll_results:
                if pr.get("spz_url"):
                    scene_id = op_to_scene.get(pr["operation_id"])
                    for s in scenes:
                        if s["id"] == scene_id:
                            s.update({
                                "spz_url": pr.get("spz_url"),
                                "selected_spz_tier": pr.get("selected_spz_tier"),
                                "spz_urls": pr.get("spz_urls"),
                                "collider_mesh_url": pr.get("collider_mesh_url"),
                                "semantics": pr.get("semantics"),
                                "world_id": pr.get("world_id"),
                                "model": pr.get("model") or model,
                                "world_marble_url": pr.get("world_marble_url"),
                                "thumbnail_url": pr.get("thumbnail_url"),
                                "pano_url": pr.get("pano_url"),
                                "caption": pr.get("caption"),
                                "world_prompt_text": pr.get("world_prompt_text"),
                            })

            update_generation(gen_id, scenes=scenes)

            if all_done:
                cache_set_json("poll", poll_key, {"scenes": poll_results})
                break

            await asyncio.sleep(5)

        update_generation(gen_id, status="completed")

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f"[pipeline] Generation {gen_id} failed: {e}\n{tb}")
        update_generation(gen_id, status="failed", error=str(e) or f"{type(e).__name__}: {tb[-200:]}")
    finally:
        _active_pipelines.pop(gen_id, None)


@app.post("/generations", tags=["Generations"], summary="Start a new generation",
          description="Creates a generation and runs the full pipeline in the background.")
async def create_generation_endpoint(req: CreateGenerationRequest):
    if not req.text.strip():
        raise HTTPException(400, "Text is required")
    model = req.model or DEFAULT_MARBLE_MODEL
    asset_tier = req.asset_tier or DEFAULT_SPZ_TIER
    gen_id = uuid.uuid4().hex[:12]
    create_generation(gen_id, req.text.strip(), marble_model=model, asset_tier=asset_tier)
    task = asyncio.create_task(_run_pipeline(gen_id, req.text.strip(), model, asset_tier))
    _active_pipelines[gen_id] = task
    return {"id": gen_id}


@app.get("/generations", tags=["Generations"], summary="List all generations",
         description="Returns a summary list of all generations for the gallery.")
async def list_generations_endpoint():
    return db_list_generations()


@app.get("/generations/{gen_id}", tags=["Generations"], summary="Get generation details",
         description="Returns full status and data for a generation.")
async def get_generation_endpoint(gen_id: str):
    gen = get_generation(gen_id)
    if not gen:
        raise HTTPException(404, "Generation not found")
    return _augment_generation_for_diagnostics(gen)


@app.get("/diagnostics/generations", tags=["Diagnostics"], summary="List diagnostics generations",
         description="Returns completed generations with diagnostics summary counts.")
async def list_diagnostics_generations(limit: int = 25, completed_only: bool = True):
    return list_generation_diagnostics(limit=limit, completed_only=completed_only)


@app.get("/diagnostics/generations/{gen_id}", tags=["Diagnostics"], summary="Get diagnostics details",
         description="Returns a generation with prompt analysis and scene diagnostics records.")
async def get_diagnostics_generation(gen_id: str):
    gen = get_generation(gen_id)
    if not gen:
        raise HTTPException(404, "Generation not found")
    return _augment_generation_for_diagnostics(gen)


@app.put("/diagnostics/generations/{gen_id}/scenes/{scene_id}", tags=["Diagnostics"], summary="Update scene diagnostics",
         description="Stores manual diagnostics annotations for a single scene.")
async def update_scene_diagnostics(gen_id: str, scene_id: str, req: DiagnosticUpdateRequest):
    gen = get_generation(gen_id)
    if not gen:
        raise HTTPException(404, "Generation not found")
    if not any(scene.get("id") == scene_id for scene in gen.get("scenes", [])):
        raise HTTPException(404, "Scene not found")

    fields = {key: value for key, value in req.model_dump().items() if value is not None}
    record = upsert_scene_diagnostic(gen_id, scene_id, **fields)
    return record


@app.get("/generations/{gen_id}/audio", tags=["Generations"], summary="Get generation audio",
         description="Serves the MP3 audio file for a generation.")
async def get_generation_audio(gen_id: str):
    audio_file = AUDIO_DIR / f"{gen_id}.mp3"
    if not audio_file.exists():
        raise HTTPException(404, "Audio not found")
    return FileResponse(audio_file, media_type="audio/mpeg")


@app.get("/generations/{gen_id}/scenes/{scene_id}/bgm", tags=["Generations"],
         summary="Get scene background music",
         description="Serves the BGM MP3 file for a specific scene in a generation.")
async def get_scene_bgm(gen_id: str, scene_id: str):
    import re
    if not re.match(r'^[a-zA-Z0-9_-]+$', gen_id) or not re.match(r'^[a-zA-Z0-9_-]+$', scene_id):
        raise HTTPException(400, "Invalid generation or scene ID")
    bgm_file = AUDIO_DIR / f"bgm_{gen_id}_{scene_id}.mp3"
    if not bgm_file.exists():
        raise HTTPException(404, "BGM not found for this scene")
    return FileResponse(bgm_file, media_type="audio/mpeg")


# ─── GET /samples ───

SAMPLES_PATH = Path(os.path.dirname(__file__)) / "db" / "samples.json"


@app.get("/samples", tags=["System"], summary="Get sample stories",
         description="Returns sample stories for the 'Or try a classic' UI.")
async def get_samples():
    if not SAMPLES_PATH.exists():
        return []
    return json.loads(SAMPLES_PATH.read_text())


# ─── System ───

@app.get("/health", tags=["System"], summary="Health check",
         description="Returns API status and which API keys are configured.")
async def health():
    cache_files = list(CACHE_DIR.glob("*")) if CACHE_DIR.exists() else []
    return {
        "status": "ok",
        "cache_enabled": CACHE_ENABLED,
        "cache_entries": len(cache_files),
        "apis": {
            "gemini": bool(GEMINI_API_KEY),
            "elevenlabs": bool(ELEVEN_LABS_API),
            "worldlabs": bool(WORLD_LABS_API_KEY),
        },
    }


@app.delete("/cache", tags=["System"], summary="Clear cache",
            description="Deletes all cached API responses.")
async def clear_cache():
    if not CACHE_DIR.exists():
        return {"cleared": 0}
    files = list(CACHE_DIR.glob("*"))
    for f in files:
        f.unlink()
    return {"cleared": len(files)}


# ─── WebSocket /ws/gemini-live ───

LIVE_SYSTEM_PROMPT = """You are Echo, a narrator and guide inside an immersive 3D story experience. \
The user has just entered a world generated from a story.

When the session begins, say ONE short sentence (under 15 words) welcoming the user to the scene. \
Then STOP IMMEDIATELY and WAIT in silence for the user to speak. Do NOT narrate the story. \
Do NOT describe the scene in detail. Do NOT keep talking. ONE sentence, then silence. \
You are a guide who speaks only when spoken to after the initial greeting.

You can see what the user sees through periodic canvas captures sent as video frames. \
Reference what you see when relevant. Keep all responses to 1-3 sentences since this is voice.

--- STORY ---
{story_text}
--- END STORY ---

The story has been divided into these scenes:
{scenes_summary}

The user is currently viewing: {current_scene_title}
Scene description: {current_scene_desc}"""


@app.websocket("/ws/gemini-live")
async def gemini_live_ws(websocket: WebSocket):
    await websocket.accept()

    if not gemini_client:
        await websocket.send_text(json.dumps({"type": "error", "message": "GEMINI_API_KEY not configured"}))
        await websocket.close()
        return

    # Receive initial config from frontend
    try:
        init_raw = await websocket.receive_text()
        cfg = json.loads(init_raw)
        story_text: str = cfg.get("story_text", "")
        scenes: list = cfg.get("scenes", [])
        current_scene_id: str = cfg.get("current_scene_id", "")
    except Exception as e:
        await websocket.send_text(json.dumps({"type": "error", "message": f"Invalid init config: {e}"}))
        await websocket.close()
        return

    # Build system instruction
    scenes_summary = "\n".join(
        f"- {s.get('title', s.get('id', ''))}: {s.get('narration_text', '')[:120]}"
        for s in scenes
    )
    current_scene = next((s for s in scenes if s.get("id") == current_scene_id), scenes[0] if scenes else {})
    system_instruction = LIVE_SYSTEM_PROMPT.format(
        story_text=story_text[:3000],
        scenes_summary=scenes_summary,
        current_scene_title=current_scene.get("title", "Unknown scene"),
        current_scene_desc=current_scene.get("narration_text", "")[:200],
    )

    live_config = genai_types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=system_instruction,
        media_resolution="MEDIA_RESOLUTION_MEDIUM",
        speech_config=genai_types.SpeechConfig(
            voice_config=genai_types.VoiceConfig(
                prebuilt_voice_config=genai_types.PrebuiltVoiceConfig(voice_name="Zephyr")
            )
        ),
        realtime_input_config=genai_types.RealtimeInputConfig(
            automatic_activity_detection=genai_types.AutomaticActivityDetection(
                disabled=False,
                start_of_speech_sensitivity=genai_types.StartSensitivity.START_SENSITIVITY_HIGH,
                end_of_speech_sensitivity=genai_types.EndSensitivity.END_SENSITIVITY_LOW,
            ),
        ),
        context_window_compression=genai_types.ContextWindowCompressionConfig(
            trigger_tokens=104857,
            sliding_window=genai_types.SlidingWindow(target_tokens=52428),
        ),
    )

    try:
        async with gemini_client.aio.live.connect(
            model="models/gemini-3.1-flash-live-preview",
            config=live_config,
        ) as session:
            await websocket.send_text(json.dumps({"type": "status", "message": "connected"}))

            # Send initial trigger to make Gemini start narrating proactively
            await session.send_realtime_input(
                text="Welcome the user to this scene in one short sentence."
            )

            async def relay_frontend_to_gemini():
                """Read frontend WebSocket messages and forward to Gemini."""
                try:
                    while True:
                        message = await websocket.receive()
                        if message["type"] == "websocket.disconnect":
                            break
                        if "bytes" in message and message["bytes"]:
                            # Binary = raw PCM 16-bit 16kHz mic audio
                            await session.send_realtime_input(
                                audio=genai_types.Blob(
                                    data=message["bytes"],
                                    mime_type="audio/pcm;rate=16000",
                                )
                            )
                        elif "text" in message and message["text"]:
                            msg = json.loads(message["text"])
                            if msg.get("type") == "frame":
                                frame_bytes = base64.b64decode(msg["data"])
                                await session.send_realtime_input(
                                    video=genai_types.Blob(
                                        data=frame_bytes,
                                        mime_type="image/jpeg",
                                    )
                                )
                            elif msg.get("type") == "scene_change":
                                new_scene = next(
                                    (s for s in scenes if s.get("id") == msg.get("scene_id")), None
                                )
                                if new_scene:
                                    ctx = (
                                        f"[Scene changed to: {new_scene.get('title', '')}. "
                                        f"{new_scene.get('narration_text', '')[:100]}]"
                                    )
                                    await session.send_realtime_input(text=ctx)
                except WebSocketDisconnect:
                    pass
                except Exception as e:
                    print(f"[gemini-live] relay_frontend_to_gemini error: {e}")

            async def relay_gemini_to_frontend():
                """Read Gemini responses and forward to frontend WebSocket."""
                try:
                    while True:
                        turn = session.receive()
                        async for response in turn:
                            # Check for interruption signal from Gemini
                            sc = response.server_content if hasattr(response, "server_content") else None
                            if sc and getattr(sc, "interrupted", False):
                                await websocket.send_text(json.dumps({
                                    "type": "interrupted",
                                    "interrupted": True,
                                }))
                            if data := response.data:
                                await websocket.send_bytes(data)
                            if text := response.text:
                                await websocket.send_text(json.dumps({
                                    "type": "transcript",
                                    "text": text,
                                }))
                except Exception as e:
                    print(f"[gemini-live] relay_gemini_to_frontend error: {e}")

            relay_task = asyncio.create_task(relay_frontend_to_gemini())
            receive_task = asyncio.create_task(relay_gemini_to_frontend())
            done, pending = await asyncio.wait(
                [relay_task, receive_task],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[gemini-live] session error: {e}")
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))
        except Exception:
            pass


if __name__ == "__main__":
    import sys
    import uvicorn
    reload = "--no-reload" not in sys.argv
    port = int(os.environ.get("PORT", 8002))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=reload)
