"""Watch-mode posture debt accumulator.

Tracks minutes of forward-head / rounded-shoulder / continuous-sitting per
contracts.md `posture_debt`. Fires `debt_threshold` events.

Watch mode is OFF by default and only runs while the user has explicitly
turned it on — see memory.DEFAULT_PREFS["watch_mode"]. It accumulates
*minutes*, never frames, never images, and never a score. The point is to
notice "you've been sitting 90 minutes", not to grade anyone's posture.

Debt decays while the user is in a good position, so it measures sustained
load rather than punishing a moment of slouch.
"""

from __future__ import annotations

import time
from typing import Any

from .detectors import (
    Keypoints,
    forward_head_ratio,
    framing,
    legs_crossed,
    shoulder_elevation,
    torso_lean,
)

# Thresholds are deliberately forgiving. We would rather miss a slouch than
# nag someone who is fine.
FORWARD_HEAD_LIMIT = 0.35      # ear ahead of shoulder, normalized by shoulder width
SHOULDER_ROUND_LIMIT = 0.50    # shoulder-to-ear distance, normalized
SLOUCH_LEAN_LIMIT = 22.0       # degrees off vertical

# Minutes of accumulated load before we offer anything.
# `crossed_legs` is about *sustained* crossing on one side, not crossing at all:
# people cross their legs, that's fine. Staying that way for half an hour is
# what leaves one hip tighter than the other.
THRESHOLDS_MIN = {"neck": 25.0, "shoulders": 25.0, "sitting": 50.0, "crossed_legs": 30.0}

# Once we've offered, wait this long before offering the same area again —
# whether or not they accepted. An ignored nudge is an answer.
REOFFER_COOLDOWN_S = 20 * 60

DECAY_PER_SECOND = 1 / 120  # good posture pays debt back at half the accrual rate


class PostureDebt:
    def __init__(self) -> None:
        self.debt = {"neck": 0.0, "shoulders": 0.0, "sitting": 0.0, "crossed_legs": 0.0}
        self.enabled = False
        self._last_tick = time.monotonic()
        self._last_offer: dict[str, float] = {}
        self._present_since: float | None = None

    def set_enabled(self, on: bool) -> None:
        """Toggling watch mode off clears the accumulator. No silent history."""
        self.enabled = on
        if not on:
            self.debt = {k: 0.0 for k in self.debt}
            self._present_since = None

    def reset(self, area: str | None = None) -> None:
        if area:
            self.debt[area] = 0.0
        else:
            self.debt = {k: 0.0 for k in self.debt}

    def update(self, kp: Keypoints | None) -> list[dict[str, Any]]:
        """One frame in, zero or more `debt_threshold` events out."""
        now = time.monotonic()
        dt = now - self._last_tick
        self._last_tick = now
        if not self.enabled or dt <= 0 or dt > 5:
            return []

        if kp is None or framing(kp) == "no_person":
            # Away from the desk: sitting time stops, and the break pays down debt.
            self._present_since = None
            for area in self.debt:
                self.debt[area] = max(0.0, self.debt[area] - dt * DECAY_PER_SECOND * 4)
            return []

        self._present_since = self._present_since or now
        minutes = dt / 60.0

        fh = forward_head_ratio(kp)
        if fh is not None:
            self._accrue("neck", minutes if fh > FORWARD_HEAD_LIMIT else -minutes / 2)

        elev = shoulder_elevation(kp)
        if elev is not None:
            self._accrue(
                "shoulders", minutes if elev < SHOULDER_ROUND_LIMIT else -minutes / 2
            )

        lean = torso_lean(kp)
        # Sitting accrues whenever they're present — that's the point of the metric.
        self._accrue("sitting", minutes)
        if lean is not None and lean > SLOUCH_LEAN_LIMIT:
            self._accrue("neck", minutes / 2)

        # Uncrossing resets rather than decays: the load is time held on one
        # side, and switching sides genuinely relieves it.
        if legs_crossed(kp):
            self._accrue("crossed_legs", minutes)
        else:
            self.debt["crossed_legs"] = 0.0

        return self._check_thresholds(now)

    def _accrue(self, area: str, minutes: float) -> None:
        self.debt[area] = max(0.0, self.debt[area] + minutes)

    def _check_thresholds(self, now: float) -> list[dict[str, Any]]:
        events = []
        for area, limit in THRESHOLDS_MIN.items():
            if self.debt[area] < limit:
                continue
            if now - self._last_offer.get(area, -1e9) < REOFFER_COOLDOWN_S:
                continue
            self._last_offer[area] = now
            events.append(
                {
                    "type": "debt_threshold",
                    "move": None,
                    "detail": area,
                    "value": round(self.debt[area], 1),
                    "frame_jpeg_b64": None,
                }
            )
        return events

    def snapshot(self) -> dict[str, float]:
        """The `posture_debt` block of contracts.md §1."""
        return {k: round(v, 1) for k, v in self.debt.items()}
