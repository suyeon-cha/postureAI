"""Exercise + posture detectors: joint angles, rep state machines,
hold/tempo detection, framing check, knee-valgus rule.

Consumes keypoints, emits `event` dicts per contracts.md section 2.
Never phrases coaching language — that's the agent's job. Everything here
returns a *named fault*, and the agent looks the wording up in exercises.yaml.

This is also where the "one cue, not a warning flood" principle is enforced
in geometry: faults have to persist across FAULT_PERSIST_FRAMES before they
fire, so a single noisy landmark never becomes a correction.
"""

from __future__ import annotations

import math
import time
from collections import deque
from typing import Any, Iterable

from .pose import (
    L_ANKLE, L_EAR, L_ELBOW, L_HIP, L_KNEE, L_SHOULDER, L_WRIST,
    NOSE, R_ANKLE, R_EAR, R_ELBOW, R_HIP, R_KNEE, R_SHOULDER, R_WRIST,
)

VISIBILITY_MIN = 0.5
FAULT_PERSIST_FRAMES = 5
SMOOTH_WINDOW = 5

Keypoints = list[list[float]]


# ─────────────────────────────── geometry ───────────────────────────────


def visible(kp: Keypoints, *idx: int) -> bool:
    return all(kp[i][2] >= VISIBILITY_MIN for i in idx if i < len(kp))


def angle(kp: Keypoints, a: int, b: int, c: int) -> float | None:
    """Interior angle at joint b, in degrees."""
    if not visible(kp, a, b, c):
        return None
    ax, ay = kp[a][0], kp[a][1]
    bx, by = kp[b][0], kp[b][1]
    cx, cy = kp[c][0], kp[c][1]
    v1, v2 = (ax - bx, ay - by), (cx - bx, cy - by)
    n1 = math.hypot(*v1)
    n2 = math.hypot(*v2)
    if n1 < 1e-6 or n2 < 1e-6:
        return None
    cos = max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)))
    return math.degrees(math.acos(cos))


def midpoint(kp: Keypoints, a: int, b: int) -> tuple[float, float] | None:
    if not visible(kp, a, b):
        return None
    return ((kp[a][0] + kp[b][0]) / 2, (kp[a][1] + kp[b][1]) / 2)


def framing(kp: Keypoints | None) -> str:
    """contracts.md `framing`: full_body | torso_only | no_person."""
    if not kp:
        return "no_person"
    if visible(kp, L_ANKLE, R_ANKLE) or visible(kp, L_KNEE, R_KNEE):
        return "full_body"
    if visible(kp, L_SHOULDER, R_SHOULDER):
        return "torso_only"
    return "no_person"


def forward_head_ratio(kp: Keypoints) -> float | None:
    """How far the ear sits ahead of the shoulder, normalized by shoulder width.

    Positive means the head is forward of the shoulders. Scale-free, so it
    doesn't change when the user moves closer to the camera.
    """
    if not visible(kp, L_EAR, R_EAR, L_SHOULDER, R_SHOULDER):
        return None
    ear = midpoint(kp, L_EAR, R_EAR)
    sho = midpoint(kp, L_SHOULDER, R_SHOULDER)
    width = abs(kp[L_SHOULDER][0] - kp[R_SHOULDER][0])
    if not ear or not sho or width < 1e-3:
        return None
    return (ear[0] - sho[0]) / width


def shoulder_elevation(kp: Keypoints) -> float | None:
    """Shoulder-to-ear distance, normalized. Small means hiked/shrugging."""
    if not visible(kp, L_EAR, R_EAR, L_SHOULDER, R_SHOULDER):
        return None
    width = abs(kp[L_SHOULDER][0] - kp[R_SHOULDER][0])
    if width < 1e-3:
        return None
    left = abs(kp[L_SHOULDER][1] - kp[L_EAR][1])
    right = abs(kp[R_SHOULDER][1] - kp[R_EAR][1])
    return ((left + right) / 2) / width


