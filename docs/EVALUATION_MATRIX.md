# Evaluation matrix — T+45–65 deliverable

Owner: Person 3. Run with the engineers at T+65–85 and again during the shared validation hour.

Twelve cases. Every one is a pass/fail an observer can judge without reading code. Record the
result in the Run log at the bottom — evidence, not vibes, decides go/no-go.

**How to run:** two people. One drives the MacBook, one watches the screen and the trace panel
and calls pass/fail out loud. Do not fix anything mid-run; log it and keep going, or you will
never finish a clean pass.

---

## Cases

### Camera and consent

**C1 · Camera off** — Start a reset, never enable the camera.
✅ Session runs on timer, text, and voice. No cue implies it can see you. `analyze_pose`
returns `available: false`.
❌ Any cue about form, range, or position.

**C2 · Camera denied** — Click enable, then deny at the browser prompt.
✅ Plain recovery text: how to retry, and that the session continues without it. No dead end,
no silent failure.
❌ Blank panel, spinner, or a session that cannot continue.

**C3 · Camera revoked mid-session** — Turn the camera off during a move.
✅ Returns to text/voice guidance, overlay clears, no stale skeleton left on screen.
❌ Frozen last frame or skeleton persisting after consent is withdrawn.

### Framing and confidence

**C4 · No person visible** — Step out of frame.
✅ Asks you to move into frame. Makes no claim about form.
❌ Any form judgment while nobody is detected.

**C5 · Lower body cropped** — Sit close so only the torso is visible, on a full-body move.
✅ "Step back so I can see your knees and feet" before judging the movement.
❌ Rep counting or a form fault fired on a body it cannot see.

**C6 · Low confidence** — Poor light, or partly behind the desk.
✅ Recalibration or framing message. Does **not** classify form.
❌ Confident correction from low-confidence landmarks.

### Movement quality

**C7 · Correct controlled reps** — Eight clean sit-to-stands.
✅ Positive confirmation, no warnings, reps count accurately (±1).
❌ A correction fired on good form, or a rep count off by more than one.

**C8 · Too fast** — Deliberately rush the reps.
✅ Exactly one pacing cue, from the approved sheet.
❌ Repeated nagging, or nothing at all.

**C9 · Limited depth** — Half-depth reps.
✅ One conservative cue containing "if that feels okay" or equivalent hedge.
❌ A pushy cue with no hedge.

**C10 · Persistent knee/torso fault** — Let the knees track inward for several reps.
✅ One named, authored form cue. Respects the cooldown — no restatement inside it.
❌ Generic encouragement instead of the specific correction, or a cue the sheet doesn't
contain. *(This is the case that catches the `hip_hinge.knee_valgus` defect. Run it on
`hip_hinge` as well as `chair_squat`.)*

### Safety, privacy, and the local claim

**C11 · User selects Worse** — Finish and choose Worse.
✅ Does not intensify. Acknowledges, offers to stop, records it, and the next recommendation
avoids those moves. Safety language appears.
❌ Any suggestion to push harder or go again immediately.

**C12 · External egress blocked** — Block outbound internet, keep the LAN/tunnel, rerun the
full golden path.
✅ Completes identically. Health badge still honest. Trace shows the same local tool calls.
❌ Any hang, timeout, or degraded behaviour.

### Aggregate reporting — status contested

**C13 · Workspace cohort below the floor** — View the aggregate with fewer than
`K_ANONYMITY` (currently **10**) opted-in people.
✅ Suppressed with an explanation. No individual row, ever.
❌ Any per-person data, or a number derived from a cohort under the floor.

> ⚠️ **This case may not be runnable.** `/api/workspace` and `memory.workspace_summary()` still
> enforce the floor in SQL, but the UI nav no longer links to the Workspace view — commit
> "replace team view with personal insights". The screen function exists and is orphaned.
> The team must decide: restore the nav entry, or drop B2B from the judging path and the
> go/no-go checklist. See DEFECT-2 in [DEFECT_LOG.md](DEFECT_LOG.md). Until that is decided,
> C13 is **blocked**, not failed.

---

## Run log

Copy this table per run. Three consecutive clean runs are the exit condition for T+130–145.

| Case | Run 1 | Run 2 | Run 3 | Notes |
|---|---|---|---|---|
| C1 camera off | | | | |
| C2 camera denied | | | | |
| C3 camera revoked | | | | |
| C4 no person | | | | |
| C5 cropped | | | | |
| C6 low confidence | | | | |
| C7 correct reps | | | | |
| C8 too fast | | | | |
| C9 limited depth | | | | |
| C10 persistent fault | | | | |
| C11 selects Worse | | | | |
| C12 egress blocked | | | | |
| C13 cohort < 10 | | | | blocked pending DEFECT-2 |

**Go/no-go rule.** C1–C6 and C10–C12 are blocking: any failure stops the demo until fixed.
C7–C9 failing degrades the demo but does not stop it — drop camera guidance to text-only and
say so on stage rather than showing a cue that fires wrongly. C13 is blocking *only if* the
team keeps B2B in the judging path.
