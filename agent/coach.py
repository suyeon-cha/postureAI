"""FlowReset coach — the agent.

Owns the intake → plan → guide → measure loop, the trace the judges watch,
and the guardrails between a general-purpose model and a health-adjacent
product.

Consumes `event` dicts and emits `coach` messages per contracts.md §2/§3.
Every model call goes through runtime.run(), so switching to the approved
stack on the box is one environment variable, not a rewrite.
"""

from __future__ import annotations

import re
import time
from typing import Any, Callable

from . import memory, persona, routines, runtime, tools

# The intake understands typed language, not just the four cards. This is the
# cheap deterministic pass; the model still gets the raw sentence and can
# override by calling select_approved_routine with different arguments.
# Order matters: legs/glutes is checked before back/hips so "my glutes feel
# dead from sitting" doesn't get filed as a back complaint.
SYMPTOM_PATTERNS: list[tuple[str, str]] = [
    (r"\b(neck|shoulder|trap|upper back|stiff neck)\w*", "neck_shoulders"),
    (
        r"\b(glute|glutes|butt|buttock|leg|legs|thigh|quad|hamstring|knee|calf|"
        r"cross(?:ed|ing)? (?:my )?legs|dead butt|weak legs|numb leg)\w*",
        "legs_glutes",
    ),
    (r"\b(back|lower back|hip|hips|sciatic|sitting too long|pelvis)\w*", "back_hips"),
    (r"\b(wrist|hand|finger|forearm|typing|carpal)\w*", "wrists_hands"),
    (r"\b(eye|eyes|screen|headache|blurry|dry eyes|strain)\w*", "tired_eyes"),
]

# "I have 90 seconds", "got 5 min"
_MIN_RE = re.compile(r"(\d+)\s*(?:min|minute)", re.I)
_SEC_RE = re.compile(r"(\d+)\s*(?:sec|second)", re.I)

RED_FLAGS = re.compile(
    r"\b(numb|numbness|tingling|weakness|chest pain|dizzy|faint|"
    r"can't move|cant move|shooting pain|vision (?:loss|change))\w*",
    re.I,
)

