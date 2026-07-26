"""Routine composer — the approved-action boundary.

The model chooses *among* these routines; it never authors a movement.
Everything returned here is built from keys in exercises.yaml, so an LLM
hallucinating "do a deep backbend" cannot reach the user.

Composition is duration-driven: the same symptom yields a 1-minute reset
between meetings or a 10-minute reset at the end of the day, by spending
a time budget over moves ranked for the symptom.
"""

from __future__ import annotations

import functools
import random
from pathlib import Path
from typing import Any

import yaml

LIBRARY_PATH = Path(__file__).with_name("exercises.yaml")

# Durations the UI offers. Elva's note: this is a 1-minute *to several-minute*
# product, not a fixed microbreak.
DURATION_CHOICES_MIN = [1, 2, 3, 5, 10]

# Symptom -> the debt/target areas it maps onto, best first. The composer
# spends its budget in this order, so the first area always gets covered
# even in a 60-second reset.
SYMPTOM_TARGETS: dict[str, list[str]] = {
    "neck_shoulders": ["neck", "shoulders", "back"],
    "back_hips": ["back", "hips", "sitting"],
    "legs_glutes": ["glutes", "legs", "pelvis", "hips"],
    "wrists_hands": ["wrists", "shoulders"],
    "tired_eyes": ["eyes", "neck"],
    "general": ["sitting", "back", "shoulders", "neck"],
}

SYMPTOM_LABELS = {
    "neck_shoulders": "Neck & shoulders",
    "back_hips": "Back & hips",
    "legs_glutes": "Legs & glutes",
    "wrists_hands": "Wrists & hands",
    "tired_eyes": "Tired eyes",
    "general": "General reset",
}

# A closer that costs little and reliably lands well.
CLOSER = "box_breath"


class NoApprovedRoutine(ValueError):
    """Raised when constraints admit no safe move — we say so, we don't improvise."""


@functools.lru_cache(maxsize=1)
def load_library() -> dict[str, dict[str, Any]]:
    with LIBRARY_PATH.open() as fh:
        raw = yaml.safe_load(fh) or {}
    return {k: v for k, v in raw.items() if not k.startswith("_")}


def move_names() -> list[str]:
    return sorted(load_library())


def describe_move(key: str) -> dict[str, Any]:
    lib = load_library()
    if key not in lib:
        raise NoApprovedRoutine(f"{key!r} is not in the approved library")
    move = dict(lib[key])
    move["key"] = key
    return move


def _eligible(move: dict[str, Any], can_stand: bool, intensity: str) -> bool:
    if not can_stand and not move.get("seated_ok", True):
        return False
    if intensity == "gentle" and move.get("intensity") == "moderate":
        return False
    return True


def _score(move: dict[str, Any], targets: list[str]) -> float:
    """Rank by how early the move's targets appear in the symptom's priority list."""
    hits = [targets.index(t) for t in move.get("targets", []) if t in targets]
    if not hits:
        return -1.0
    # Best (lowest) index dominates; extra overlapping targets break ties.
    return (len(targets) - min(hits)) + 0.1 * len(hits)


def compose(
    symptom: str = "general",
    duration_min: int = 3,
    can_stand: bool = True,
    intensity: str = "moderate",
    avoid: list[str] | None = None,
    seed: int | None = None,
) -> dict[str, Any]:
    """Build a routine that fits `duration_min` under the user's constraints.

    `avoid` lets memory steer away from moves the user rated Worse or skipped.
    `seed` makes the demo reproducible when we want it to be.
    """
    lib = load_library()
    targets = SYMPTOM_TARGETS.get(symptom, SYMPTOM_TARGETS["general"])
    avoid_set = set(avoid or [])
    rng = random.Random(seed)

    budget = duration_min * 60
    candidates = [
        (key, move)
        for key, move in lib.items()
        if _eligible(move, can_stand, intensity)
        and _score(move, targets) > 0
        and key not in avoid_set
        and key != CLOSER
    ]
    if not candidates:
        # Constraints are too tight for the ranked targets — fall back to any
        # eligible gentle move rather than returning nothing.
        candidates = [
            (key, move)
            for key, move in lib.items()
            if _eligible(move, can_stand, intensity) and key != CLOSER
        ]
    if not candidates:
        raise NoApprovedRoutine(
            f"no approved move fits symptom={symptom} can_stand={can_stand} "
            f"intensity={intensity}"
        )

    candidates.sort(key=lambda kv: (-_score(kv[1], targets), kv[1].get("seconds", 40)))

    moves: list[str] = []
    spent = 0
    # Reserve room for the closer on anything 2 minutes or longer.
    reserve = lib[CLOSER]["seconds"] if duration_min >= 2 else 0

    for key, move in candidates:
        cost = move.get("seconds", 40)
        if spent + cost > budget - reserve:
            continue
        moves.append(key)
        spent += cost

    # Long sessions: cycle back through the ranked list rather than stopping
    # short. Unused moves first, and never the same move twice in a row — a
    # routine that says "glute squeeze, then glute squeeze" reads as a bug.
    guard = 0
    while spent + 25 <= budget - reserve and guard < 60:
        guard += 1
        unused = [kv for kv in candidates if kv[0] not in moves]
        pool = unused or [kv for kv in candidates if kv[0] != moves[-1]]
        if not pool:
            break
        affordable = [kv for kv in pool if spent + kv[1].get("seconds", 40) <= budget - reserve]
        if not affordable:
            break
        key, move = affordable[0] if unused else affordable[guard % len(affordable)]
        moves.append(key)
        spent += move.get("seconds", 40)

    if not moves:
        # Budget smaller than the cheapest move — give the single cheapest one.
        key, move = min(candidates, key=lambda kv: kv[1].get("seconds", 40))
        moves = [key]
        spent = move.get("seconds", 40)

    if reserve:
        moves.append(CLOSER)
        spent += reserve

    # Gentle variety across repeat sessions, without disturbing the first move
    # (which is the one that actually addresses the stated symptom).
    if len(moves) > 3 and seed is None:
        head, tail = moves[:1], moves[1:-1] if reserve else moves[1:]
        rng.shuffle(tail)
        moves = head + tail + ([CLOSER] if reserve else [])

    return {
        "symptom": symptom,
        "symptom_label": SYMPTOM_LABELS.get(symptom, "Reset"),
        "duration_min": duration_min,
        "estimated_seconds": spent,
        "can_stand": can_stand,
        "intensity": intensity,
        "moves": moves,
        "detail": [describe_move(k) for k in moves],
        "needs_full_body": any(lib[k].get("requires_full_body") for k in moves),
        "camera_useful": any(
            lib[k].get("detection") in ("reps", "angle_hold", "tempo", "vlm_judge")
            for k in moves
        ),
    }


def validate(moves: list[str]) -> list[str]:
    """Drop anything the model invented. Returns only approved keys."""
    lib = load_library()
    return [m for m in moves if m in lib]
