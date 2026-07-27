# Defect log and demo go/no-go — T+65–85 deliverable

Owner: Person 3. Prioritized by judging-path impact, not by effort.

Found by static audit of `agent/exercises.yaml`, `agent/routines.py`,
`perception/detectors.py`, `agent/tools.py`, `agent/memory.py`, and `ui/app.js`.
**Not yet confirmed on hardware** — the GB10 runs are Person 1's, and every camera-dependent
case is marked accordingly.

Person 3 does not edit application source during the parallel window. Each defect names an
owner, the exact file, and the smallest fix.

**Re-audited against `b9643e6`** (consent controls + camera controls + movement guides).
DEFECT-2 is resolved by decision. **DEFECT-1, DEFECT-3, and DEFECT-4 are unchanged and still
open** — re-verified by running the composer and re-parsing the library after pulling.

| ID | Status | Severity |
|---|---|---|
| DEFECT-1 demo picks the lunge, not sit-to-stand | 🔴 open | P1 — blocks the demo |
| DEFECT-2 workspace orphaned | ✅ resolved by decision | — |
| DEFECT-3 `hip_hinge` knee-safety cue not delivered | 🔴 open | P1 correctness |
| DEFECT-4 dead `fault_rushing` copy | 🔴 open | P3 |
| DEFECT-5 `small_range` copy | ⚪ won't fix | P4 |

---

## DEFECT-1 — The demo picks the risky movement · **P1 · blocks the demo**

**Owner:** Person 1 · `agent/routines.py` or `agent/exercises.yaml`

The frozen plan says the lower-body demo is chair sit-to-stand, and the lunge appears only if
it passes camera evaluation. The composer disagrees:

```
legs_glutes · 3 min · can stand  →  ['figure_four', 'lunge', 'box_breath']
```

`chair_squat` is not selected at all. Scoring: `legs_glutes` targets are
`[glutes, legs, pelvis, hips]`; `lunge` matches three (4.3), `chair_squat` matches two (4.2).
A 0.1 margin puts the hardest-to-frame movement on stage by default.

**Smallest fix.** Add `sitting` to `chair_squat.targets` in `exercises.yaml`. That gives it
three matches, tying at 4.3, and the tie breaks on duration — `chair_squat` is 50s versus the
lunge's 70s, so sit-to-stand wins. One word, no logic change.

**Verified locally** by monkey-patching the library and recomposing:

```
before  ['figure_four', 'lunge', 'box_breath']
after   ['chair_squat', 'figure_four', 'glute_squeeze', 'box_breath']
```

Sit-to-stand leads and the lunge drops out of the 3-minute plan entirely — which is the
intended demo behaviour, not just a reordering.

**Verify on the box:** `compose('legs_glutes', 3, can_stand=True)` contains `chair_squat` and
not `lunge`.

---

## DEFECT-2 — Workspace view orphaned · ✅ **RESOLVED by decision** (`2450d0a`)

**Resolution: option (b) — B2B is out of the employee application.**

`PRIVACY_AND_SAFETY.md` now states it as product policy: *"The employee application contains
no team view. Employer reporting is a separate admin capability and receives participation
counts only after opt-in."* That is a cleaner answer than the nav entry I recommended — an
employee-facing team view is exactly the surveillance smell the product is arguing against, so
removing it strengthens the pitch rather than shrinking it.

The boundary is now enforced in code, not just described. `memory.workspace_summary()` was
narrowed (`2450d0a`) and no longer returns `responses`, `better_rate`, or `by_symptom`. What
an employer can receive is now participation counts only:

```
completion_rate · participants · per_person_per_week · sessions_started
sessions_completed · teams · suppressed_teams · k_anonymity (10)
```

Body areas and Better/Same/Worse — the two most sensitive fields — are no longer reachable
through the employer path at all. Worth saying on stage: we didn't just hide them, we deleted
the query.

**Residual · P4 · cleanup only.** `viewWorkspace()` is still defined and still registered in
the screen table at `ui/app.js:535`, though nothing calls `go("workspace")`. It is dead code
reachable only from a console. Harmless for judging; delete it after the freeze so the next
person doesn't mistake it for a live feature.

