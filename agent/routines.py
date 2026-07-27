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

# The teaching layer, kept separate from the safety boundary on purpose:
# exercises.yaml gates what may be prescribed, muscles.yaml only says what to
# feel while doing it. A move with no muscle entry still works — it just
# teaches nothing.
MUSCLES_PATH = Path(__file__).with_name("muscles.yaml")

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
    "general": "General",  # the UI appends " reset" — "General reset reset" otherwise
}

# A closer that costs little and reliably lands well.
CLOSER = "box_breath"

# A reset is a few movements done properly, repeated — not a long list skimmed
# once. Four is the ceiling on distinct exercises regardless of duration; extra
# time buys more rounds of the same four, which is also what actually builds
# the mind-muscle connection the coaching is for.
MAX_DISTINCT_MOVES = 4
MAX_ROUNDS = 4


class NoApprovedRoutine(ValueError):
    """Raised when constraints admit no safe move — we say so, we don't improvise."""


@functools.lru_cache(maxsize=1)
def load_library() -> dict[str, dict[str, Any]]:
    with LIBRARY_PATH.open() as fh:
        raw = yaml.safe_load(fh) or {}
    return {k: v for k, v in raw.items() if not k.startswith("_")}


def move_names() -> list[str]:
    return sorted(load_library())


@functools.lru_cache(maxsize=1)
def load_muscles() -> dict[str, dict[str, Any]]:
    """Muscle map. Missing file is survivable — coaching just loses the why."""
    try:
        with MUSCLES_PATH.open() as fh:
            return yaml.safe_load(fh) or {}
    except FileNotFoundError:
        return {}


def muscles_for(key: str) -> dict[str, Any] | None:
    return load_muscles().get(key)


def describe_move(key: str) -> dict[str, Any]:
    lib = load_library()
    if key not in lib:
        raise NoApprovedRoutine(f"{key!r} is not in the approved library")
    move = dict(lib[key])
    move["key"] = key
    if entry := muscles_for(key):
        move["muscles"] = entry
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

    # Reserve room for the closer on anything 2 minutes or longer.
    reserve = lib[CLOSER]["seconds"] if duration_min >= 2 else 0
    usable = budget - reserve

    # Pick the distinct exercises first, then spend what's left on more rounds
    # of them. A 10-minute reset is four movements done properly, not thirteen
    # different ones skimmed — repetition is what builds the mind-muscle
    # connection, and a 13-item list reads as a workout, not a desk break.
    distinct: list[tuple[str, dict[str, Any]]] = []
    round_cost = 0
    for key, move in candidates:
        if len(distinct) >= MAX_DISTINCT_MOVES:
            break
        cost = move.get("seconds", 40)
        if round_cost + cost > usable:
            continue
        distinct.append((key, move))
        round_cost += cost

    if not distinct:
        # Budget smaller than the cheapest move — give the single cheapest one.
        key, move = min(candidates, key=lambda kv: kv[1].get("seconds", 40))
        distinct = [(key, move)]
        round_cost = move.get("seconds", 40)

    # Order within a round: symptom-first stays first, the rest can vary between
    # sessions. Shuffling here rather than over the final list is what stops two
    # identical moves landing back to back.
    if len(distinct) > 2 and seed is None:
        head, tail = distinct[:1], distinct[1:]
        rng.shuffle(tail)
        distinct = head + tail

    rounds = max(1, usable // round_cost) if round_cost else 1
    rounds = min(rounds, MAX_ROUNDS)

    moves = [key for _ in range(rounds) for key, _m in distinct]
    spent = round_cost * rounds

    # Leftover time: add single moves rather than a whole extra round, cheapest
    # first, still never exceeding the distinct-move cap.
    for key, move in sorted(distinct, key=lambda kv: kv[1].get("seconds", 40)):
        cost = move.get("seconds", 40)
        if spent + cost > usable or moves[-1] == key:
            continue
        moves.append(key)
        spent += cost

    if reserve:
        moves.append(CLOSER)
        spent += reserve

    # Label each entry with which set of that move it is, so the UI can say
    # "Bodyweight squat · set 2 of 3" instead of listing the same name twice
    # and looking like a bug.
    totals: dict[str, int] = {}
    for key in moves:
        totals[key] = totals.get(key, 0) + 1
    seen_count: dict[str, int] = {}
    sets: list[dict[str, int]] = []
    for key in moves:
        seen_count[key] = seen_count.get(key, 0) + 1
        sets.append({"set": seen_count[key], "of": totals[key]})

    return {
        "symptom": symptom,
        "symptom_label": SYMPTOM_LABELS.get(symptom, "Reset"),
        "duration_min": duration_min,
        "estimated_seconds": spent,
        "can_stand": can_stand,
        "intensity": intensity,
        "moves": moves,
        "sets": sets,                       # (v1.2) parallel to `moves`
        "distinct_moves": len(totals) - (1 if CLOSER in totals else 0),
        "detail": [describe_move(k) for k in moves],
        "needs_full_body": any(lib[k].get("requires_full_body") for k in moves),
        "camera_useful": any(
            lib[k].get("detection") in ("reps", "angle_hold", "tempo", "vlm_judge")
            for k in moves
        ),
    }


#: Targets that live below the torso frame.
_LOWER_BODY = {"legs", "glutes", "hips", "pelvis"}
#: Detection modes that require pose landmarks.
_POSE_DETECTION = {"reps", "angle_hold", "tempo", "vlm_judge"}


def audit_library() -> list[str]:
    """Structural rule: a seated move may not claim pose detection of the lower
    body. There are exactly two camera modes — full body, or the upper half of
    a seated person — so a seated move that works the legs has nothing visible
    to measure, and any rep it reports is invented.

    Such a move must be `timer_only`: coached by voice and countdown, honestly.
    Returns a list of violations; empty means the library is coherent.
    """
    problems = []
    for key, move in load_library().items():
        seated_only = move.get("seated_ok", True) and not move.get("requires_full_body")
        lower = _LOWER_BODY & set(move.get("targets", []))
        if seated_only and lower and move.get("detection") in _POSE_DETECTION:
            problems.append(
                f"{key}: seated but claims {move['detection']} detection of "
                f"{sorted(lower)} — not visible in the torso frame; use timer_only"
            )
    return problems


def validate(moves: list[str]) -> list[str]:
    """Drop anything the model invented. Returns only approved keys."""
    lib = load_library()
    return [m for m in moves if m in lib]
