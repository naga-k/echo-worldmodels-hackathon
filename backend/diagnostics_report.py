#!/usr/bin/env python3
"""Print structured Marble diagnostics from local generations or world IDs."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import urllib.request
from pathlib import Path
from urllib.error import HTTPError, URLError

from db import DB_PATH, init_db
from diagnostics import analyze_prompt, normalize_spz_urls, select_spz_url, source_excerpt


def load_local_env():
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'").strip('"'))


load_local_env()

MARBLE_BASE = "https://api.worldlabs.ai/marble/v1"


def get_connection() -> sqlite3.Connection:
    init_db()
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def get_generation_ids(conn: sqlite3.Connection, explicit_ids: list[str], limit: int) -> list[str]:
    if explicit_ids:
        return explicit_ids
    try:
        rows = conn.execute(
            """
            SELECT id
            FROM generations
            WHERE status = 'completed'
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    except sqlite3.OperationalError:
        return []
    return [row["id"] for row in rows]


def load_generation_report(conn: sqlite3.Connection, generation_id: str) -> dict:
    row = conn.execute("SELECT * FROM generations WHERE id = ?", (generation_id,)).fetchone()
    if not row:
        return {"generation_id": generation_id, "error": "generation not found"}

    generation = dict(row)
    scenes = json.loads(generation["scenes_json"]) if generation.get("scenes_json") else []
    diagnostics_rows = conn.execute(
        "SELECT * FROM scene_diagnostics WHERE generation_id = ?",
        (generation_id,),
    ).fetchall()
    diagnostics = {row["scene_id"]: dict(row) for row in diagnostics_rows}

    scene_reports = []
    for scene in scenes:
        prompt_analysis = analyze_prompt(
            scene.get("marble_prompt"),
            caption=scene.get("caption"),
            world_prompt_text=scene.get("world_prompt_text"),
        )
        selected_url, selected_tier = select_spz_url(scene.get("spz_urls"), scene.get("selected_spz_tier"))
        scene_reports.append({
            "scene_id": scene.get("id"),
            "title": scene.get("title"),
            "source_excerpt": source_excerpt(scene.get("narration_text") or generation.get("input_text")),
            "world_id": scene.get("world_id"),
            "model": scene.get("model") or generation.get("marble_model"),
            "selected_spz_tier": selected_tier,
            "selected_spz_url": selected_url,
            "available_spz_tiers": list(normalize_spz_urls(scene.get("spz_urls")).keys()),
            "world_marble_url": scene.get("world_marble_url"),
            "prompt_analysis": prompt_analysis,
            "diagnostic_record": diagnostics.get(scene.get("id")),
        })

    return {
        "generation_id": generation_id,
        "title": generation.get("title"),
        "status": generation.get("status"),
        "marble_model": generation.get("marble_model"),
        "asset_tier": generation.get("asset_tier"),
        "scene_count": len(scene_reports),
        "scenes": scene_reports,
    }


def fetch_world_report(world_id: str) -> dict:
    api_key = os.getenv("WORLD_LABS_API_KEY", "")
    if not api_key:
        return {"world_id": world_id, "error": "WORLD_LABS_API_KEY not configured"}

    request = urllib.request.Request(
        f"{MARBLE_BASE}/worlds/{world_id}",
        headers={"WLT-Api-Key": api_key},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = json.load(response)
    except HTTPError as exc:
        return {"world_id": world_id, "error": f"HTTP {exc.code}"}
    except URLError as exc:
        return {"world_id": world_id, "error": f"request failed: {exc.reason}"}

    world = data.get("world") or data
    assets = world.get("assets", {}) if isinstance(world, dict) else {}
    imagery = assets.get("imagery", {}) or {}
    splats = assets.get("splats", {}) or {}
    world_prompt = world.get("world_prompt") or {}
    world_prompt_text = world_prompt.get("text_prompt") if isinstance(world_prompt, dict) else None
    selected_url, selected_tier = select_spz_url(splats.get("spz_urls"), "full_res")

    return {
        "world_id": world_id,
        "model": world.get("model"),
        "display_name": world.get("display_name"),
        "world_marble_url": world.get("world_marble_url"),
        "pano_url": imagery.get("pano_url"),
        "thumbnail_url": assets.get("thumbnail_url"),
        "caption": assets.get("caption"),
        "world_prompt_text": world_prompt_text,
        "selected_spz_tier": selected_tier,
        "selected_spz_url": selected_url,
        "available_spz_tiers": list(normalize_spz_urls(splats.get("spz_urls")).keys()),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--generation-id", action="append", default=[], help="Generation ID to inspect. Repeatable.")
    parser.add_argument("--world-id", action="append", default=[], help="World ID to inspect directly. Repeatable.")
    parser.add_argument("--limit", type=int, default=10, help="When no generation IDs are given, inspect this many recent completed generations.")
    args = parser.parse_args()

    conn = get_connection()
    generation_ids = get_generation_ids(conn, args.generation_id, args.limit)
    report = {
        "generations": [load_generation_report(conn, generation_id) for generation_id in generation_ids],
        "worlds": [fetch_world_report(world_id) for world_id in args.world_id],
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