def torso_lean(kp: Keypoints) -> float | None:
    """Degrees the torso is off vertical. Used for hinge and slouch."""
    sho = midpoint(kp, L_SHOULDER, R_SHOULDER)
    hip = midpoint(kp, L_HIP, R_HIP)
    if not sho or not hip:
        return None
    dx, dy = sho[0] - hip[0], sho[1] - hip[1]
    if abs(dy) < 1e-6:
        return 90.0
    return abs(math.degrees(math.atan2(dx, -dy)))


def knee_valgus(kp: Keypoints) -> bool:
    """Knees tracking inside the ankles during a squat."""
    if not visible(kp, L_KNEE, R_KNEE, L_ANKLE, R_ANKLE):
        return False
    knee_span = abs(kp[L_KNEE][0] - kp[R_KNEE][0])
    ankle_span = abs(kp[L_ANKLE][0] - kp[R_ANKLE][0])
    return ankle_span > 1e-3 and knee_span < ankle_span * 0.72


def knee_past_toes(kp: Keypoints, side: str = "left") -> bool:
    """Front knee travelling forward of the toes in a lunge.

    Normalized by shin length so it doesn't change with distance from the
    camera. This is the fault that actually matters in a split stance, and
    the one users get wrong most often.
    """
    knee, ankle, foot = (L_KNEE, L_ANKLE, 31) if side == "left" else (R_KNEE, R_ANKLE, 32)
    if not visible(kp, knee, ankle):
        return False
    shin = abs(kp[knee][1] - kp[ankle][1])
    if shin < 1e-3:
        return False
    # Prefer the foot-index landmark when it's visible; fall back to the ankle.
    toe_x = kp[foot][0] if foot < len(kp) and kp[foot][2] >= VISIBILITY_MIN else kp[ankle][0]
    return (kp[knee][0] - toe_x) / shin > 0.35


def lunge_depth(kp: Keypoints, side: str = "left") -> float | None:
    """Front-knee angle. ~90° is a well-placed lunge; >150° is barely bent."""
    if side == "left":
        return angle(kp, L_HIP, L_KNEE, L_ANKLE)
    return angle(kp, R_HIP, R_KNEE, R_ANKLE)


def split_stance(kp: Keypoints) -> bool:
    """Are the feet staggered (lunge) rather than side by side (squat)?"""
    if not visible(kp, L_ANKLE, R_ANKLE, L_HIP, R_HIP):
        return False
    hip_width = abs(kp[L_HIP][0] - kp[R_HIP][0])
    if hip_width < 1e-3:
        return False
    return abs(kp[L_ANKLE][1] - kp[R_ANKLE][1]) / hip_width > 0.35


def legs_crossed(kp: Keypoints) -> bool:
    """Seated leg crossing — ankles swapped relative to the hips.

    Watch mode uses this. Crossing isn't harmful in itself; sitting crossed for
    an hour without switching is what leaves one hip tighter than the other,
    so we track sustained time, not the posture itself.
    """
    if not visible(kp, L_ANKLE, R_ANKLE, L_HIP, R_HIP):
        return False
    hip_width = abs(kp[L_HIP][0] - kp[R_HIP][0])
    if hip_width < 1e-3:
        return False
    hips_left_of_right = kp[L_HIP][0] < kp[R_HIP][0]
    ankles_left_of_right = kp[L_ANKLE][0] < kp[R_ANKLE][0]
    # Sides inverted, and inverted by enough to not be landmark noise.
    return (
        hips_left_of_right != ankles_left_of_right
        and abs(kp[L_ANKLE][0] - kp[R_ANKLE][0]) / hip_width > 0.15
    )


def head_tilt(kp: Keypoints) -> float | None:
    """Degrees of lateral neck tilt — the signal for neck_side_stretch."""
    if not visible(kp, L_EAR, R_EAR):
        return None
    dx = kp[R_EAR][0] - kp[L_EAR][0]
    dy = kp[R_EAR][1] - kp[L_EAR][1]
    if abs(dx) < 1e-6:
        return 90.0
    return abs(math.degrees(math.atan2(dy, dx)))


# ────────────────────────── per-move detection ──────────────────────────


