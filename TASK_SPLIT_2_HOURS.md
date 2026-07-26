# FlowReset — Two-Hour Parallel Task Split

Three people build in parallel for two hours, followed by one shared hour for integration,
evaluation, recording, and submission preparation.

## Hardware reality: one shared Dell GB10

The team has **one Dell Pro Max with GB10**, not one box per engineer. The three personal
laptops are development, camera, microphone, and documentation clients. They do not run the
submitted AI inference path.

```text
Software engineer's laptop ──┐
Full-stack MacBook ──────────┼── SSH / local network ──> one Dell Pro Max with GB10
PM laptop ───────────────────┘                            agent + models + pose + memory
```

Only one copy of Ollama, the FlowReset server, pose inference, and the approved agent runtime
should run on the Dell. Do not start competing servers or duplicate model processes from
different SSH sessions.

### Single-box access policy

- The **software engineer is the sole box operator** during the two-hour build. This person
  starts/stops services, changes environment variables, installs dependencies, copies models,
  and owns the canonical GB10 checkout.
- The **full-stack engineer develops against `ui/mock.js` first**, then connects the MacBook to
  the single shared server after Person 1 declares it ready. They may inspect logs over SSH but
  should not restart or reconfigure services.
- The **data consultant/PM does not require GB10 access** during parallel work. They use the
  preview, screenshots, test matrix, and recorded results until the shared validation hour.
- Code moves to the Dell through small reviewed commits. The box operator pulls or
  cherry-picks them at the scheduled integration checkpoints.
- If the Dell is being restarted or its runtime is changing, Person 1 announces a short
  maintenance window so Person 2 does not mistake expected downtime for an application bug.

### Shared Dell schedule

| Time | Dell access | What everyone else does |
|---|---|---|
| T+0–40 | Person 1 exclusive: models, approved runtime, server, health | Person 2 uses the mock/preview; Person 3 prepares content and evaluation |
| T+40–70 | Persons 1 and 2 pair: one server, one MacBook camera/mic client | Person 3 reviews movement rules and observes test results |
| T+70–100 | Person 1 tunes inference while Person 2 consumes the same live endpoints | Person 3 executes the evaluation matrix without changing box services |
| T+100–120 | One integrated build only; Person 1 controls restarts | Persons 2 and 3 perform judging-path QA |
| T+120–180 | All three validate the single frozen GB10 build | No parallel server or model changes |

## Outcome for the build window

By T+120, FlowReset must complete one repeatable judging path:

1. An employee uses text or local voice to describe a concern and available time.
2. The approved local agent runtime reads private context and calls FlowReset tools.
3. The agent selects a routine only from the approved exercise library.
4. The employee explicitly enables camera guidance.
5. GB10 pose inference detects one supported movement issue.
6. FlowReset gives one visible and locally spoken correction.
7. The employee completes the reset and chooses Better, Same, or Worse.
8. The personal dashboard updates.
9. The Workspace view shows only eligible, opt-in aggregate data.
10. The same path works with external internet egress blocked.

The default lower-body demo should use **chair sit-to-stand**, which is easier to frame and
calibrate. Use a **split-stance lunge** only if it passes the camera evaluation by T+60.

## Scope freeze

### Must finish

- NeMoClaw or OpenClaw active in the actual judging path
- All inference on the Dell Pro Max with GB10
- MacBook voice and camera reaching the GB10 through the SSH tunnel
- One reliable camera-to-agent-to-voice coaching loop
- Local voice input during onboarding and reset intake, with a typed fallback
- One lower-body routine with approved, deterministic coaching cues
- Better/Same/Worse result saved locally
- Personal and aggregate B2B dashboard proof
- Offline verification and backup demo recording

### Do not add during this window

- New exercise categories
- Medical or injury-prevention claims
- Continuous employee monitoring
- Individual employee reporting for employers
- Cloud APIs or cloud fallbacks
- Payments, SSO, Slack/Teams, wearables, or production identity
- New hand, gaze, or specialist clinical models
- Major UI restyling

## Coordination rules

- Each person works on a separate branch and uses their own coding agent.
- Do not edit another owner's files without asking in the team channel.
- Contract changes require all three people to agree.
- Commit small, working checkpoints instead of one large final commit.
- Only Person 1 operates the Dell services; parallel coding happens on the three laptops.
- The software engineer owns the critical path. If the approved runtime is blocked, stop
  optional work and help resolve it.
- No new features after T+100.
- Code freezes at T+120.

Suggested branches:

- `feat/gb10-agent-video`
- `feat/live-session-integration`
- `docs/demo-evaluation`

## Person 1 — Software engineer

**Owns:** GB10 runtime, local inference, pose evaluation, agent events, and local speech output.

Primary files:

