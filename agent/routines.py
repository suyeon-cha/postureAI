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
import os
import random
from pathlib import Path
from typing import Any

import yaml

# Pin the circuit to one exact move list regardless of what the user picked.
# Empty (the default) means normal composition. Blunt instrument — prefer
# DEMO_RECIPES, which still responds to the check-in.
DEMO_MOVES: list[str] = [
    m.strip()
    for m in os.environ.get("FLOWRESET_DEMO_MOVES", "").split(",")
    if m.strip()
]

# Fixed circuits for the demo, keyed by the exact set of areas checked in plus
# whether the user can stand.
#
# The composer is already deterministic in its *ranking* — the plan never comes
# from model prose — but it shuffles the tail of a round when no seed is given,
# so the same check-in can yield a different order twice running. On a demo we
# want the workout to be the same every rehearsal and every take, and we want to
# know exactly which moves the camera will be asked to judge.
#
# Seated variants drop the lunge: it is `seated_ok: false` in the library, and
# substituting silently would be worse than choosing a different move on purpose.
DEMO_RECIPES: dict[tuple[frozenset, bool], list[str]] = {
    # The headline demo: two upper-body holds, then the full-body move we coach.
    # The lunge carries `sides: 2`, so one entry already means both legs.
    #
    # Both the standing and seated keys give the same circuit, because the demo
    # should not change shape depending on which toggle was tapped. Note this
    # means the seated path prescribes the lunge, which the library marks
    # `seated_ok: false` — deliberate for the demo, wrong for a real seated user.
    (frozenset({"neck_shoulders", "legs_glutes"}), True): [
        "neck_side_stretch", "trap_stretch", "lunge",
    ],
    (frozenset({"neck_shoulders", "legs_glutes"}), False): [
        "neck_side_stretch", "trap_stretch", "lunge",
    ],
    (frozenset({"neck_shoulders"}), True): [
        "neck_side_stretch", "trap_stretch", "shoulder_rolls",
    ],
    (frozenset({"neck_shoulders"}), False): [
        "neck_side_stretch", "trap_stretch", "shoulder_rolls",
    ],
    (frozenset({"legs_glutes"}), True): [
        "lunge", "chair_squat", "calf_raise",
    ],
    (frozenset({"legs_glutes"}), False): [
        "glute_squeeze", "seated_twist", "calf_raise",
    ],
}

# Recipes are on by default; set FLOWRESET_DETERMINISTIC=0 to fall back to the
# composer for exploratory use.
DETERMINISTIC = os.environ.get("FLOWRESET_DETERMINISTIC", "1") not in ("0", "false", "")


def demo_recipe(areas: list[str], can_stand: bool) -> list[str] | None:
    """The pinned circuit for this check-in, or None to let the composer decide."""
    if not DETERMINISTIC:
        return None
    return DEMO_RECIPES.get((frozenset(areas), bool(can_stand)))

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


def _targets_for(area: str) -> list[str]:
    return SYMPTOM_TARGETS.get(area, SYMPTOM_TARGETS["general"])


def normalize_areas(
    symptom: str | None = None, symptoms: list[str] | None = None
) -> list[str]:
    """One or more check-in areas, deduped, order preserved, never empty.

    The first entry is the primary: it is what gets logged, what the knowledge
    card is fetched for, and what leads the composed circuit.
    """
    raw = list(symptoms) if symptoms else ([symptom] if symptom else [])
    areas: list[str] = []
    for area in raw:
        if area and area in SYMPTOM_TARGETS and area not in areas:
            areas.append(area)
    return areas or ["general"]


def _merged_targets(areas: list[str]) -> list[str]:
    """Interleave the per-area priority lists, best-of-each first.

    Round-robin rather than concatenation, so with two areas selected the
    second area's top target still outranks the first area's third — a
    neck+wrists check-in must not read as a neck check-in with leftovers.
    """
    lists = [_targets_for(area) for area in areas]
    merged: list[str] = []
    for rank in range(max(len(lst) for lst in lists)):
        for lst in lists:
            if rank < len(lst) and lst[rank] not in merged:
                merged.append(lst[rank])
    return merged


def _pick_distinct(
    candidates: list[tuple[str, dict[str, Any]]], areas: list[str], usable: int
) -> tuple[list[tuple[str, dict[str, Any]]], int]:
    """Choose the distinct moves of one round, rotating between the areas.

    Ranking alone is not enough once several areas are selected: the top four
    moves by merged score can all serve the first area, and the user who asked
    for neck *and* wrists gets no wrist work. So each area takes turns picking
    its own best remaining move. With a single area this reduces exactly to
    taking the ranked list in order.
    """
    queues = {
        area: sorted(
            candidates,
            key=lambda kv, a=area: (
                -_score(kv[1], _targets_for(a)),
                kv[1].get("seconds", 40),
            ),
        )
        for area in areas
    }
    order = list(areas)
    chosen: list[tuple[str, dict[str, Any]]] = []
    taken: set[str] = set()
    cost = 0
    turn = 0
    while order and len(chosen) < MAX_DISTINCT_MOVES:
        area = order[turn % len(order)]
        queue = queues[area]
        pick = None
        while queue:
            key, move = queue.pop(0)
            # Cost only grows, so a move that does not fit now never will.
            if key in taken or cost + move.get("seconds", 40) > usable:
                continue
            pick = (key, move)
            break
        if pick is None:
            order.remove(area)  # this area has nothing left that fits
            continue
        chosen.append(pick)
        taken.add(pick[0])
        cost += pick[1].get("seconds", 40)
        turn += 1
    return chosen, cost


def area_label(areas: list[str]) -> str:
    """Human label for one or more areas, kept short enough for a heading.

    Three still fit; past that the heading is summarised so it cannot run away.
    """
    labels = [SYMPTOM_LABELS.get(a, "Reset") for a in areas]
    if len(labels) <= 3:
        return " + ".join(labels)
    return f"{labels[0]} + {labels[1]} + {len(labels) - 2} more"


def compose(
    symptom: str = "general",
    duration_min: int = 3,
    can_stand: bool = True,
    intensity: str = "moderate",
    avoid: list[str] | None = None,
    seed: int | None = None,
    symptoms: list[str] | None = None,
) -> dict[str, Any]:
    """Build a routine that fits `duration_min` under the user's constraints.

    `symptoms` is the multi-select check-in: pass every area the user picked,
    best first. `symptom` remains the single-area form and the primary area.
    `avoid` lets memory steer away from moves the user rated Worse or skipped.
    `seed` makes the demo reproducible when we want it to be.
    """
    lib = load_library()
    areas = normalize_areas(symptom, symptoms)
    symptom = areas[0]
    targets = _merged_targets(areas)
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
    distinct, round_cost = _pick_distinct(candidates, areas, usable)

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

    # A pinned circuit replaces whatever was composed above, but still flows
    # through the same labelling and payload below, so the UI, the trackers and
    # the dashboard cannot tell the difference. Recipe first, then the blunt
    # global override.
    pinned = demo_recipe(areas, can_stand) or DEMO_MOVES
    if pinned:
        kept = [m for m in pinned if m in lib]
        if kept:
            moves = kept
            spent = sum(lib[m].get("seconds", 40) for m in moves)

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
        "symptom": symptom,                 # primary area: what memory logs
        "symptoms": areas,                  # (v1.3) every area checked in for
        "symptom_label": area_label(areas),
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
