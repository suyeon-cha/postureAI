"""The FlowReset tool surface.

Seven tools, kept small on purpose so the judges
need to *see* the loop (understand → reason → call tools → act), and a wide
surface makes the trace unreadable.

Each tool is a plain function plus an Ollama/OpenAI-style JSON schema. The
agent loop in coach.py dispatches by name; the runtime adapter in runtime.py
re-exports the same registry to NemoClaw or OpenClaw without changes here.
"""

from __future__ import annotations

import time
from typing import Any, Callable

from . import knowledge, memory, routines

# Populated by server/main.py so analyze_pose can read the live perception
# state without the agent importing the camera lane (keeps lanes decoupled).
_pose_source: Callable[[], dict[str, Any]] | None = None


def bind_pose_source(fn: Callable[[], dict[str, Any]]) -> None:
    global _pose_source
    _pose_source = fn


# ─────────────────────────── implementations ───────────────────────────


def get_user_context(user_id: str = "local") -> dict[str, Any]:
    """Who this person is and what they've told us they want."""
    prefs = memory.get_prefs(user_id)
    return {
        "goal": prefs["goal"],
        "common_areas": prefs["common_areas"],
        "can_stand": prefs["can_stand"],
        "preferred_duration_min": prefs["preferred_duration_min"],
        "coach_style": prefs["coach_style"],
        "time_of_day": time.strftime("%H:%M"),
    }


def get_reset_history(user_id: str = "local", days: int = 7) -> dict[str, Any]:
    """What has actually helped this person lately."""
    return memory.summary(user_id=user_id, days=days)


def select_approved_routine(
    symptom: str = "general",
    duration_min: int = 3,
    can_stand: bool = True,
    intensity: str = "moderate",
    user_id: str = "local",
    symptoms: list[str] | None = None,
) -> dict[str, Any]:
    """Compose a routine from the approved library only.

    `symptoms` carries a multi-area check-in; `symptom` is the single-area
    form and stays the primary area.

    Moves the user rated Worse are passed as `avoid`, so memory changes the
    recommendation rather than just decorating it.
    """
    hist = memory.summary(user_id=user_id)
    plan = routines.compose(
        symptom=symptom,
        symptoms=symptoms,
        duration_min=int(duration_min),
        can_stand=bool(can_stand),
        intensity=intensity,
        avoid=hist.get("moves_to_avoid"),
    )
    return {
        "symptom": plan["symptom"],
        "symptoms": plan["symptoms"],
        "symptom_label": plan["symptom_label"],
        "duration_min": plan["duration_min"],
        "estimated_seconds": plan["estimated_seconds"],
        "moves": plan["moves"],
        "move_names": [m["name"] for m in plan["detail"]],
        "sets": plan["sets"],                       # which set of that move each entry is
        "distinct_moves": plan["distinct_moves"],
        "needs_full_body": plan["needs_full_body"],
        "camera_useful": plan["camera_useful"],
        "knowledge": knowledge.topic(plan["symptom"]),
        "avoided": hist.get("moves_to_avoid", []),
    }


def retrieve_wellness_guidance(area: str = "general") -> dict[str, Any]:
    """Retrieve approved rationale, camera checks, limitations, and sources."""
    return knowledge.topic(area)


def analyze_pose(move: str | None = None) -> dict[str, Any]:
    """Structured movement metrics from the local pose service.

    Returns geometry, never video and never landmarks-as-image. If the camera
    is off — the default — this says so rather than guessing.
    """
    if _pose_source is None:
        return {"available": False, "reason": "pose service not bound"}
    snapshot = _pose_source() or {}
    if not snapshot.get("camera_on"):
        return {
            "available": False,
            "reason": "camera is off — guidance is text only",
            "camera_on": False,
        }
    return {
        "available": True,
        "camera_on": True,
        "move": move or snapshot.get("move"),
        "framing": snapshot.get("framing", "no_person"),
        "range_quality": snapshot.get("range_quality", "unknown"),
        "pace": snapshot.get("pace", "unknown"),
        "symmetry": snapshot.get("symmetry", "unknown"),
        "reps_completed": snapshot.get("rep", 0),
        "recent_faults": snapshot.get("recent_faults", []),
    }