- `agent/runtime.py`
- `agent/tools.py`
- `agent/exercises.yaml`
- `perception/pose.py`
- `perception/detectors.py`
- `server/main.py`
- `server/tts.py`

| Time | Task | Deliverable |
|---|---|---|
| T+0–15 | Verify the GB10 environment: approved runtime, Qwen models, pose model, Whisper, Piper, FastAPI, and Ollama | `/api/health` identifies every available local component |
| T+15–40 | Complete and activate the NeMoClaw or OpenClaw adapter | Real local model turn and FlowReset tool calls through an approved runtime |
| T+40–65 | Calibrate chair sit-to-stand signals; test lunge only if time remains | Stable framing, rep phase, tempo, depth, knee, and torso events |
| T+65–90 | Connect named pose fault → agent decision → approved cue → Piper | One correction is visible and audible within approximately two seconds |
| T+90–105 | Add confidence gating, 1.5–2 second persistence, and a 5–8 second speech cooldown | No rapid or repetitive voice warnings |
| T+105–120 | Run the local verification script, document launch commands, and commit | Repeatable box startup and clean handoff |

### Person 1 acceptance criteria

- `/api/health` reports `nemoclaw` or `openclaw`, never `native`, for the judging build.
- The visible trace contains real calls such as `get_user_context`,
  `select_approved_routine`, `analyze_pose`, and `record_session_result`.
- The agent never invents an exercise or a safety-critical correction.
- Low-confidence pose input produces a framing/recalibration message, not a form judgment.
- Raw frames are overwritten in memory and `/api/health` reports `frames_stored: 0`.
- Piper failure degrades to on-screen text without breaking the session.

## Person 2 — Full-stack engineer

**Owns:** MacBook-to-GB10 connection, live session UX, state handling, and demo recovery.

Primary files:

- `ui/app.js`
- `ui/index.html`
- `ui/styles.css`
- `ui/overlay.js`
- `ui/mock.js`
- `server/bus.py`
- `scripts/build-preview.py`

Do not edit `server/main.py` during the parallel window; coordinate event-contract changes
with Person 1.

| Time | Task | Deliverable |
|---|---|---|
| T+0–20 | Use `ui/mock.js` to review onboarding, intake, and the complete judging flow without using the Dell | UI work continues while Person 1 prepares the box |
| T+20–40 | Polish live-session states: camera permission, framing, listening, analyzing, coaching, paused, completed | The user always knows what the system is doing |
| T+40–60 | After Person 1 declares the server ready, start one SSH tunnel and verify WebSocket, camera, microphone, and health data | MacBook opens `http://localhost:8000` and reaches the single GB10 server |
| T+60–90 | Integrate pose events and spoken feedback; exercise onboarding voice and confirm camera-off/text fallbacks | Visible cue, local voice cue, overlay, timer, and Stop control remain synchronized |
| T+90–105 | Add/retest failure recovery: denied permission, lost framing, tunnel drop, server restart, unavailable STT/TTS | Clear recovery instructions with no dead end |
| T+105–120 | Add one-click demo reset, rebuild the preview, and capture a clean fallback flow | Repeatable judging setup and preview backup |

### Person 2 acceptance criteria

- Camera and microphone permissions work through `http://localhost:8000`.
- The interface never presents preview/mock data as live GB10 inference.
- “All AI local on GB10 · No external AI API” appears only when health checks support it.
- Camera consent is explicit and reversible.
- The user receives one correction at a time.
- The result screen updates the real dashboard.
- Workspace mode never exposes an individual employee record.

## Person 3 — Data consultant and PM

**Owns:** approved content, evaluation, B2B story, pitch, video plan, and submission readiness.

Primary files:

- `FLOWRESET_KNOWLEDGE_BASE.md`
- `TASK_SPLIT_2_HOURS.md`
- New evaluation and demo documents
- BuilderBase submission copy
- Pitch deck and demo-video assets

Avoid editing application source during the parallel window.

| Time | Task | Deliverable |
|---|---|---|
| T+0–20 | Freeze the employee persona, buyer, golden path, and success criteria | One-sentence problem, solution, and B2B value proposition |
| T+20–45 | Review chair sit-to-stand and lunge setup, limitations, faults, cues, and stop conditions | Approved cue sheet aligned with `agent/exercises.yaml` |
| T+45–65 | Build a 10–12 case pass/fail evaluation matrix | Test cases for correct movement, common faults, uncertainty, privacy, and failures |
| T+65–85 | Run evaluation cases with the engineers and keep a prioritized defect list | Evidence-backed go/no-go decision for sit-to-stand versus lunge |
| T+85–105 | Write the five-minute pitch and 60–90 second backup-video script | Timed narrative mapped to the 30/30/30/10 judging rubric |
| T+105–120 | Prepare BuilderBase copy, screenshots, architecture visual, and final checklist | Submission package ready for the validation hour |

