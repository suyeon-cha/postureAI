"""Approved, local knowledge retrieval for FlowReset."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

KB_PATH = Path(__file__).with_name("knowledge.yaml")


@lru_cache(maxsize=1)
def load() -> dict[str, Any]:
    with KB_PATH.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    if data.get("review_status") != "hackathon_general_wellness":
        raise ValueError("FlowReset knowledge base is not approved for the hackathon")
    return data


def topic(area: str) -> dict[str, Any]:
    """Return one approved topic with resolved source metadata."""
    data = load()
    topics = data.get("topics", {})
    resolved_area = area if area in topics else "general"
    record = dict(topics.get(resolved_area) or {})
    sources = data.get("sources", {})
    record["area"] = resolved_area
    record["sources"] = [
        {"id": source_id, **sources[source_id]}
        for source_id in record.get("source_ids", [])
        if source_id in sources
    ]
    record.pop("source_ids", None)
    record["review_status"] = data.get("review_status")
    record["reviewed_at"] = data.get("reviewed_at")
    record["boundary"] = data.get("boundary")
    return record


def catalog() -> dict[str, Any]:
    """Public, non-user-specific content for the in-app knowledge screen."""
    data = load()
    privacy = dict(data.get("privacy", {}))
    privacy["sources"] = [
        {"id": source_id, **data["sources"][source_id]}
        for source_id in privacy.get("source_ids", [])
        if source_id in data.get("sources", {})
    ]
    privacy.pop("source_ids", None)
    return {
        "version": data.get("version"),
        "review_status": data.get("review_status"),
        "reviewed_at": data.get("reviewed_at"),
        "audience": data.get("audience"),
        "boundary": data.get("boundary"),
        "topics": [topic(key) for key in data.get("topics", {})],
        "privacy": privacy,
    }
