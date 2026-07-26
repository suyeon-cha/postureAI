# Frozen golden path — T+0–20 deliverable

Owner: Person 3 (data consultant / PM). **Frozen at T+20. Changes need all three people.**

This is the one path we demo, evaluate, record, and pitch. Anything not on it is scope.

---

## One sentence each

**Problem.** Desk workers finish the day stiff and sore, already know they should take breaks,
and still don't — because in the moment nobody can tell them what the smallest useful thing to
do is, or whether they're doing it right.

**Solution.** FlowReset is a local wellbeing agent: you say what feels uncomfortable and how
long you have, it composes a reset from an approved exercise library, guides the movement with
optional camera feedback, and remembers what helped.

**B2B value.** Employers can offer a wellbeing benefit that employees actually opt into,
because body video, voice, and wellness history never leave the machine — and the employer
sees aggregate engagement only, never an individual.

---

## Who

**Employee (the user): Maya, hybrid software engineer.** Sits 6+ hours, absorbed in work,
skips breaks. Wants relief in under three minutes without a workout, a wearable, or a camera
watching her all day. Dismisses generic timers. *"Don't tell me I'm slouching. Tell me what to
do right now."*

**Buyer: Sarah, People Ops / wellbeing lead.** Wants a benefit people use, and cannot take on
the surveillance and liability risk of employee body video leaving the building. Needs proof
of engagement to renew, and will accept aggregate-only.

The employee is the demo. The buyer is the business slide. **Do not conflate them on stage.**

---

## The path, exactly as demoed

| # | Beat | Proof on screen |
|---|---|---|
| 1 | Employee describes a lower-body concern and available time — **voice**, typed as fallback | Transcript appears in the intake box |
| 2 | Approved runtime reads private context and calls FlowReset tools | Trace shows `get_user_context`, `get_reset_history` |
| 3 | Agent selects a routine **only** from the approved library | Trace shows `select_approved_routine` returning move keys |
| 4 | Plan screen explains *why this, for me, right now* | "Why this?" bullets cite the constraint and history |
| 5 | Employee **explicitly** enables camera guidance | Consent control; camera was off until this click |
| 6 | GB10 pose inference detects one supported movement issue | Named fault, overlay tracking the body |
| 7 | One correction, visible **and** locally spoken | Cue banner + Piper audio, one cue at a time |
| 8 | Employee completes and chooses Better / Same / Worse | Check-in screen |
| 9 | Personal insights update with the real session | New row, distinct from seeded demo history |
| 10 | Same path completes with external egress blocked | Terminal proof + unchanged app behaviour |

**Demo movement: chair sit-to-stand (`chair_squat`).** Easier to frame and calibrate than a
lunge. Lunge stays in the product and in the library; it is on stage only if it passes camera
evaluation. See [DEFECT_LOG.md](DEFECT_LOG.md) — as of the freeze it does **not** pass, and
there is an open blocker: the composer currently ranks `lunge` above `chair_squat`.

---

## Success criteria

Binary. If any row is No at T+120, the demo is not ready.

| Criterion | Measure |
|---|---|
| Approved runtime in the judging path | `/api/health` reports `nemoclaw` or `openclaw`, never `native` |
| All inference local | No external AI host or key anywhere in config; `scripts/verify-local.sh` passes |
| Agent, not a script | Trace shows ≥3 real tool calls before the plan appears |
| No invented movement | Every move on screen is a key in `agent/exercises.yaml` |
| No invented correction | Every cue is authored copy, not model prose |
| Camera is consensual | Off by default, one click on, one click off, session survives refusal |
| One cue at a time | No overlapping or repeated audio within the cooldown |
| Result persists | Better/Same/Worse writes locally and the insights view changes |
| Privacy is provable | `/api/health` reports `frames_stored: 0` |
| Works offline | Full path completes with egress blocked |

---

## Explicitly out of scope for this window

New exercise categories · medical or injury-prevention claims · continuous monitoring ·
per-employee employer reporting · cloud APIs or fallbacks · payments, SSO, Slack/Teams,
wearables · new hand/gaze/clinical models · major UI restyling.

---

## Language guardrails

**Use:** employee wellness · comfort · movement break · broad form awareness ·
user-controlled camera · local processing · approved exercise library.

**Never say:** diagnose · treat or cure pain · correct every exercise · prevent injury ·
fix posture · reverse myopia · clinically validated · productivity monitoring.

If asked whether this is medical: *"No. FlowReset offers movement breaks and broad form
awareness. It doesn't diagnose or treat anything, and for pain that's severe, persistent, or
worsening it tells you to see a professional."*