_ORDINALS = {1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth", 6: "sixth"}


def _ordinal(n: int) -> str:
    return _ORDINALS.get(n, f"{n}th")


class RedFlag(Exception):
    """User described something we should not answer with a stretch routine."""


def parse_intake(text: str, prefs: dict[str, Any]) -> dict[str, Any]:
    """Deterministic first pass over the user's own words."""
    lowered = (text or "").lower()

    symptom = "general"
    for pattern, key in SYMPTOM_PATTERNS:
        if re.search(pattern, lowered):
            symptom = key
            break

    duration_min = prefs.get("preferred_duration_min", 3)
    if m := _MIN_RE.search(lowered):
        duration_min = max(1, min(10, int(m.group(1))))
    elif s := _SEC_RE.search(lowered):
        duration_min = max(1, round(int(s.group(1)) / 60))

    # A stated *ability* wins over an incidental mention of sitting. "My glutes
    # feel dead from sitting and I can stand up" is a standing session: "sitting"
    # there names the cause, not the constraint. So check ability first, and keep
    # the seated patterns to phrases that actually express a restriction.
    can_stand = prefs.get("can_stand", True)
    if re.search(
        r"\b(can stand|could stand|able to stand|can get up|can stand up|"
        r"happy to stand|standing is fine|standing'?s fine|on my feet|"
        r"don'?t mind standing)\b",
        lowered,
    ):
        can_stand = True
    elif re.search(
        r"\b(stay seated|seated only|remain seated|stay in my (?:chair|seat)|"
        r"stay at my desk|can'?t stand|cannot stand|can'?t get up|need to sit|"
        r"have to sit|without standing|on a call|in a meeting|at my desk)\b",
        lowered,
    ):
        can_stand = False

    intensity = (
        "gentle"
        if re.search(r"\b(sore|painful|hurts|tender|achy|really tight)\b", lowered)
        else "moderate"
    )

    return {
        "symptom": symptom,
        "duration_min": duration_min,
        "can_stand": can_stand,
        "intensity": intensity,
        "raw": text,
    }


class FlowResetAgent:
    """One user, one box, one loop.

    `on_trace` receives every step — model turns and tool calls — which is
    what the UI's agent trace panel renders. Nothing in the trace is
    reconstructed after the fact; it is emitted as it happens.
    """

    def __init__(
        self, user_id: str = "local", on_trace: Callable[[dict], None] | None = None
    ):
        self.user_id = user_id
        self.on_trace = on_trace
        self.trace: list[dict[str, Any]] = []
        self.session_id: int | None = None
        self.plan: dict[str, Any] | None = None
        self._last_cue: str | None = None
        self._cue_at: float = 0.0

    # ───────────────────────────── trace ─────────────────────────────

    def _emit(self, entry: dict[str, Any]) -> None:
        entry["at"] = time.strftime("%H:%M:%S")
        self.trace.append(entry)
        if self.on_trace:
            self.on_trace(entry)

    def reset_trace(self) -> None:
        self.trace = []

    # ──────────────────────────── planning ────────────────────────────

    def plan_reset(
        self, request: str, override: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Intake → tools → approved plan → explanation.

        Returns a `coach` message with a `routine` payload per contracts.md §3.
        """
        if RED_FLAGS.search(request or ""):
            self._emit({"kind": "guardrail", "rule": "red_flag_symptom", "input": request})
            raise RedFlag(persona.ESCALATION)

        prefs = memory.get_prefs(self.user_id)
        intake = parse_intake(request, prefs)
        if override:
            intake.update(override)
        self._emit({"kind": "intake", "parsed": intake})

        messages = [
            {
                "role": "system",
                "content": persona.system_prompt(
                    prefs.get("coach_style", "supportive"),
                    watch_mode=prefs.get("watch_mode", False),
                ),
            },
            {
                "role": "user",
                "content": (
                    f"{request}\n\n"
                    f"[intake parsed: area={intake['symptom']}, "
                    f"minutes={intake['duration_min']}, "
                    f"can_stand={intake['can_stand']}, "
                    f"intensity={intake['intensity']}]"
                ),
            },
        ]

        try:
            reply = runtime.run(messages, tools.SCHEMAS, on_step=self._emit)
            explanation = (reply.get("content") or "").strip()
        except Exception as exc:  # noqa: BLE001 - the demo must not die here
            self._emit({"kind": "error", "where": "runtime.run", "error": str(exc)})
            explanation = ""

        # The model may or may not have called the tool. Either way the plan we
        # *execute* comes from the composer, never from model prose.
        plan = tools.select_approved_routine(
            symptom=intake["symptom"],
            duration_min=intake["duration_min"],
            can_stand=intake["can_stand"],
            intensity=intake["intensity"],
            user_id=self.user_id,
        )
        grounding = tools.retrieve_wellness_guidance(plan["symptom"])
        plan["knowledge"] = grounding
        self._emit(
            {
                "kind": "tool",
                "name": "retrieve_wellness_guidance",
                "arguments": {"area": plan["symptom"]},
                "result": {
                    "title": grounding.get("title"),
                    "sources": [s.get("organization") for s in grounding.get("sources", [])],
                    "review_status": grounding.get("review_status"),
                },
            }
        )

        if not explanation:
            explanation = self._fallback_explanation(plan, intake)
        explanation = persona.sanitize(explanation)

        self.plan = plan
        self.session_id = None
        self._emit(
            {
                "kind": "action",
                "action": "plan_composed",
                "moves": plan["moves"],
            }
        )

        return {
            "type": "coach",
            "text": explanation,
            "speak": prefs.get("voice", True),
            "routine": {"duration_min": plan["duration_min"], "moves": plan["moves"]},
            "plan": plan,
            "session_id": self.session_id,
            "why": self._why(plan, intake),
        }

    def _fallback_explanation(self, plan: dict[str, Any], intake: dict[str, Any]) -> str:
        """Offline-safe deterministic text. Never a cloud call — a plainer sentence."""
        names = ", ".join(plan["move_names"][:3])
        seat = "seated" if not intake["can_stand"] else "standing"
        return (
            f"Here's a {plan['duration_min']}-minute {seat} reset for your "
            f"{plan['symptom_label'].lower()}: {names}. Start when you're ready."
        )

    def _why(self, plan: dict[str, Any], intake: dict[str, Any]) -> list[str]:
        """The 'Why this?' bullets. Grounded in tool output, not model prose."""
        hist = memory.summary(self.user_id)
        why = [
            f"You said {plan['symptom_label'].lower()}, "
            f"{'seated only' if not intake['can_stand'] else 'standing is fine'}, "
            f"{plan['duration_min']} min.",
            f"{len(plan['moves'])} moves from the approved library, "
            f"about {plan['estimated_seconds']}s total.",
        ]
        if hist.get("top_symptom") == plan["symptom"] and hist.get("top_symptom_count", 0) > 1:
            why.append(
                f"This is your {_ordinal(hist['top_symptom_count'] + 1)} "
                f"{plan['symptom_label'].lower()} check-in in {hist['days']} days."
            )
        if plan.get("avoided"):
            why.append(
                f"Skipped {', '.join(plan['avoided'])} — you rated those worse before."
            )
        if hist.get("moves_that_helped"):
            overlap = set(plan["moves"]) & set(hist["moves_that_helped"])
            if overlap:
                why.append(
                    f"Includes {', '.join(sorted(overlap))}, which helped you before."
                )
        return why

    # ──────────────────────────── guiding ────────────────────────────

    def on_event(self, event: dict[str, Any]) -> dict[str, Any] | None:
        """Handle one perception `event`. Returns a `coach` message or None.

        Rate-limited on purpose: one cue at a time is a design principle, and
        a stream of corrections is exactly the surveillance feeling we're
        trying to avoid.
        """
        kind = event.get("type")
        move = event.get("move")
        prefs = memory.get_prefs(self.user_id)

        if kind == "debt_threshold":
            return self._watch_nudge(event, prefs)

        if kind in ("form_fault", "framing_lost", "vlm_check_needed"):
            metrics = tools.analyze_pose(move)
            if kind == "form_fault" and event.get("detail"):
                metrics.setdefault("recent_faults", []).insert(0, event["detail"])
            if kind == "framing_lost":
                metrics["framing"] = "torso_only"

            cue = tools.generate_coaching_cue(
                metrics=metrics, move=move, style=prefs.get("coach_style", "supportive")
            )
            self._emit(
                {
                    "kind": "tool",
                    "name": "generate_coaching_cue",
                    "arguments": {"move": move},
                    "result": cue,
                }
            )
            return self._speak(cue.get("cue"), prefs)

        if kind == "mind_muscle":
            return self._speak(self._mind_muscle_cue(move), prefs)

        if kind == "user_speech":
            return self.answer(event.get("detail") or "", move)

        if kind == "move_complete":
            return self._speak(self._transition(move), prefs, force=True)

        if kind == "rep_done":
            return None  # the UI counts reps; the coach stays quiet

        return None

    def _watch_nudge(
        self, event: dict[str, Any], prefs: dict[str, Any]
    ) -> dict[str, Any] | None:
        """Watch mode surfaced something. Offer, never insist."""
        if not prefs.get("watch_mode"):
            return None
        area = event.get("detail", "sitting")
        minutes = int(event.get("value", 0))
        self._emit({"kind": "watch", "area": area, "minutes": minutes})

        offer_symptom = {
            "sitting": "legs_glutes",
            "crossed_legs": "legs_glutes",
            "neck": "neck_shoulders",
            "shoulders": "neck_shoulders",
        }.get(area, "general")

        if area == "crossed_legs":
            text = (
                f"You've had your legs crossed the same way for about {minutes} minutes. "
                "Worth switching sides — or I can give you a two-minute hip and glute reset. "
                "Either's fine."
            )
        else:
            text = (
                f"You've been at about {minutes} minutes of {area.replace('_', ' ')}. "
                "Want a two-minute reset? No pressure — I'll stop asking if you'd rather."
            )

        return {
            "type": "coach",
            "text": text,
            "speak": prefs.get("voice", True),
            "routine": None,
            "offer": {"symptom": offer_symptom, "duration_min": 2},
        }

    def answer(self, question: str, move: str | None) -> dict[str, Any] | None:
        """Answer a question asked mid-session, by voice or by tapping.

        `force=True`: the user asked, so the 6-second cue spacing that keeps
        unprompted coaching calm must not swallow the reply.
        """
        prefs = memory.get_prefs(self.user_id)
        result = tools.answer_question(question, move)
        self._emit(
            {
                "kind": "tool",
                "name": "answer_question",
                "arguments": {"question": question, "move": move},
                "result": result,
            }
        )
        return self._speak(result.get("answer"), prefs, force=True)

    def _mind_muscle_cue(self, move: str | None) -> str | None:
        """Name the muscle while they can feel it working.

        Authored copy from muscles.yaml, never model prose — the whole value is
        that it points at the right place on the body, and a hallucinated
        anatomy lesson is worse than silence.
        """
        if not move:
            return None
        entry = routines.muscles_for(move)
        if not entry or not entry.get("feel"):
            return None
        primary = entry.get("primary") or []
        muscle = primary[0] if primary else None
        feel = entry["feel"]
        if muscle:
            return f"That's your {muscle} working. You should feel {feel}."
        return f"You should feel {feel}."

    def _transition(self, move: str | None) -> str:
        if not move:
            return "Nice work."
        try:
            spec = routines.describe_move(move)
        except routines.NoApprovedRoutine:
            return "Nice work."
        return f"Good. That's {spec['name']} done."

    def _speak(
        self, text: str | None, prefs: dict[str, Any], force: bool = False
    ) -> dict[str, Any] | None:
        """One cue at a time, 6s apart minimum, never the same line twice running."""
        if not text:
            return None
        now = time.monotonic()
        if not force:
            if text == self._last_cue:
                return None
            if now - self._cue_at < 6.0:
                return None
        self._last_cue, self._cue_at = text, now
        return {
            "type": "coach",
            "text": persona.sanitize(text),
            "speak": prefs.get("voice", True),
            "routine": None,
        }

    # ──────────────────────────── closing ────────────────────────────

    def finish(self, completed: bool = True, response: str | None = None) -> dict[str, Any]:
        """Record the result and hand back one honest pattern insight."""
        if self.session_id is None:
            return {
                "type": "coach",
                "text": "Nothing to save.",
                "speak": False,
                "routine": None,
            }

        result = tools.record_session_result(
            session_id=self.session_id,
            completed=completed,
            response=response,
            user_id=self.user_id,
        )
        self._emit(
            {
                "kind": "tool",
                "name": "record_session_result",
                "arguments": {
                    "session_id": self.session_id,
                    "completed": completed,
                    "response": response,
                },
                "result": {"saved": True},
            }
        )

        summary = result["summary"]
        self.session_id = None
        return {
            "type": "coach",
            "text": self._closing_line(response),
            "speak": memory.get_prefs(self.user_id).get("voice", True),
            "routine": None,
            "insight": self._insight(summary),
            "summary": summary,
        }

    def _closing_line(self, response: str | None) -> str:
        if response == "better":
            return "Good. I'll put this one first next time that area speaks up."
        if response == "worse":
            return "Thanks for telling me — I'll skip those moves next time and go gentler."
        if response == "same":
            return "Noted. I'll try a different mix next time and see if it lands better."
        return "Saved."

    def _insight(self, summary: dict[str, Any]) -> str | None:
        """One true sentence from local data, or nothing. Never invented."""
        if summary["sessions_completed"] < 3:
            return None
        if summary["better_rate"] >= 0.6:
            pct = round(summary["better_rate"] * 100)
            return (
                f"{pct}% of your resets this week left you feeling better "
                f"({summary['sessions_completed']} completed)."
            )
        if summary.get("top_symptom_count", 0) >= 3:
            label = routines.SYMPTOM_LABELS.get(
                summary["top_symptom"], summary["top_symptom"]
            )
            return (
                f"{label} has come up {summary['top_symptom_count']} times "
                f"in {summary['days']} days."
            )
        if summary.get("streak_days", 0) >= 2:
            return f"{summary['streak_days']} days in a row."
        return None


def health() -> dict[str, Any]:
    """Everything the UI's local-AI badge needs, in one call."""
    from . import llm

    return {
        "llm": llm.health(),
        "runtime": runtime.active_runtime(),
        "library_moves": len(routines.load_library()),
        "external_ai_apis": [],  # structurally empty: see llm.assert_local
    }
