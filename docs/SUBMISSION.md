# Submission package — T+105–120 deliverable

Owner: Person 3. Everything BuilderBase needs, ready to paste. **Internal deadline 18:00.**

---

## BuilderBase copy

### Name
FlowReset

### One-liner (140 char)
> A private wellbeing agent that turns a desk worker's discomfort and spare minutes into a
> guided movement break — running entirely on the GB10.

### Short description (~100 words)
> Desk workers know they should take breaks and still don't, because in the moment nobody can
> tell them what the smallest useful thing to do is or whether they're doing it right.
> FlowReset is a local agent that fixes that moment. You say what feels uncomfortable and how
> long you have; it reads your private history, composes a reset from an approved exercise
> library, guides the movement with optional camera feedback, and remembers what helped. Every
> model — language, vision, speech in, speech out — runs on the Dell Pro Max with GB10. Body
> video never leaves the machine, because there is nowhere for it to go.

### How we used the required stack
> The FlowReset agent was built during the event on [NeMoClaw/OpenClaw]. It exposes seven
> local tools — read user context, read reset history, select an approved routine, retrieve
> wellness guidance, analyze pose, generate a coaching cue, and record the result — and the
> visible trace shows those calls landing in real time. Qwen (`qwen3:8b`) is the reasoning and
> language layer, with `qwen2.5vl:7b` as a vision form judge. MediaPipe handles pose, Piper
> handles speech out, faster-whisper handles speech in. All via local Ollama on the box.

### Why local matters here
> This workflow handles body video, voice, and health-adjacent history — the data least
> appropriate to send to a third party. Local execution also puts coaching cues in front of
> the user while they're still moving, keeps the app working with the network unplugged, and
> lets an employer deploy wellbeing without routing employee video through a vendor.
> `agent/llm.py` refuses any non-loopback inference endpoint at import time, so a cloud URL
> crashes the app instead of quietly working. The full judging path completes with external
> egress blocked.

### Consent and the employer boundary
> Nothing is collected before affirmative first-use consent, and camera use is asked again,
> separately, every session. Employees can export their data, delete it, and withdraw consent
> for future collection without that deletion being forced on them. The employee application
> has no team view at all: employer reporting is a separate admin capability that receives
> participation counts above a ten-person floor, and the query cannot return body areas or
> Better/Same/Worse responses — those fields were removed, not hidden. See
> `PRIVACY_AND_SAFETY.md`.

### What we'd build next
> Longer-horizon personalization across weeks, a calendar-aware reset that fits the gap
> between meetings, and a proper admin console for People Ops on top of the existing
> aggregate-only, k-anonymized query.

---

## Architecture visual

One slide. Everything AI sits inside the GB10 boundary; the MacBook is I/O only.

```
┌─ MacBook (capture + display only — no inference) ──────────────┐
│  webcam ──sampled JPEG──┐        mic ──recorded audio──┐       │
│  browser UI: plan, overlay, timer, insights            │       │
└────────────────────────┬───────────────────────────────┬───────┘
                         │      SSH tunnel / LAN         │
┌────────────────────────▼───────────────────────────────▼───────┐
│  Dell Pro Max with GB10                                        │
│                                                                │
│   [NeMoClaw/OpenClaw]  ── 7 local tools ──┐                    │
│        │                                  │                    │
│        ├─ Qwen  qwen3:8b      reasoning + coach language       │
│        ├─ Qwen  qwen2.5vl:7b  vision form judge (1 frame)      │
│        ├─ MediaPipe pose      joint angles, reps, faults       │
│        ├─ faster-whisper      speech in                        │
│        ├─ Piper               speech out                       │
│        └─ SQLite              symptom, routine, better/same/worse│
│                                                                │
│   Frames: analysed in memory, overwritten. frames_stored = 0   │
└────────────────────────────────────────────────────────────────┘

            No cloud LLM. No cloud vision. No API key.
```

**Say on the slide:** the MacBook captures and displays; every inference step runs on the GB10.

---

## Screenshots to capture