class MoveTracker:
    """Rep counting, hold timing, tempo, and form faults for one move.

    Reps come from a two-state machine over a chosen signal, with hysteresis
    so a jittery landmark can't inflate the count. Holds come from stillness
    of that same signal.
    """

    # signal name -> (extractor, down_threshold, up_threshold)
    SIGNALS = {
        "shoulder_rolls": (shoulder_elevation, 0.55, 0.75),
        "y_raise": (lambda kp: angle(kp, L_HIP, L_SHOULDER, L_ELBOW), 60.0, 130.0),
        "squat": (lambda kp: angle(kp, L_HIP, L_KNEE, L_ANKLE), 110.0, 160.0),
        "calf_raise": (lambda kp: angle(kp, L_KNEE, L_ANKLE, L_HIP), 150.0, 170.0),
        "cat_cow": (torso_lean, 8.0, 22.0),
        "hip_circles": (lambda kp: midpoint(kp, L_HIP, R_HIP)[0] if midpoint(kp, L_HIP, R_HIP) else None, 0.45, 0.55),
        "chin_tuck": (forward_head_ratio, 0.05, 0.20),
        "neck_side_stretch": (head_tilt, 8.0, 20.0),
        "seated_twist": (lambda kp: abs(kp[L_SHOULDER][0] - kp[R_SHOULDER][0]) if visible(kp, L_SHOULDER, R_SHOULDER) else None, 0.10, 0.20),
        "standing_forward_fold": (torso_lean, 20.0, 50.0),
        "hip_flexor_reset": (lambda kp: angle(kp, L_SHOULDER, L_HIP, L_KNEE), 150.0, 175.0),
        "thoracic_extension": (torso_lean, 5.0, 18.0),
        "chest_opener": (shoulder_elevation, 0.6, 0.8),
        "trap_stretch": (head_tilt, 8.0, 20.0),
        # legs & glutes
        "lunge": (lambda kp: lunge_depth(kp, "left"), 110.0, 160.0),
        "chair_squat": (lambda kp: angle(kp, L_HIP, L_KNEE, L_ANKLE), 115.0, 165.0),
        "hip_hinge": (torso_lean, 15.0, 45.0),
        "glute_squeeze": (torso_lean, 3.0, 10.0),
        "figure_four": (torso_lean, 8.0, 22.0),
    }

    def __init__(self, move: str, spec: dict[str, Any]):
        self.move = move
        self.spec = spec
        self.detection = spec.get("detection", "timer_only")
        self.target_reps = int(spec.get("target_reps", 0))
        self.hold_seconds = int(spec.get("hold_seconds", 0))

        self.rep = 0
        self.phase = "up"  # "up" | "down"
        self.started_at = time.monotonic()
        self.hold_elapsed = 0.0
        self._hold_since: float | None = None
        self._rep_times: deque[float] = deque(maxlen=5)
        self._last_rep_at = self.started_at
        self._signal_window: deque[float] = deque(maxlen=SMOOTH_WINDOW)
        self._range_seen: list[float] = []
        self._fault_counts: dict[str, int] = {}
        self.recent_faults: deque[str] = deque(maxlen=3)
        self._vlm_asked_at = 0.0

    # ── signals ──

    def _signal(self, kp: Keypoints) -> float | None:
        entry = self.SIGNALS.get(self.move)
        if not entry:
            return None
        fn = entry[0]
        try:
            value = fn(kp)
        except (IndexError, TypeError):
            return None
        if value is None:
            return None
        self._signal_window.append(value)
        return sum(self._signal_window) / len(self._signal_window)

    def _thresholds(self) -> tuple[float, float] | None:
        entry = self.SIGNALS.get(self.move)
        return (entry[1], entry[2]) if entry else None

    # ── faults ──

    def _fault(self, name: str, active: bool) -> str | None:
        """Only report a fault that has persisted. Returns the name once, on trip."""
        if not active:
            self._fault_counts[name] = 0
            return None
        count = self._fault_counts.get(name, 0) + 1
        self._fault_counts[name] = count
        if count == FAULT_PERSIST_FRAMES:
            self.recent_faults.appendleft(name)
            return name
        return None

    def _check_faults(self, kp: Keypoints) -> list[str]:
        fired = []
        if self.move == "squat":
            if f := self._fault("knee_valgus", knee_valgus(kp)):
                fired.append(f)
            knee = angle(kp, L_HIP, L_KNEE, L_ANKLE)
            if knee is not None and self.phase == "down":
                if f := self._fault("too_shallow", knee > 135):
                    fired.append(f)
        if self.move in ("y_raise", "neck_side_stretch", "trap_stretch"):
            elev = shoulder_elevation(kp)
            if elev is not None:
                name = "shrugging" if self.move == "y_raise" else "shoulder_hiked"
                if f := self._fault(name, elev < 0.5):
                    fired.append(f)
        if self.move in ("chest_opener", "thoracic_extension", "hip_flexor_reset"):
            lean = torso_lean(kp)
            if lean is not None:
                if f := self._fault("arching", lean > 25):
                    fired.append(f)
        if self.move == "standing_forward_fold":
            knee = angle(kp, L_HIP, L_KNEE, L_ANKLE)
            if knee is not None:
                if f := self._fault("locked_knees", knee > 172):
                    fired.append(f)
        # Lunge form. Ordered by what hurts if you get it wrong: knee travel
        # first, then tracking, then torso, then depth. _fault() only reports
        # one per frame per name, and the agent speaks at most one cue.
        if self.move == "lunge":
            if f := self._fault("knee_past_toes", knee_past_toes(kp, "left")):
                fired.append(f)
            if f := self._fault("knee_valgus", knee_valgus(kp)):
                fired.append(f)
            lean = torso_lean(kp)
            if lean is not None:
                if f := self._fault("torso_pitched", lean > 20):
                    fired.append(f)
            depth = lunge_depth(kp, "left")
            if depth is not None and self.phase == "down":
                if f := self._fault("too_shallow", depth > 140):
                    fired.append(f)

        if self.move in ("chair_squat", "hip_hinge"):
            if f := self._fault("knee_valgus", knee_valgus(kp)):
                fired.append(f)
            lean = torso_lean(kp)
            if lean is not None and self.move == "hip_hinge":
                # A hinge should bend at the hip, not round the spine. Shoulders
                # dropping toward the hips without the hips travelling back is
                # the signature of rounding.
                sho = midpoint(kp, L_SHOULDER, R_SHOULDER)
                hip = midpoint(kp, L_HIP, R_HIP)
                if sho and hip:
                    if f := self._fault("rounding", lean > 55):
                        fired.append(f)
                knee = angle(kp, L_HIP, L_KNEE, L_ANKLE)
                if knee is not None:
                    if f := self._fault("locked_knees", knee > 174):
                        fired.append(f)

        if self.move == "figure_four":
            lean = torso_lean(kp)
            if lean is not None:
                if f := self._fault("rounding", lean > 40):
                    fired.append(f)

        if self.move == "chin_tuck":
            nose_drop = None
            if visible(kp, NOSE, L_EAR, R_EAR):
                ear = midpoint(kp, L_EAR, R_EAR)
                nose_drop = kp[NOSE][1] - ear[1] if ear else None
            if nose_drop is not None:
                if f := self._fault("tilting_down", nose_drop > 0.04):
                    fired.append(f)
        return fired

    # ── main update ──

    def update(self, kp: Keypoints | None) -> list[dict[str, Any]]:
        """One frame in, zero or more `event` dicts out."""
        events: list[dict[str, Any]] = []
        now = time.monotonic()
        frame = framing(kp)

        if kp is None or frame == "no_person":
            return events
        if self.spec.get("requires_full_body") and frame != "full_body":
            if self._fault("framing", True) == "framing":
                events.append({
                    "type": "framing_lost", "move": self.move,
                    "detail": "need_ankles", "value": 0, "frame_jpeg_b64": None,
                })
            return events
        self._fault("framing", False)

        for name in self._check_faults(kp):
            events.append({
                "type": "form_fault", "move": self.move, "detail": name,
                "value": 0, "frame_jpeg_b64": None,
            })

        value = self._signal(kp)
        if value is not None:
            self._range_seen.append(value)

        if self.detection == "reps" and value is not None:
            thresholds = self._thresholds()
            if thresholds:
                down, up = thresholds
                if self.phase == "up" and value < down:
                    self.phase = "down"
                elif self.phase == "down" and value > up:
                    self.phase = "up"
                    self.rep += 1
                    self._rep_times.append(now - self._last_rep_at)
                    self._last_rep_at = now
                    events.append({
                        "type": "rep_done", "move": self.move, "detail": None,
                        "value": self.rep, "frame_jpeg_b64": None,
                    })
                    if self.pace() == "too_fast":
                        events.append({
                            "type": "form_fault", "move": self.move,
                            "detail": "too_fast", "value": 0, "frame_jpeg_b64": None,
                        })
                    if self.rep >= self.target_reps:
                        events.append(self._complete())

        elif self.detection in ("angle_hold", "timer_only"):
            thresholds = self._thresholds()
            in_position = True
            if thresholds and value is not None:
                in_position = value >= thresholds[1]
            if in_position:
                self._hold_since = self._hold_since or now
                self.hold_elapsed = now - self._hold_since
            else:
                self._hold_since = None
                self.hold_elapsed = 0.0
            budget = self.hold_seconds * max(int(self.spec.get("sides", 1)), 1)
            if self.hold_elapsed >= self.hold_seconds and self.rep < self.spec.get("sides", 1):
                self.rep += 1
                self._hold_since = None
                events.append({
                    "type": "hold_complete", "move": self.move, "detail": None,
                    "value": self.rep, "frame_jpeg_b64": None,
                })
                if self.rep >= int(self.spec.get("sides", 1)):
                    events.append(self._complete())
            elif now - self.started_at > budget + 15:
                events.append(self._complete())

        elif self.detection == "vlm_judge":
            # Geometry can't see this plane. Ask the local vision model, rarely.
            if now - self._vlm_asked_at > 8.0 and now - self.started_at > 4.0:
                self._vlm_asked_at = now
                events.append({
                    "type": "vlm_check_needed", "move": self.move,
                    "detail": self.move, "value": 0, "frame_jpeg_b64": None,
                })
            if now - self.started_at > self.spec.get("seconds", 40):
                events.append(self._complete())

        return events

    def _complete(self) -> dict[str, Any]:
        return {
            "type": "move_complete", "move": self.move, "detail": None,
            "value": self.rep, "frame_jpeg_b64": None,
        }

    # ── derived metrics the agent reads via analyze_pose ──

    def pace(self) -> str:
        """contracts.md session.tempo: good | too_fast."""
        if len(self._rep_times) < 2:
            return "good"
        avg = sum(self._rep_times) / len(self._rep_times)
        return "too_fast" if avg < 1.8 else "good"

    def range_quality(self) -> str:
        """How much of the expected excursion the user actually used."""
        if len(self._range_seen) < 8:
            return "unknown"
        span = max(self._range_seen) - min(self._range_seen)
        thresholds = self._thresholds()
        if not thresholds:
            return "unknown"
        expected = abs(thresholds[1] - thresholds[0])
        if expected < 1e-6:
            return "unknown"
        ratio = span / expected
        if ratio >= 0.8:
            return "good"
        if ratio >= 0.45:
            return "partial"
        return "small"

    def session_state(self) -> dict[str, Any]:
        """The `session` block of contracts.md §1."""
        return {
            "move": self.move,
            "rep": self.rep,
            "target_reps": self.target_reps or int(self.spec.get("sides", 1)),
            "hold_seconds": round(self.hold_elapsed, 1),
            "form": "fault" if self.recent_faults else "ok",
            "tempo": self.pace(),
        }

    def metrics(self) -> dict[str, Any]:
        """What analyze_pose hands the agent. Geometry only — never a frame."""
        return {
            "range_quality": self.range_quality(),
            "pace": self.pace(),
            "symmetry": "unknown",
            "rep": self.rep,
            "recent_faults": list(self.recent_faults),
        }


def build_tracker(move: str, spec: dict[str, Any]) -> MoveTracker:
    return MoveTracker(move, spec)
