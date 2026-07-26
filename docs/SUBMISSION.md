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

### What we'd build next
> Longer-horizon personalization across weeks, a calendar-aware reset that fits the gap
> between meetings, and an opt-in workspace view for People Ops with a k-anonymity floor —
> aggregate engagement only, never an individual.

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

1. **Intake** — five body areas, duration chips, mic button.
2. **Agent plan** — the "Why this?" panel, with the trace panel open beside it. *The single
   most important screenshot: it shows reasoning, not a script.*
3. **Guided session** — overlay tracking, timer, one cue in the banner.
4. **Check-in** — Better / Same / Worse.
5. **My insights** — the new session visible against seeded history.
6. **`/api/health`** — runtime name, models, `frames_stored: 0`.
7. **Terminal with egress blocked** — app still completing the path.

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
- [ ] Voice intake works locally, or typed fallback demonstrated
- [ ] Trace shows ≥3 real tool calls before the plan
- [ ] Every move shown exists in `agent/exercises.yaml`
- [ ] Camera consent explicit, reversible, and off by default
- [ ] One lower-body movement calibrated and repeatable (**chair sit-to-stand**)
- [ ] One correction visible and audible
- [ ] Better/Same/Worse saves and the insights view updates
- [ ] `/api/health` reports `frames_stored: 0`

### Open decisions — resolve before freeze
- [ ] **DEFECT-1**: composer picks `chair_squat`, not `lunge`, for the demo request
- [ ] **DEFECT-2**: Workspace view restored to nav, **or** B2B removed from the judging path
      and this checklist
- [ ] **DEFECT-3**: `hip_hinge.fault_knee_valgus` authored
- [ ] Evaluation matrix C1–C6, C10–C12 passing three consecutive runs

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

---

## Deadlines

| Time | Item |
|---|---|
| **T+120** | Code freeze. Merge to `main`, tag the judging build, restart GB10 services once. |
| **T+160–172** | Record two backup takes. |
| **18:00** | **Internal hard deadline** — BuilderBase project and demo video submitted. |
| 18:30 | Displayed submission deadline. Treat 18:00 as real. |
| 19:00 | Pitch deck deadline. |