#: Question intents we can answer from authored copy. Matched by keyword
#: rather than by model, so a user asking "where do I feel this" gets the same
#: correct anatomy whether or not Ollama is reachable — and never gets an
#: invented one. Order matters: first match wins.
QUESTION_INTENTS: list[tuple[str, tuple[str, ...]]] = [
    ("feel", ("where", "feel", "feeling", "supposed to feel", "should i feel")),
    ("muscle", ("muscle", "muscles", "working", "target", "targeting", "which group")),
    # `why` must precede `form`: "why am I doing this" contains "am i", and
    # form's keywords are the loosest in the set, so it swallows anything left.
    ("why", ("why", "point of", "what's this for", "what is this for", "purpose")),
    ("form", ("right", "correct", "doing it right", "am i", "look ok", "how am i")),
]


def classify_question(text: str) -> str:
    """Map a free-text question onto an answerable intent. 'feel' is the default
    because it is what people actually mean when they trail off mid-stretch."""
    low = (text or "").lower()
    for intent, keys in QUESTION_INTENTS:
        if any(k in low for k in keys):
            return intent
    return "feel"


def answer_question(
    text: str, move: str | None = None, metrics: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Answer an in-session question from authored copy.

    Anatomy comes from muscles.yaml verbatim. A model that invents "you should
    feel this in your rotator cuff" is worse than saying nothing, so the model
    is never in this path — it only decides *when* the user is asking.
    """
    if not move:
        return {"answer": None, "reason": "no active move", "intent": None}
    try:
        spec = routines.describe_move(move)
    except routines.NoApprovedRoutine:
        return {"answer": None, "reason": f"{move} not approved", "intent": None}

    intent = classify_question(text)
    muscles = spec.get("muscles") or {}
    primary = muscles.get("primary") or []
    name = spec.get("name", move)

    if intent == "feel" and muscles.get("feel"):
        answer = f"You should feel {muscles['feel']}."
        if muscles.get("not_feel"):
            answer += f" Not {muscles['not_feel']}."
    elif intent == "muscle" and primary:
        listed = " and ".join(primary)
        answer = f"{name} works your {listed}."
        if muscles.get("why"):
            answer += f" {muscles['why']}"
    elif intent == "why" and muscles.get("why"):
        answer = muscles["why"]
    elif intent == "form":
        # The only intent that reads live geometry rather than the library.
        m = metrics or analyze_pose(move)
        faults = m.get("recent_faults") or []
        if faults:
            cue = spec.get("cues", {}).get(f"fault_{faults[0]}")
            answer = cue or "Ease off a little and reset your position."
        elif m.get("camera_on"):
            rng = m.get("range_quality")
            answer = (
                "Looks good — range and tempo are where they should be."
                if rng in ("good", "unknown")
                else "You're safe, but go a little further into the range if you can."
            )
        else:
            answer = f"The camera is off, so I can't see you. {spec.get('cues', {}).get('during', '')}".strip()
    else:
        answer = spec.get("cues", {}).get("during") or f"Keep going with {name}."

    return {"answer": answer, "intent": intent, "move": move, "source": "authored"}


def generate_coaching_cue(
    metrics: dict[str, Any] | None = None,
    move: str | None = None,
    style: str = "supportive",
) -> dict[str, Any]:
    """Pick the one cue worth saying, from the move's authored cue set.

    Deterministic on purpose: safety-critical form feedback comes from the
    detectors' named faults and the library's copy, not from model prose.
    The model's job is *whether and when*, not *what the correction is*.
    """
    metrics = metrics or {}
    if not move:
        return {"cue": None, "reason": "no active move"}
    try:
        spec = routines.describe_move(move)
    except routines.NoApprovedRoutine:
        return {"cue": None, "reason": f"{move} not approved"}

    cues = spec.get("cues", {})
    faults = metrics.get("recent_faults") or []

    if metrics.get("framing") in ("no_person", "torso_only") and spec.get(
        "requires_full_body"
    ):
        return {
            "cue": cues.get("fault_framing", "Step back so I can see your feet."),
            "source": "framing",
            "move": move,
        }
    for fault in faults:
        authored = cues.get(f"fault_{fault}")
        if authored:
            return {"cue": authored, "source": f"fault:{fault}", "move": move}
    if metrics.get("pace") == "too_fast" and cues.get("fault_too_fast"):
        return {"cue": cues["fault_too_fast"], "source": "pace", "move": move}
    if metrics.get("range_quality") == "small" and cues.get("fault_small_range"):
        return {"cue": cues["fault_small_range"], "source": "range", "move": move}

    return {"cue": cues.get("during"), "source": "during", "move": move}


def record_session_result(
    session_id: int,
    completed: bool = True,
    response: str | None = None,
    user_id: str = "local",
) -> dict[str, Any]:
    """Close the loop. This is the write that makes the next session smarter."""
    memory.finish_session(int(session_id), bool(completed), response)
    return {"saved": True, "session_id": int(session_id), "summary": memory.summary(user_id)}


# ────────────────────────────── registry ──────────────────────────────

REGISTRY: dict[str, Callable[..., Any]] = {
    "get_user_context": get_user_context,
    "get_reset_history": get_reset_history,
    "select_approved_routine": select_approved_routine,
    "retrieve_wellness_guidance": retrieve_wellness_guidance,
    "analyze_pose": analyze_pose,
    "generate_coaching_cue": generate_coaching_cue,
    "record_session_result": record_session_result,
}

SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_user_context",
            "description": (
                "Read the user's saved goal, usual discomfort areas, whether they "
                "can stand, preferred session length, and coach style."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_reset_history",
            "description": (
                "Read the user's private local history: how often they reset, which "
                "areas recur, what they rated better or worse, and their streak."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "days": {
                        "type": "integer",
                        "description": "Look-back window in days. Default 7.",
                    }
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "select_approved_routine",
            "description": (
                "Compose a routine from the approved exercise library, scaled to the "
                "time available and the user's constraints. This is the ONLY way to "
                "propose movements — never describe an exercise that did not come "
                "back from this tool."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symptom": {
                        "type": "string",
                        "enum": [
                            "neck_shoulders",
                            "back_hips",
                            "legs_glutes",
                            "wrists_hands",
                            "tired_eyes",
                            "general",
                        ],
                    },
                    "symptoms": {
                        "type": "array",
                        "description": (
                            "Every area the user checked in for, most important "
                            "first, when they named more than one. The routine "
                            "then rotates between them."
                        ),
                        "items": {
                            "type": "string",
                            "enum": [
                                "neck_shoulders",
                                "back_hips",
                                "legs_glutes",
                                "wrists_hands",
                                "tired_eyes",
                                "general",
                            ],
                        },
                    },
                    "duration_min": {
                        "type": "integer",
                        "description": "Minutes available: 1, 2, 3, 5 or 10.",
                    },
                    "can_stand": {"type": "boolean"},
                    "intensity": {"type": "string", "enum": ["gentle", "moderate"]},
                },
                "required": ["symptom", "duration_min"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "retrieve_wellness_guidance",
            "description": (
                "Retrieve approved rationale, camera checks, limitations, and "
                "authoritative sources for a workplace-wellness area. Use this "
                "instead of inventing health explanations."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "area": {
                        "type": "string",
                        "enum": [
                            "neck_shoulders",
                            "back_hips",
                            "legs_glutes",
                            "wrists_hands",
                            "tired_eyes",
                            "general",
                        ],
                    }
                },
                "required": ["area"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "analyze_pose",
            "description": (
                "Read structured movement metrics from the local pose service on the "
                "box: framing, range quality, pace, symmetry, rep count, recent form "
                "faults. Returns geometry only — never video."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "move": {"type": "string", "description": "Move key being performed."}
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "generate_coaching_cue",
            "description": (
                "Turn movement metrics into the single cue worth saying right now. "
                "Use this instead of writing form corrections yourself."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "move": {"type": "string"},
                    "metrics": {"type": "object"},
                    "style": {
                        "type": "string",
                        "enum": ["supportive", "concise", "energetic"],
                    },
                },
                "required": ["move"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "record_session_result",
            "description": (
                "Save how the session went to local memory so future "
                "recommendations improve."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "session_id": {"type": "integer"},
                    "completed": {"type": "boolean"},
                    "response": {
                        "type": "string",
                        "enum": ["better", "same", "worse"],
                    },
                },
                "required": ["session_id", "completed"],
            },
        },
    },
]


def call(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """Dispatch one tool call, never raising into the agent loop."""
    fn = REGISTRY.get(name)
    if fn is None:
        return {"error": f"unknown tool {name!r}", "available": sorted(REGISTRY)}
    try:
        return fn(**(arguments or {}))
    except TypeError as exc:
        return {"error": f"bad arguments for {name}: {exc}"}
    except Exception as exc:  # noqa: BLE001 - a tool fault must not kill the session
        return {"error": f"{type(exc).__name__}: {exc}"}