**Doc impact:** golden-path step 9 and the go/no-go checklist have been rewritten. Evaluation
case C13 moves from a UI case to an API case. See
[EVALUATION_MATRIX.md](EVALUATION_MATRIX.md).

---

## DEFECT-3 — Knee-safety cue lost on `hip_hinge` · **P1 for correctness, P3 for the demo**

**Owner:** Person 1 · `agent/exercises.yaml`

`detectors.py` emits `knee_valgus` for `hip_hinge`, but `hip_hinge` has no
`cues.fault_knee_valgus`. `generate_coaching_cue()` falls through to the generic `during` line,
so the user hears *"Push your hips back, chest stays long"* when their knees are caving.

The correction is detected and not delivered. Every other move that emits `knee_valgus`
(`squat`, `chair_squat`, `lunge`) authors it.

**Fix.** Add to `hip_hinge.cues`:
`fault_knee_valgus: "Track your knees over your middle toes."`

Demo severity is low only because `hip_hinge` isn't the demo move. Correctness severity is
high: it is the one case where a named safety fault produces no safety cue.

---

## DEFECT-4 — Dead cue copy under a name nothing emits · **P3**

**Owner:** Person 1 · `agent/exercises.yaml`

`fault_rushing` is not a name any detector passes to `_fault()`. Three moves carry it, so the
words can never reach a user:

| Move | Dead key | Fix |
|---|---|---|
| `glute_squeeze` | `fault_rushing` | **Rename to `fault_too_fast`** — that fault *does* fire here and currently has no cue. One rename fixes a gap and a dead key together. |
| `neck_side_stretch` | `fault_rushing` | Rename to `fault_too_fast`, or delete. |
| `seated_twist` | `fault_rushing` | Rename to `fault_too_fast`, or delete. |
| `figure_four` | `fault_shoulder_hiked` | Delete — `shoulder_hiked` is only emitted for `y_raise`, `neck_side_stretch`, `trap_stretch`. |

None are on the demo path.

---

## DEFECT-5 — `small_range` has almost no authored copy · **P4 · won't fix**

17 moves can reach the `range_quality == "small"` branch with no `fault_small_range` cue, so
they fall back to the generic `during` line. That fallback is an encouragement, which is the
right register for range anyway. **Recommend no action before freeze.**

---

## Unverified — needs the GB10

These cannot be settled from source and are the highest residual risk:

| # | Question | Owner | Gate |
|---|---|---|---|
| U1 | Does the approved runtime report `nemoclaw`/`openclaw`, not `native`? | P1 | T+60 |
| U2 | Sit-to-stand rep counting accurate to ±1 over 8 reps? | P1 + P3 | T+60 |
| U3 | Fault → cue → audible Piper within ~2s? | P1 | T+90 |
| U4 | Does the speech cooldown actually prevent repeats? | P3 | T+90 |
| U5 | Local Whisper transcribes the intake reliably? | P2 | T+90 |
| U6 | Full path with egress blocked? | all | T+145 |

---

## Go/no-go: sit-to-stand versus lunge

**Decision: chair sit-to-stand is the demo movement. Lunge is off-stage.**

| | Sit-to-stand | Lunge |
|---|---|---|
| Framing | Hips to feet, front-on | Both feet *and* knees, framing-sensitive |
| Calibration risk | Low — chair bounds the depth | High — knee travel reads differently side-on |
| Faults to tune | 3 | 6 |
| Cue coverage | Complete | Complete |
| Failure on camera | Reps miscount | Wrong knee-safety correction — **worst possible failure on stage** |

The lunge's marginal demo value is a more impressive correction. Its downside is a *wrong*
safety cue in front of judges, which costs more than it can win.

**Reconsider only if,** by T+60, the lunge counts 6 reps per side with zero false
`knee_past_toes` on a controlled rep, in the actual demo lighting and camera position. That is
a hardware measurement, not a judgment call — Person 1 reports the number, Person 3 makes the
call, and it is made once.

**Contingency.** If sit-to-stand also fails camera evaluation, run the demo camera-off on a
seated move (`glute_squeeze` or `figure_four`) and state plainly on stage that camera guidance
is optional. The agent loop, local inference, memory, and privacy story all survive without
the camera. Losing pose is a reduced demo; a wrong safety cue is a failed one.