Shoot at 1440×960, light theme, seeded history present.

1. **First-use consent** — the gate, with the box unticked and accept disabled.
2. **Intake** — five body areas, duration chips, mic button.
3. **Agent plan** — the "Why this?" panel *and* the per-session camera disclosure, with the
   trace panel open beside it. *The single most important screenshot: it shows reasoning, not
   a script.*
4. **Guided session** — overlay tracking, movement guide, timer, one cue in the banner.
5. **Check-in** — Better / Same / Worse.
6. **My insights** — the new session visible against seeded history.
7. **Privacy center** — data map, export, delete, withdraw controls.
8. **`/api/health`** — runtime name, models, `frames_stored: 0`.
9. **`curl /api/workspace`** — participation counts only, no body area, no responses. *This
   replaces a Workspace screenshot; there is no employee-facing team view by design.*
10. **Terminal with egress blocked** — app still completing the path.

---

## Final checklist

Tick during the validation hour. Anything unticked at 17:45 is a go/no-go conversation.

### Competition rules
- [ ] Agent built during the event
- [ ] `FLOWRESET_RUNTIME` is `nemoclaw` or `openclaw` — **not `native`**
- [ ] Reasoning and vision models respond locally on the GB10
- [ ] No external AI key or hosted inference URL anywhere in config
- [ ] `scripts/verify-local.sh` passes on the box
- [ ] Full golden path completes with external egress blocked
- [ ] Demo runs from the Dell Pro Max with GB10

### The judging path
- [ ] First-use consent gate blocks a fresh profile from reaching a personalized reset
- [ ] Voice intake works locally, or typed fallback demonstrated
- [ ] Trace shows ≥3 real tool calls before the plan
- [ ] Every move shown exists in `agent/exercises.yaml`
- [ ] Per-session camera consent explicit, reversible, and off by default
- [ ] One lower-body movement calibrated and repeatable (**chair sit-to-stand**)
- [ ] One correction visible and audible
- [ ] Better/Same/Worse saves and the insights view updates
- [ ] `/api/health` reports `frames_stored: 0`
- [ ] `/api/workspace` payload contains no body area, no responses, no per-person row

### Open defects — resolve before freeze
- [ ] **DEFECT-1** (P1, blocks demo): composer picks `chair_squat`, not `lunge`, for the demo
      request. One word in `exercises.yaml`; fix verified locally.
- [x] **DEFECT-2**: resolved by decision — no employee team view; employer reporting is
      admin-only and returns counts only (`2450d0a`)
- [ ] **DEFECT-3** (P1 correctness): `hip_hinge.fault_knee_valgus` authored
- [ ] **DEFECT-4** (P3): rename dead `fault_rushing` keys; `glute_squeeze` should be
      `fault_too_fast`
- [ ] Evaluation matrix C1–C6, C10–C12, C14, C15 passing three consecutive runs

### Assets
- [ ] Backup demo video recorded, with audible local voice
- [ ] Seven screenshots captured
- [ ] Architecture slide exported
- [ ] Five-minute pitch rehearsed under time
- [ ] BuilderBase copy pasted and every link verified
- [ ] Backup recording accessible locally (not only in the cloud)

### Language sweep
- [ ] No "diagnose", "treat", "cure", "prevent injury", "fix posture", "clinically validated"
- [ ] No claim that the employer can see an individual
- [ ] No claim the model sees raw video — it receives structured metrics
- [ ] No claim of HIPAA compliance — `PRIVACY_AND_SAFETY.md` is explicit that local processing
      alone does not create it
- [ ] Employer reporting described as **admin-only**, never as a screen in the employee app

---

## Deadlines

| Time | Item |
|---|---|
| **T+120** | Code freeze. Merge to `main`, tag the judging build, restart GB10 services once. |
| **T+160–172** | Record two backup takes. |
| **18:00** | **Internal hard deadline** — BuilderBase project and demo video submitted. |
| 18:30 | Displayed submission deadline. Treat 18:00 as real. |
| 19:00 | Pitch deck deadline. |
