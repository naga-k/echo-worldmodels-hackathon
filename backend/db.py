"""SQLite persistence for Echo generations and diagnostics."""

import json
import sqlite3
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

DB_DIR = Path(os.path.expanduser(os.environ.get("ECHO_DATA_DIR", "~/.echo-data")))
DB_PATH = DB_DIR / "echo.db"
AUDIO_DIR = DB_DIR / "audio"

_conn: Optional[sqlite3.Connection] = None


def _get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.execute("PRAGMA busy_timeout=5000")
    return _conn


def init_db():
    DB_DIR.mkdir(exist_ok=True)
    AUDIO_DIR.mkdir(exist_ok=True)
    conn = _get_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS generations (
            id              TEXT PRIMARY KEY,
            status          TEXT NOT NULL DEFAULT 'pending',
            title           TEXT,
            input_text      TEXT NOT NULL,
            narration_text  TEXT,
            scenes_json     TEXT,
            operations_json TEXT,
            audio_path      TEXT,
            error           TEXT,
            created_at      TEXT NOT NULL,
            updated_at      TEXT NOT NULL
        )
    """)
    _ensure_column(conn, "generations", "marble_model", "TEXT")
    _ensure_column(conn, "generations", "asset_tier", "TEXT")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS scene_diagnostics (
            generation_id           TEXT NOT NULL,
            scene_id                TEXT NOT NULL,
            classification          TEXT,
            viewer_mode             TEXT,
            asset_tier              TEXT,
            echo_screenshot_url     TEXT,
            reference_screenshot_url TEXT,
            notes                   TEXT,
            updated_at              TEXT NOT NULL,
            PRIMARY KEY (generation_id, scene_id)
        )
    """)
    conn.commit()
    # Mark any stuck generations as failed on startup
    conn.execute("""
        UPDATE generations
        SET status = 'failed', error = 'Server restarted during generation', updated_at = ?
        WHERE status NOT IN ('completed', 'failed', 'pending')
    """, (_now(),))
    conn.commit()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str):
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def create_generation(
    gen_id: str,
    input_text: str,
    marble_model: Optional[str] = None,
    asset_tier: Optional[str] = None,
) -> dict:
    conn = _get_conn()
    now = _now()
    conn.execute(
        """
        INSERT INTO generations (id, status, input_text, marble_model, asset_tier, created_at, updated_at)
        VALUES (?, 'pending', ?, ?, ?, ?, ?)
        """,
        (gen_id, input_text, marble_model, asset_tier, now, now),
    )
    conn.commit()
    return get_generation(gen_id)


def get_generation(gen_id: str) -> Optional[dict]:
    conn = _get_conn()
    row = conn.execute("SELECT * FROM generations WHERE id = ?", (gen_id,)).fetchone()
    if not row:
        return None
    d = dict(row)
    d["scenes"] = json.loads(d["scenes_json"]) if d["scenes_json"] else []
    d["operations"] = json.loads(d["operations_json"]) if d["operations_json"] else []
    d.pop("scenes_json", None)
    d.pop("operations_json", None)
    return d


def update_generation(gen_id: str, **fields):
    conn = _get_conn()
    fields["updated_at"] = _now()
    if "scenes" in fields:
        fields["scenes_json"] = json.dumps(fields.pop("scenes"))
    if "operations" in fields:
        fields["operations_json"] = json.dumps(fields.pop("operations"))
    sets = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values()) + [gen_id]
    conn.execute(f"UPDATE generations SET {sets} WHERE id = ?", vals)
    conn.commit()


def list_generations() -> list[dict]:
    conn = _get_conn()
    rows = conn.execute("""
        SELECT id, status, title, marble_model, asset_tier, created_at, updated_at,
               CASE WHEN scenes_json IS NOT NULL
                    THEN json_array_length(scenes_json)
                    ELSE 0 END as scene_count
        FROM generations
        ORDER BY created_at DESC
    """).fetchall()
    return [dict(r) for r in rows]


def get_scene_diagnostics(generation_id: str) -> dict[str, dict]:
    conn = _get_conn()
    rows = conn.execute(
        """
        SELECT generation_id, scene_id, classification, viewer_mode, asset_tier,
               echo_screenshot_url, reference_screenshot_url, notes, updated_at
        FROM scene_diagnostics
        WHERE generation_id = ?
        """,
        (generation_id,),
    ).fetchall()
    return {row["scene_id"]: dict(row) for row in rows}


def upsert_scene_diagnostic(generation_id: str, scene_id: str, **fields) -> dict:
    conn = _get_conn()
    fields["updated_at"] = _now()
    existing = conn.execute(
        "SELECT * FROM scene_diagnostics WHERE generation_id = ? AND scene_id = ?",
        (generation_id, scene_id),
    ).fetchone()

    if existing:
        sets = ", ".join(f"{key} = ?" for key in fields)
        conn.execute(
            f"UPDATE scene_diagnostics SET {sets} WHERE generation_id = ? AND scene_id = ?",
            list(fields.values()) + [generation_id, scene_id],
        )
    else:
        columns = ["generation_id", "scene_id", *fields.keys()]
        placeholders = ", ".join("?" for _ in columns)
        conn.execute(
            f"INSERT INTO scene_diagnostics ({', '.join(columns)}) VALUES ({placeholders})",
            [generation_id, scene_id, *fields.values()],
        )
    conn.commit()
    return get_scene_diagnostics(generation_id).get(scene_id, {})


def list_generation_diagnostics(limit: int = 25, completed_only: bool = True) -> list[dict]:
    generations = list_generations()
    if completed_only:
        generations = [gen for gen in generations if gen["status"] == "completed"]
    generations = generations[:limit]

    conn = _get_conn()
    rows = conn.execute(
        """
        SELECT generation_id, classification, COUNT(*) as count
        FROM scene_diagnostics
        GROUP BY generation_id, classification
        """
    ).fetchall()
    counts: dict[str, dict[str, int]] = {}
    for row in rows:
        generation_id = row["generation_id"]
        classification = row["classification"] or "unclassified"
        counts.setdefault(generation_id, {})[classification] = row["count"]

    for generation in generations:
        classification_counts = counts.get(generation["id"], {})
        generation["classification_counts"] = classification_counts
        generation["classified_count"] = sum(
            count for key, count in classification_counts.items() if key != "unclassified"
        )
    return generations
