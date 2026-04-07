"""Diagnostics helpers for Marble world selection and prompt analysis."""

from __future__ import annotations

import re
from typing import Any, Optional

SPZ_TIER_ORDER = ("full_res", "500k", "100k")

SHOT_TERMS = (
    "close-up",
    "close up",
    "macro",
    "portrait",
    "detail shot",
    "tight shot",
    "zoomed in",
)

LAYOUT_TERMS = (
    "left",
    "right",
    "center",
    "middle",
    "foreground",
    "background",
    "behind",
    "beyond",
    "near",
    "far",
    "along",
    "against",
    "beneath",
    "under",
    "above",
    "below",
    "surrounding",
    "around",
    "leading to",
    "at the end",
)

BOUNDARY_TERMS = (
    "room",
    "hall",
    "corridor",
    "floor",
    "ceiling",
    "wall",
    "walls",
    "window",
    "windows",
    "door",
    "doorway",
    "sky",
    "horizon",
    "courtyard",
    "cliff",
    "street",
    "alley",
    "shore",
    "field",
    "forest",
    "moor",
)

PROP_TERMS = (
    "table",
    "chair",
    "desk",
    "lamp",
    "bottle",
    "shelf",
    "shelves",
    "counter",
    "door",
    "window",
    "fireplace",
    "hearth",
    "bed",
    "couch",
    "stool",
    "cabinet",
    "trees",
    "bushes",
    "rocks",
    "statue",
)


def normalize_spz_urls(spz_urls: Any) -> dict[str, str]:
    if not isinstance(spz_urls, dict):
        return {}
    return {
        str(key): str(value)
        for key, value in spz_urls.items()
        if key and isinstance(value, str) and value
    }


def select_spz_url(spz_urls: Any, preferred_tier: Optional[str] = None) -> tuple[Optional[str], Optional[str]]:
    urls = normalize_spz_urls(spz_urls)
    if not urls:
        return None, None

    tiers: list[str] = []
    if preferred_tier:
        tiers.append(preferred_tier)
    tiers.extend(SPZ_TIER_ORDER)

    seen: set[str] = set()
    for tier in tiers:
        if tier in seen:
            continue
        seen.add(tier)
        if tier in urls:
            return urls[tier], tier

    first_key = next(iter(urls))
    return urls[first_key], first_key


def source_excerpt(text: Optional[str], limit: int = 220) -> str:
    if not text:
        return ""
    collapsed = re.sub(r"\s+", " ", text).strip()
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[: limit - 1].rstrip() + "…"


def _term_hits(text: str, terms: tuple[str, ...]) -> int:
    return sum(1 for term in terms if term in text)


def _word_count(text: str) -> int:
    return len(re.findall(r"\b[\w'-]+\b", text))


def analyze_prompt(
    extracted_prompt: Optional[str],
    caption: Optional[str] = None,
    world_prompt_text: Optional[str] = None,
) -> dict[str, Any]:
    extracted = (extracted_prompt or "").strip()
    normalized = re.sub(r"\s+", " ", extracted.lower())
    word_count = _word_count(extracted)
    sentence_count = len([part for part in re.split(r"[.!?]+", extracted) if part.strip()])
    comma_count = extracted.count(",")
    layout_hits = _term_hits(normalized, LAYOUT_TERMS)
    boundary_hits = _term_hits(normalized, BOUNDARY_TERMS)
    prop_hits = _term_hits(normalized, PROP_TERMS)
    shot_like = any(term in normalized for term in SHOT_TERMS)
    weak_topology = layout_hits < 2
    missing_enclosure = boundary_hits == 0
    object_vignette = shot_like or ("doorway" in normalized and boundary_hits < 2)
    prop_heavy = comma_count >= 4 and layout_hits < 2

    warnings: list[str] = []
    if shot_like:
        warnings.append("shot-like framing")
    if object_vignette:
        warnings.append("object vignette")
    if weak_topology:
        warnings.append("weak topology")
    if missing_enclosure:
        warnings.append("missing enclosure")
    if prop_heavy:
        warnings.append("prop-heavy layout")

    world_prompt_words = _word_count(world_prompt_text or "")
    recaption_ratio = round(world_prompt_words / word_count, 2) if word_count and world_prompt_words else None
    if recaption_ratio and recaption_ratio >= 1.35:
        warnings.append("large recaption expansion")

    return {
        "warnings": warnings,
        "metrics": {
            "word_count": word_count,
            "sentence_count": sentence_count,
            "comma_count": comma_count,
            "layout_hits": layout_hits,
            "boundary_hits": boundary_hits,
            "prop_hits": prop_hits,
            "recaption_ratio": recaption_ratio,
        },
        "comparisons": {
            "extracted_prompt": extracted_prompt,
            "caption": caption,
            "world_prompt_text": world_prompt_text,
        },
    }