### Minimum evaluation matrix

| Case | Expected behavior |
|---|---|
| Camera off | Session continues with timer/text/voice; no pose claim |
| Camera denied | Explain how to retry or continue without camera |
| No person visible | Ask the user to move into frame |
| Lower body cropped | Ask the user to move back before judging the movement |
| Correct controlled repetitions | Positive confirmation; no repeated warning |
| Movement too fast | One approved pacing cue |
| Limited depth or range | Conservative cue containing “if comfortable” |
| Knee or torso fault persists | One named, authored form cue |
| Low model confidence | Recalibrate; do not classify form |
| User selects Worse | Do not intensify; offer stopping and appropriate safety language |
| External egress blocked | Full golden path continues |
| Workspace cohort below 10 | Aggregate result is suppressed |

### PM language guardrails

Use:

- employee wellness
- comfort
- movement break
- broad form awareness
- user-controlled camera
- local processing
- approved exercise library

Avoid:

- diagnose
- treat or cure pain
- correct every exercise
- prevent injury
- fix posture
- reverse myopia
- clinically validated
- productivity monitoring

## Parallel checkpoints

### T+15 — Environment gate

- Person 1 confirms model/runtime availability.
- Person 2 confirms the mock/preview path and browser permission requirements.
- Person 3 announces the frozen golden path.

If the required runtime is not importable, ask the event mentor immediately. Do not wait until
the validation hour.

### T+60 — First integration gate

- Approved runtime has completed at least one real tool call.
- A frame reaches the GB10 and produces landmarks.
- The MacBook is connected to the one shared server through its SSH tunnel.
- Chair sit-to-stand has a usable detector.
- PM decides whether lunge is safe enough for the demo.

If lunge is unreliable, remove it from the live demonstration. It can remain visible as
broader product scope.

### T+90 — Full-loop gate

- Request → plan → consent → camera → cue → completion works once.
- Local voice cue is audible, or the text fallback is confirmed.
- Dashboard receives a real session result.
- Pitch and video scripts are ready.

### T+100 — Feature stop

Only fix judging-path defects. No new routines, screens, integrations, or charts.

### T+120 — Code freeze

Merge the three branches into `main`, update the canonical checkout on the single Dell, tag
the judging build, restart its services once, and begin the shared validation hour.

## Final one-hour integration and evaluation

| Time | All-team task | Exit condition |
|---|---|---|
| T+120–130 | Merge, resolve conflicts, reinstall if needed, restart the GB10 server and SSH tunnel | Clean judging build is running |
| T+130–145 | Run the golden path three times on the real hardware | Three consecutive successful sessions |
| T+145–153 | Block external internet egress and run it again | Local-first proof captured |
| T+153–160 | Test the highest-risk recovery cases | No judging-path dead ends |
| T+160–172 | Record two concise backup demo takes with local voice audio | At least one complete, understandable video |
| T+172–178 | Rehearse and time the five-minute pitch | Speakers finish under five minutes |
| T+178–180 | Verify the already-prepared submission package and every link | Submission-ready package |

## Demo-video storyline

Recommended 75-second structure:

| Time | Story beat |
|---|---|
| 0–8 sec | A desk worker feels stiff after sitting through meetings and focused work |
| 8–18 sec | The employee speaks a three-minute lower-body concern during intake |
| 18–30 sec | The local agent reads private context and selects an approved plan |
| 30–52 sec | Camera guidance detects one persistent issue and speaks one correction |
| 52–62 sec | The employee completes the reset and selects Better |
| 62–70 sec | Personal progress updates; Workspace shows aggregates only |
| 70–75 sec | Approved runtime trace and “All AI local on GB10” proof |

Core narrative:

> FlowReset gives desk workers the right short reset at the moment they need it. Because body
> video, voice, movement signals, and wellness history are sensitive, the complete agentic
> workflow runs locally on the GB10. Employers can offer a useful wellness benefit without
> turning the camera into surveillance.

## Final go/no-go checklist

- [ ] `FLOWRESET_RUNTIME` is an approved runtime, not `native`
- [ ] Reasoning and vision models respond locally on the GB10
- [ ] No external AI key or hosted inference URL is configured
- [ ] MacBook uses the SSH tunnel and opens `http://localhost:8000`
- [ ] Voice input works locally or typed fallback is demonstrated
- [ ] Camera consent, camera-off, and Stop controls work
- [ ] One lower-body movement is calibrated and repeatable
- [ ] Voice correction is audible in the recording
- [ ] Better/Same/Worse saves and updates the dashboard
- [ ] Workspace data is opt-in and k-anonymized
- [ ] Golden path works with external egress blocked
- [ ] Backup video, architecture visual, pitch, and submission copy are complete
