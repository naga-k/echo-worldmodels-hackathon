"""
Sample script to test all Echo API endpoints end-to-end.

Usage:
    1. Start the server:  cd backend && python main.py
    2. Run this script:   python test_api.py

Requires the server running on http://localhost:8002
"""

import sys
import time
import json
import httpx

BASE = "http://localhost:8002"

SAMPLE_TEXT = """
The detective's office was dimly lit by a single brass lamp on the heavy oak desk.
Rain streaked down the tall window behind venetian blinds, casting long shadows
across the checkered linoleum floor. A half-empty whiskey bottle sat next to a
stack of case files. The leather chair creaked as he stood up and grabbed his coat.

He stepped out into the narrow alley behind the building. Neon signs from the bar
across the street reflected off the wet cobblestones. A black sedan idled at the
far end, exhaust mixing with steam rising from a manhole cover. Fire escapes
zigzagged up the brick walls on either side.

The bar was loud and smoky. A long mahogany counter stretched the length of the
room, lined with red vinyl stools. Behind it, shelves of bottles glowed amber
under strip lighting. A jukebox in the corner played something slow. Booths with
cracked leather seats lined the far wall.
""".strip()


def step(name: str):
    print(f"\n{'='*60}")
    print(f"  {name}")
    print(f"{'='*60}")


def main():
    client = httpx.Client(base_url=BASE, timeout=120.0)

    # ── 1. Health check ──
    step("1. Health Check")
    r = client.get("/health")
    health = r.json()
    print(json.dumps(health, indent=2))

    if not health["apis"]["worldlabs"]:
        print("ERROR: WORLD_LABS_API_KEY not configured. Aborting.")
        sys.exit(1)

    # ── 2. Extract scenes ──
    step("2. Extract Scenes (Gemini)")
    if not health["apis"]["gemini"]:
        print("SKIP: GEMINI_API_KEY not configured. Using mock scenes.")
        scenes_data = {
            "title": "The Detective's Night",
            "narration_text": SAMPLE_TEXT,
            "scenes": [
                {
                    "id": "scene_1",
                    "title": "The Detective's Office",
                    "marble_prompt": "Dimly lit 1940s private detective office with a heavy oak desk centered in the room, brass desk lamp casting warm light, venetian blinds on a tall window with rain streaks, whiskey bottle and glass on the desk corner, wooden filing cabinets against the wall, worn leather chair, ceiling fan, checkered linoleum floor.",
                    "narration_text": SAMPLE_TEXT.split("\n\n")[0],
                    "time_start": 0.0,
                    "time_end": 0.33,
                    "camera_direction": "forward",
                    "mood": "noir",
                },
                {
                    "id": "scene_2",
                    "title": "The Dark Alley",
                    "marble_prompt": "Narrow dark alley at night between two tall brick buildings with fire escapes, wet cobblestone ground reflecting neon signs in red and blue, a black sedan parked at the far end with headlights on, steam rising from a manhole cover, puddles on the ground, urban city atmosphere.",
                    "narration_text": SAMPLE_TEXT.split("\n\n")[1],
                    "time_start": 0.33,
                    "time_end": 0.66,
                    "camera_direction": "forward",
                    "mood": "tense",
                },
                {
                    "id": "scene_3",
                    "title": "The Smoky Bar",
                    "marble_prompt": "Interior of a 1940s dive bar with a long mahogany counter with red vinyl bar stools, shelves of amber-lit liquor bottles behind the bar, a glowing jukebox in the corner, booths with cracked red leather seats along the far wall, smoky atmosphere, warm dim lighting, wooden floor.",
                    "narration_text": SAMPLE_TEXT.split("\n\n")[2],
                    "time_start": 0.66,
                    "time_end": 1.0,
                    "camera_direction": "orbit",
                    "mood": "warm",
                },
            ],
        }
    else:
        r = client.post("/extract-scenes", json={"text": SAMPLE_TEXT})
        if r.status_code != 200:
            print(f"ERROR {r.status_code}: {r.text}")
            sys.exit(1)
        scenes_data = r.json()

    print(f"Title: {scenes_data['title']}")
    print(f"Scenes extracted: {len(scenes_data['scenes'])}")
    for s in scenes_data["scenes"]:
        print(f"  - {s['id']}: {s['title']} ({s['time_start']:.2f}-{s['time_end']:.2f}) mood={s['mood']}")
        print(f"    Marble prompt: {s['marble_prompt'][:80]}...")

    # ── 3. Generate speech ──
    step("3. Generate Speech (ElevenLabs)")
    if not health["apis"]["elevenlabs"]:
        print("SKIP: ELEVEN_LABS_API not configured.")
    else:
        narration = scenes_data.get("narration_text", SAMPLE_TEXT)
        r = client.post("/generate-speech", json={"text": narration})
        if r.status_code != 200:
            print(f"ERROR {r.status_code}: {r.text}")
        else:
            with open("output.mp3", "wb") as f:
                f.write(r.content)
            print(f"Audio saved to output.mp3 ({len(r.content)} bytes)")

    # ── 4. Generate worlds ──
    step("4. Generate Worlds (Marble API)")
    scenes_payload = [
        {"id": s["id"], "marble_prompt": s["marble_prompt"]}
        for s in scenes_data["scenes"]
    ]
    r = client.post("/generate-worlds", json={"scenes": scenes_payload})
    if r.status_code != 200:
        print(f"ERROR {r.status_code}: {r.text}")
        sys.exit(1)

    gen_data = r.json()
    operations = gen_data["operations"]
    print(f"Fired {len(operations)} world generations:")
    for op in operations:
        if "error" in op:
            print(f"  - {op['scene_id']}: ERROR — {op['error']}")
        else:
            print(f"  - {op['scene_id']}: operation_id={op['operation_id']}")

    # Filter to successful operations
    valid_ops = [op for op in operations if "operation_id" in op]
    if not valid_ops:
        print("No valid operations to poll. Aborting.")
        sys.exit(1)

    # ── 5. Poll until ready ──
    step("5. Polling for Completion")
    op_ids = ",".join(op["operation_id"] for op in valid_ops)
    max_polls = 60  # 5 minutes at 5s intervals
    poll_count = 0

    while poll_count < max_polls:
        poll_count += 1
        r = client.get(f"/poll-worlds?operation_ids={op_ids}")
        if r.status_code != 200:
            print(f"Poll error {r.status_code}: {r.text}")
            time.sleep(5)
            continue

        poll_data = r.json()
        statuses = poll_data["scenes"]

        ready = sum(1 for s in statuses if s["status"] == "ready")
        failed = sum(1 for s in statuses if s["status"] == "failed")
        total = len(statuses)

        print(f"  Poll {poll_count}: {ready}/{total} ready, {failed} failed ({poll_count * 5}s elapsed)")

        for s in statuses:
            if s["status"] == "ready" and s.get("spz_url"):
                print(f"    ✓ {s['operation_id']}: {s['spz_url']}")

        if ready + failed == total:
            break

        time.sleep(5)

    # ── Summary ──
    step("Done!")
    print(f"Title: {scenes_data['title']}")
    print(f"Scenes: {len(scenes_data['scenes'])}")
    if health["apis"]["elevenlabs"]:
        print("Audio: output.mp3")
    print("SPZ URLs:")
    for s in statuses:
        status_icon = "✓" if s["status"] == "ready" else "✗"
        print(f"  {status_icon} {s['operation_id']}: {s.get('spz_url', 'N/A')}")


if __name__ == "__main__":
    main()
