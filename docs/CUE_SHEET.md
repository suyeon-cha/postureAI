# Approved cue sheet — T+20–45 deliverable

Owner: Person 3. Content authority for the two demo movements, plus a coverage audit of the
whole library against what the detectors actually emit.

**Everything the user hears is authored copy.** The model decides *whether and when* to speak.
It never writes a correction. That boundary is the safety argument, so this sheet is the
source of truth for the words, and `agent/exercises.yaml` is where they live.

---

## Chair sit-to-stand — `chair_squat` (the demo movement)

Loaded move for glutes weakened by long sitting. Chosen over the lunge because it self-limits:
the chair is behind you, depth is bounded, and the frame only needs hips-to-feet.

| | |
|---|---|
| Setup | Feet hip width in front of your chair. Stand up without using your hands. |
| During | Push the floor away through your heels. Sit back down slowly. |
| Target | 8 reps · ~50s · standing · full body in frame |

| Fault | Detector rule | Approved cue | Status |
|---|---|---|---|
| `knee_valgus` | knee span < 72% of ankle span | Knees are caving — track them over your middle toes. | ✅ authored |
| `too_fast` | avg rep < 1.8s | Slower on the way down — three seconds to the seat. | ✅ authored |
| `framing` | ankles/knees not visible | Step back so I can see your knees and feet. | ✅ authored |

**Stop conditions.** Any sharp knee pain → stop, offer a seated alternative. Cannot rise
without hands → not a failure; switch to `glute_squeeze` and say so plainly. Wobbling or
reaching for support → offer the chair-assisted version rather than correcting form.

---

## Split-stance lunge — `lunge` (conditional, off-stage by default)

Highest coaching value and the highest camera risk: needs both feet and knees in frame, and
side-on framing changes the knee-travel reading.

| | |
|---|---|
| Setup | Step your right foot back about a stride. Feet hip width, both toes pointing forward. |
| During | Drop straight down — front shin stays vertical, torso stays tall. |
| Target | 6 reps per side · ~70s · standing · full body in frame |

| Fault | Detector rule | Approved cue | Status |
|---|---|---|---|
| `knee_past_toes` | knee-to-toe offset > 35% of shin length | Shift your weight back — your front knee is drifting past your toes. | ✅ authored |
| `knee_valgus` | knee span < 72% of ankle span | Track that front knee over your middle toes, not inward. | ✅ authored |
| `torso_pitched` | torso > 20° off vertical | Stand taller — you're leaning over the front leg. | ✅ authored |
| `too_shallow` | front knee angle > 140° while descending | A little deeper if that feels okay — back knee toward the floor. | ✅ authored |
| `too_fast` | avg rep < 1.8s | Slower. Three seconds down, three up. | ✅ authored |
| `framing` | ankles/knees not visible | Step back so I can see both feet and knees. | ✅ authored |

Cue coverage is complete. The blocker is calibration, not copy — see
[DEFECT_LOG.md](DEFECT_LOG.md).

**Stop conditions.** Any knee pain → stop immediately, no "push through". Balance loss → offer
a hand on the desk, or fall back to sit-to-stand. Cannot keep the torso upright after two cues
→ stop cueing and move on; repeating a correction the person can't act on is worse than
silence.

---

## Library coverage audit

Run against `agent/exercises.yaml` and `perception/detectors.py` at the freeze. Two failure
shapes matter: a fault that fires with no authored words, and authored words no detector can
ever trigger.

### Faults that fire without their own cue

When a named fault has no `fault_<name>` key, `generate_coaching_cue()` falls through to the
generic `during` line. The user still hears something — so this is quiet degradation, not
silence — but the *specific* correction is lost.

| Move | Fault | What the user gets instead | Severity |
|---|---|---|---|
| `hip_hinge` | `knee_valgus` | "Push your hips back, chest stays long." | **P1 — safety cue lost** |
| `hip_hinge` | `too_fast` | same generic line | P3 |
| `squat` | `too_fast` | "Slow on the way down — four seconds." | P3 (during line happens to cover it) |
| `glute_squeeze` | `too_fast` | "Squeeze, hold three, release." | P3 |
| `calf_raise`, `hip_circles`, `standing_forward_fold` | `framing` | Hardcoded default: "Step back so I can see your feet." | P4 — safe default, wording only |
| 17 moves | `small_range` | generic `during` line | P4 — encouragement, not safety |

Only **`hip_hinge.knee_valgus`** is a real defect: a knee-safety fault is detected and the
correction is not delivered. Fix is one line in `agent/exercises.yaml` — Person 1 owns that
file, so it is filed rather than patched here.

### Authored copy that can never fire

`fault_rushing` is not a name any detector emits. Three moves carry it, so the words exist and
are unreachable:

- `neck_side_stretch.fault_rushing`
- `seated_twist.fault_rushing`
- `glute_squeeze.fault_rushing` — **and** `glute_squeeze` is missing `fault_too_fast`, which
  *can* fire. The copy is right; the key is wrong. Renaming it fixes both rows at once.
- `figure_four.fault_shoulder_hiked` — `shoulder_hiked` is only emitted for `y_raise`,
  `neck_side_stretch`, and `trap_stretch`.

None of these are on the demo path. Filed as P3.

---

## Rules for anyone adding a cue

1. The key must be `fault_<name>` where `<name>` is a string `detectors.py` actually passes to
   `_fault()`. A cue under any other name is dead on arrival.
2. Write the correction, not the observation. "Track your knee over your middle toes" beats
   "your knee is caving inward."
3. Hedge anything about depth or range: *"if that feels okay"*. Never hedge a safety cue.
4. One sentence. It is spoken aloud mid-movement.
5. Comfort, never judgment. No "bad", "wrong", or "incorrect".
