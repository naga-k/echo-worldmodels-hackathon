"""SQLite persistence for Echo generations."""

import json
import sqlite3
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

DB_DIR = Path(os.path.dirname(__file__)) / "db"
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


def create_generation(gen_id: str, input_text: str) -> dict:
    conn = _get_conn()
    now = _now()
    conn.execute(
        "INSERT INTO generations (id, status, input_text, created_at, updated_at) VALUES (?, 'pending', ?, ?, ?)",
        (gen_id, input_text, now, now),
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
        SELECT id, status, title, created_at, updated_at,
               CASE WHEN scenes_json IS NOT NULL
                    THEN json_array_length(scenes_json)
                    ELSE 0 END as scene_count
        FROM generations
        ORDER BY created_at DESC
    """).fetchall()
    return [dict(r) for r in rows]
