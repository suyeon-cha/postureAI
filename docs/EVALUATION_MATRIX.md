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

`ac4a7cd` added `detectors.frame_check()`: each move declares how much of the body must be
visible (torso for seated work, full body wherever the form rules read knee and ankle
landmarks), and one function computes the target, whether it is met, and the reason. The
on-canvas outline, the ready indicator, and the spoken cue all read from it — so these three
cases now also test that **they agree with each other**. A mismatch between the outline and
the words is a failure even if each is individually sensible.

**C4 · No person visible** — Step out of frame.
✅ "Step into view — I can't see you yet." Guide outline shows where to stand. No claim about
form.
❌ Any form judgment while nobody is detected, or an outline that contradicts the message.

**C5 · Lower body cropped** — Sit close so only the torso is visible, on a full-body move
(`chair_squat`).
✅ "Step back until I can see your feet" **before** judging the movement, with the full-body
outline drawn. Indicator reads not-ready.
❌ Rep counting or a form fault fired on a body it cannot see; or a torso-target outline shown
for a full-body move.

**C5b · Correct target per move** — Run a seated move (`glute_squeeze`), then a full-body one.
✅ Seated asks for head and shoulders only; full body asks for feet. The requirement changes
with the move.
❌ Same demand for both — that means the per-move target isn't wired through.

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

### Aggregate reporting — now an API case, not a UI case

The employee app deliberately has no team view (see DEFECT-2, resolved). These run against the
endpoint with `curl`, not through the interface.

**C13 · Cohort below the floor is suppressed** — `GET /api/workspace` with fewer than
`K_ANONYMITY` (**10**) opted-in people.
✅ `suppressed: true` with a reason. No counts, no teams.
❌ Any figure derived from a cohort under ten.

**C14 · Employer payload carries no sensitive fields** — `GET /api/workspace` with a cohort
above the floor.
✅ Participation counts only. The response contains **no** `responses`, `better_rate`,
`by_symptom`, `moves`, `user_id`, or session rows.
❌ Any body area, any Better/Same/Worse figure, anything per-person.
*This is the check that proves the privacy claim in `PRIVACY_AND_SAFETY.md`. Run it and keep
the output — it is the strongest single piece of evidence for the business slide.*

### Consent controls — added in `2450d0a`

**C15 · First-use consent gate** — Fresh browser profile, try to reach a personalized reset.
✅ Cannot proceed without affirmative consent. The accept button stays disabled until the box
is ticked. The privacy notice is reachable from the consent screen.
❌ Any wellness preference collected, or any reset started, before consent.

**C16 · Consent declined** — Choose "Not now".
✅ Returns to welcome, stores nothing, no dead end, and the app can be re-entered later.
❌ Partial state saved, or the user is trapped.

**C17 · Withdraw consent** — Settings → Withdraw future consent.
✅ Future collection is gated again; existing local data is **not** silently deleted; deletion
is offered as a separate explicit action.
❌ Silent deletion, or collection continuing after withdrawal.

**C18 · Export and delete** — Settings → Export, then Delete.
✅ Export is valid JSON containing preferences, sessions, and the recorded consent version.
Delete actually removes sessions and preferences.
❌ Export missing the consent record, or delete leaving rows behind.

---

## Run log

Copy this table per run. Three consecutive clean runs are the exit condition for T+130–145.

| Case | Run 1 | Run 2 | Run 3 | Notes |
|---|---|---|---|---|
| C1 camera off | | | | |
| C2 camera denied | | | | |
| C3 camera revoked | | | | |
| C4 no person | | | | |
| C5 cropped | | | | outline + words must agree |
| C5b per-move frame target | | | | seated vs full-body |
| C6 low confidence | | | | |
| C7 correct reps | | | | |
| C8 too fast | | | | |
| C9 limited depth | | | | |
| C10 persistent fault | | | | |
| C11 selects Worse | | | | |
| C12 egress blocked | | | | |
| C13 cohort < 10 suppressed | | | | API, `curl` |
| C14 no sensitive fields in employer payload | | | | API, `curl` — keep the output |
| C15 first-use consent gate | | | | fresh profile |
| C16 consent declined | | | | |
| C17 withdraw consent | | | | |
| C18 export and delete | | | | |

**Go/no-go rule.**

- **Blocking** — C1–C6, C10–C12, C14, C15. A failure here stops the demo until it is fixed.
  C14 and C15 are blocking because they are the two claims we make loudest: the employer sees
  nothing sensitive, and nothing is collected without consent. Being wrong about either in
  front of judges is worse than a broken camera.
- **Degrades but does not stop** — C7–C9. Drop camera guidance to text-only and say so on
  stage rather than show a cue that fires wrongly.
- **Fix if time** — C13, C16–C18.
