# FlowReset

FlowReset is a local-first employee-wellness agent for desk workers, designed to run entirely
on the Dell Pro Max with GB10. An employee says what feels uncomfortable, how much time they
have, and whether they can stand. FlowReset selects an approved 1–10 minute reset, guides the
movement—with the camera only after explicit consent—and remembers what helped.

FlowReset can be licensed by an employer as a wellness benefit, but the product experience is
for the individual employee. There is no Workspace or team-performance section in the employee
app. Employers cannot access discomfort answers, camera data, audio, movement landmarks, or
personal histories.

No video, prompts, audio, or history are sent to an external AI provider. There is no cloud
inference fallback.

Dell × NVIDIA Local AI Hackathon, Seattle — July 26, 2026.

## Why FlowReset

Desk workers do not need another generic reminder to “take a break.” They need an answer to:

> I feel uncomfortable right now. What is the smallest useful reset I can do, and am I
> performing it safely enough to continue?

FlowReset turns that moment into an agentic workflow: understand the employee's concern,
retrieve approved movements, compose a time-appropriate plan, request camera consent, evaluate
selected movement signals, give one concise cue, collect a Better/Same/Worse response, and
adapt future recommendations.

This is a general-wellness product, not medical care, physical therapy, or a posture-grading
surveillance system.

The interface includes first-use wellness-data consent, separate per-session
camera consent, export, complete local deletion, future-consent withdrawal, a
standalone consumer-health-data notice, and a wellness/safety disclaimer.
See [`PRIVACY_AND_SAFETY.md`](PRIVACY_AND_SAFETY.md). These controls describe
the prototype honestly; they are not a claim of HIPAA certification.

## Employee experience

| Employee capability | Trigger | Camera | Default |
|---|---|---|---|
| **Reset** (the golden path) | You ask for one | Off until you opt in, per session | ✅ on |
| **My insights** | You review your own routine, outcomes, and current focus | Not used | Private to the employee |
| **Learn** | You browse desk-work education and 26 generated motion demos | Not used | Shared, source-grounded content |
| **Watch** | Accumulated sitting / neck / crossed-leg time crosses a threshold, then it *offers* | Off unless you enable watch mode | ❌ off |

Watch mode never starts a session, stops asking when you decline, and clears its accumulator
when switched off. Reset, My insights, and Learn are the three primary employee destinations.
Settings remains a utility destination for coaching, camera, privacy, data, and help controls.

## End-to-end employee workflow

1. **Onboard:** choose goals, common discomfort areas, standing constraints, preferred
   duration, and coach style. The optional concerns field accepts text or local voice input.
2. **Ask:** select an area or describe the need, for example: “My legs and glutes feel stiff.
   I have three minutes and can stand.”
3. **Plan:** the agent reads private preferences and local history, then composes a plan only
   from the approved exercise library.
4. **Choose coaching:** **Visual Coach** is the quiet standard mode. **Conversational Coach**
   is an explicit premium toggle that adds local Piper speech and typed or local-Whisper
   questions to the same session; it does not duplicate the movement flow.
5. **Consent:** the employee reviews “Why this?” and chooses whether to enable camera guidance.
6. **Guide:** local pose analysis measures supported signals such as framing, range, tempo,
   repetition phase, and selected form faults. The agent returns one authored cue at a time.
   In conversational mode, camera-generated form cues are also read aloud.
7. **Reflect:** the employee selects Better, Same, or Worse.
8. **Remember:** FlowReset stores the minimum session summary locally and updates the employee
   dashboard.

## Architecture

```
browser (MacBook)          ─── captures & displays only, no inference ───┐
  webcam → sampled JPEG frames over the LAN                             │
  mic    → recorded audio → local Whisper on the box                    │
  renders state + coach messages, pose overlay, dashboards              │
                                                                        ▼
Dell Pro Max with GB10 ─────────────────────────────────────────────────────────
  perception/  MediaPipe pose → joint angles, reps, holds, tempo, posture debt
       │ events (contracts.md §2)
  agent/       FlowReset agent: intake → tools → approved routine → cues → memory
       │       reasoning + language: Qwen via local Ollama
       │       form judge (rare, one frame): Gemma via local Ollama
  server/      FastAPI, WebSocket at /ws, Piper TTS, Whisper STT, SQLite, serves ui/
```

All inference is local. `agent/llm.py` refuses any non-loopback/non-private inference endpoint
at import time — a stray cloud URL crashes the app instead of quietly working.

### What actually runs on the GB10

The code's defaults name models that are **not** on this box. `run-demo.sh` overrides every one
of them, so use that script rather than a bare `uvicorn` command.

| Job | Model in use | Repo default | Why it differs |
|---|---|---|---|
| Agent reasoning, coach language | **`qwen3:14b`** | `qwen3:8b` | 8b was never copied from the drive; 14b was |
| Vision form judge | **`gemma4:latest`** | `qwen2.5vl:7b` | No qwen-VL on the drive. Gemma 4 is the **only** multimodal model there — it is the sole manifest carrying an `image.projector` layer, and Ollama reports `capabilities: [completion, vision, audio, tools, thinking]` |
| Pose | `pose_landmarker_heavy.task` (MediaPipe) | same | ~27 ms/frame at 720p, ~12 ms at 640×360, CPU |
| Voice out | **Piper `en_US-lessac-medium`** | `en_US-amy-medium` | lessac is the voice on the drive. The wheel also installs the `piper` binary *inside* the venv, not on `PATH` |
| Voice in | `faster-whisper base.en` | same | CTranslate2 format. A `whisper.cpp` `ggml-*.bin` will **not** work here — different format, not interchangeable |

Measured on this hardware: pose ~12–27 ms, Piper ~110 ms to synthesise a cue, a vision call
~11 s, and a normal `qwen3:14b` answer ~3.4 s. Only the first two are fast enough to sit inside
the movement loop, which is why spoken form corrections come from the deterministic detectors
rather than from a model.

### The agent is ours; the required framework is not the agent

`agent/runtime.py` is an adapter with one interface: `run(messages, tools, on_step)`.

- `native` — a complete, working tool-calling loop against local Qwen. **Currently the default.**
- `openclaw` — **implemented and verified working** on this box.
- `nemoclaw` — still a stub; NeMoClaw is not installed here.

#### OpenClaw: how it is wired, and why it is not the default

OpenClaw ships as a **Node CLI, not a Python package**. The original adapter did
`import openclaw`, which can never succeed, so the app silently fell back to `native` no matter
what `FLOWRESET_RUNTIME` said. `_run_openclaw` now drives the real CLI as a subprocess and
parses `meta.finalAssistantVisibleText` and `meta.toolSummary.tools` out of its JSON.

Because a Node CLI cannot import our Python tools, they are exposed over **MCP**
(`agent/mcp_server.py`, a dependency-free JSON-RPC stdio server). OpenClaw spawns it, lists the
tools, and calls them — the *same* functions the native loop calls, so both runtimes exercise
identical behaviour. Registered once with:

```bash
openclaw config set gateway.mode local
openclaw config patch --file deploy/openclaw-provider.json5   # point it at local Ollama
openclaw agents add flowreset --workspace <dir> --model ollama/qwen3:14b --non-interactive
openclaw mcp add flowreset --command <venv>/bin/python --arg -m --arg agent.mcp_server \
    --cwd <repo root> --parallel
```

Verified end to end: the agent calls `get_user_context` and `select_approved_routine` and picks
a real library routine, with `winnerProvider: ollama`, `winnerModel: qwen3:14b`,
`fallbackUsed: false`.

**The catch is latency: 50–100 s per turn.** Roughly 12 s of that is model time and the rest is
node start-up. The cause is prompt size, not model weight — OpenClaw injects ~18 k tokens of its
own scaffolding into every turn (`schemaChars: 37608`). The same `qwen3:14b` answers a normal
prompt in 3.4 s and an 18 k-token one in 25.3 s. Restricting tools via `tools.allow` does **not**
help (17,878 tokens vs 17,991), and neither does a lean agent workspace.

So `run-demo.sh` ships `FLOWRESET_RUNTIME=native` to keep the UI usable, and OpenClaw is one env
var away:

```bash
FLOWRESET_RUNTIME=openclaw ./run-demo.sh
```

**Competition gate:** `native` is not an approved judging runtime. Do not claim rules compliance
while `/api/health` reports `native` — flip to `openclaw` for the compliance take and budget for
the wait.

Everything that makes FlowReset a product — system instructions and coach styles, the intake
state machine, the six tool definitions and implementations, the approved-routine policy,
pose-metrics-to-cue logic, the memory schema, the safety guardrails, and the agent trace —
lives in `agent/` and `perception/` and was written here.

### The six tools

`get_user_context` · `get_reset_history` · `select_approved_routine` · `analyze_pose` ·
`generate_coaching_cue` · `record_session_result`

Two guardrails matter more than the rest:

- **`select_approved_routine` is the only way a movement reaches the user.** It composes from
  `agent/exercises.yaml` and nothing else, so a model that invents "do a deep backbend" can't
  reach anyone. The model chooses *among* approved routines; it never authors one.
- **`generate_coaching_cue` returns authored copy, not model prose.** Safety-critical form
  corrections come from the detectors' named faults and the library's wording. The model
  decides *whether and when* to speak, not *what the correction is*.

### One-minute to several-minute resets

`agent/routines.py` spends a time budget over moves ranked for the stated symptom, so the same
request yields a 60-second reset between meetings or a 10-minute one at the end of the day.
Longer sessions cycle back through the ranked list without ever repeating a move
back-to-back; anything 2 minutes or over reserves room for a closing breath. The current
duration choices are 1, 2, 3, 5, and 10 minutes.

### Scope: five areas, including lower body

Neck & shoulders · Back & hips · **Legs & glutes** · Wrists & hands · Tired eyes.

Long periods of sitting can leave employees feeling stiff or underactive through the hips,
legs, and glutes. The approved library therefore includes strengthening movements as well as
mobility work: `chair_squat` (sit-to-stand), `hip_hinge`, `lunge`, `glute_squeeze`, and
`figure_four`. Loaded movements carry stricter prototype form rules in
`perception/detectors.py`:

- **Lunge** — `knee_past_toes` (front knee travel, normalized by shin length so distance from
  the camera doesn't matter), `knee_valgus`, `torso_pitched`, `too_shallow`, `too_fast`.
  The agent still speaks at most one cue.
- **Sit-to-stand / hinge** — `knee_valgus`, `rounding` (hips back, not spine bending),
  `locked_knees`.

Crossed legs are handled as *duration*, not posture: `legs_crossed()` compares ankle and hip
ordering, and watch mode accrues time held on one side. Uncrossing resets the counter, because
the system is measuring sustained position rather than labeling the posture as inherently
wrong. Crossing your legs is not treated as a defect.

These checks are broad prototype signals, not clinical validation of “correct form.” A
production deployment would require exercise-professional review, a versioned content
approval process, broader-body testing, and confidence-threshold evaluation.

## Privacy, concretely

- Frames live in **one variable**, are decoded, inferred on, and overwritten. Never queued,
  never written to disk. `/api/health` reports `frames_stored`, and it is always `0`.
- Qwen never receives raw video. It gets work context, user choices, and structured movement
  metrics. The vision judge sees one frame, rarely, and only for planes geometry can't read.
- **Voice input does not use the Web Speech API.** The UI records locally and POSTs to
  `/api/transcribe`, where faster-whisper runs on the box. The temp file is unlinked before
  the response returns. Voice can elaborate on concerns during onboarding and can describe a
  new reset request. During a reset, the same path can ask exercise questions; the approved
  local answer is spoken by Piper when Conversational Coach is enabled. If the local Whisper
  model is unavailable, typed questions and Visual Coach remain usable.
- Memory stores symptom, routine, duration, and a Better/Same/Worse answer. No landmarks, no
  video, no audio, no scores.
- Settings has a real export, complete local deletion, and future-consent withdrawal.

### Generated Learn demos

The Learn tab contains six clickable desk-work topics and all 26 approved exercises. Each
exercise opens a generated, looping SVG motion demo driven by the same move-to-motion mapping
used in the live session. Setup, focus, duration, intensity, and safety language come from the
approved local exercise records. Users can pause the animation or build a matching reset.
These demos avoid third-party video licensing and remain available offline; they illustrate
movement direction, not a clinical range target or validated form standard.

### B2B distribution without an employee Workspace view

The commercial model is an employer wellness license with employee-controlled participation.
The current product proves the private employee workflow: Reset, My insights, and Learn.
Procurement, deployment, billing, and any future program-level administration belong in a
separate system and are not part of this employee desktop app.

## Hackathon rules and current compliance

| Requirement | FlowReset implementation | Status |
|---|---|---|
| Build the agent during the event | Team-authored prompts, state machine, tool registry, policies, memory, safety rules, trace, and UI live in this repository | Implemented |
| Use NeMoClaw, OpenClaw, or OpenShell | OpenClaw adapter implemented in `agent/runtime.py`, tools bridged over MCP, verified making real tool calls on local Ollama | Working; **not the default** — costs 50–100 s/turn, so set `FLOWRESET_RUNTIME=openclaw` for the compliance take |
| Run all inference locally on GB10 | `qwen3:14b` reasoning and `gemma4:latest` vision via local Ollama, MediaPipe pose, faster-whisper STT, Piper TTS | Implemented and verified on the box |
| No cloud AI API | `agent/llm.py` rejects non-loopback/non-private inference hosts; no external AI credentials are required | Implemented |
| Additional models available locally | Model paths are configured for assets copied from the event drive | Verify on GB10 |
| Demo runs on Dell Pro Max with GB10 | FastAPI, agent, perception, memory, and model services run on the box; MacBook is capture/display only | Verify end to end |
| Agent is built, not prebuilt | The approved runtime supplies execution infrastructure; FlowReset supplies the agent behavior and tools | Implemented |

The submission is eligible only after the approved runtime row passes. The judging path must
show a real local model response and real local tool calls; the preview/mock mode is not a
substitute.

### How to prove local-first operation

1. Start the approved runtime and local models on the GB10.
2. Show `/api/health`: approved runtime active, local LLM reachable, pose available,
   `frames_stored: 0`, and no external AI APIs.
3. Run `./scripts/verify-local.sh`.
4. Block external internet egress while preserving the MacBook-to-GB10 LAN/SSH connection.
5. Complete request → tool calls → camera guidance → outcome with the network blocked.
6. Show the local agent trace and keep a terminal recording as backup evidence.

## Quickstart (on the box)

```bash
pip install -r requirements.txt
```

Models must be available locally on the event drive. Copy them to the box before blocking
egress:

```bash
# Ollama model blobs from the event drive (see copy_models.sh on this box).
sudo bash copy_models.sh

# Pose weights, Piper voice, Whisper weights.
cp /Volumes/<drive>/pose_landmarker_heavy.task models/
cp /Volumes/<drive>/en_US-lessac-medium.onnx* voices/         # voice out
python -c "from faster_whisper.utils import download_model; \
           download_model('base.en', output_dir='models/faster-whisper-base.en')"
```

Seed the demo history, then launch with `run-demo.sh` — it pins every model path and name to
what is actually installed, which the code defaults do not:

```bash
python -m server.seed
./run-demo.sh
```

`run-demo.sh` is the single source of truth for configuration:

| Variable | Value on this box | What it does |
|---|---|---|
| `FLOWRESET_RUNTIME` | `native` | `openclaw` for the compliance take |
| `FLOWRESET_REASON_MODEL` | `qwen3:14b` | agent reasoning and coach language |
| `FLOWRESET_VISION_MODEL` | `gemma4:latest` | the only multimodal model available |
| `FLOWRESET_PIPER_BIN` | `.venv/bin/piper` | not on `PATH`; `shutil.which("piper")` returns `None` without this |
| `FLOWRESET_PIPER_VOICE` | `voices/en_US-lessac-medium.onnx` | |
| `FLOWRESET_WHISPER_MODEL` | `models/faster-whisper-base.en` | |
| `FLOWRESET_DETERMINISTIC` | `1` | pin circuits per check-in (`routines.DEMO_RECIPES`) so every rehearsal and take is identical |
| `FLOWRESET_COACHED_MOVES` | `lunge` | which moves get **spoken form correction** |

Two demo-shaping notes. The composer was always deterministic in its *ranking* — the executed
plan comes from `select_approved_routine`, never from model prose — but it shuffled the tail of
a round when given no seed; `FLOWRESET_DETERMINISTIC=1` pins it.

And `FLOWRESET_COACHED_MOVES` scopes *form correction* only. Uncoached moves are not silent:
they still get their setup cue, framing prompts, and the mind-muscle cue ("that's your upper
trapezius working — you should feel a long line down the side of your neck"). What they skip is
critique, because a confident wrong correction on camera is worse than saying nothing. The skip
emits a `guardrail` trace entry so the silence is visible as a decision rather than a gap.

It also raises the websocket ping timeouts, so a long local inference cannot drop the camera
socket mid-session.

On the MacBook, forward the server through SSH:

```bash
ssh -L 8000:localhost:8000 dell@<box-ip>
```

Any free local port works — `-L 8001:localhost:8000` then `http://localhost:8001` is fine.

Then open `http://localhost:8000`. Using localhost is important because browsers allow webcam
and microphone access on secure contexts; a plain `http://<box-ip>:8000` page may not receive
those permissions. Ollama remains bound to `127.0.0.1` on the GB10 and is never exposed to the
MacBook. See `.env.example` for every configuration option.

### Verify it's local before you demo

```bash
./scripts/verify-local.sh
```

Greps the tree for cloud inference hosts and SDKs, confirms the configured endpoint is
loopback or RFC1918, and prints model health. Run it with egress blocked too — the golden path
must complete either way.

## UI without the box

The UI is a pure renderer of `state` + `coach` messages, so `ui/mock.js` stands in for the
backend when the WebSocket is unreachable. Lane 3 can build screens on any laptop:

```bash
python3 -m http.server 8777      # then open /ui/index.html
```

Add `?preview` to the URL to force the stand-in even when the box *is* reachable.

There is also a single self-contained file — one HTML with the CSS and all modules
inlined, no server and no network needed. Useful as a demo backup, for pitch
screenshots, and for sending the interface to someone without a GB10:

```bash
python3 scripts/build-preview.py     # writes ui/preview.html (~104 KB)
```

`ui/preview.html` is generated — edit `ui/*.js` and rebuild, never the bundle.

**None of this is the judging path.** When the stand-in is active the status badge
reads *"Preview — no box attached"* and a banner under the header says plainly that
no model is running, so a shared preview can't be mistaken for local inference.

## Repo layout & lanes

| Folder | Lane | Contents |
|---|---|---|
| `perception/` | 1 | `pose.py` MediaPipe + frame sink · `detectors.py` angles, reps, holds, form faults · `debt.py` watch-mode accumulator |
| `agent/` | 2 | `coach.py` the agent · `runtime.py` stack adapter · `tools.py` the six tools · `routines.py` composer · `persona.py` prompts + claim filter · `memory.py` SQLite · `llm.py` local Qwen client · `exercises.yaml` library |
| `ui/` | 3 | `app.js` screens · `charts.js` · `overlay.js` skeleton · `mock.js` offline stand-in · no build step |
| `server/` | 4 | `main.py` FastAPI + `/ws` · `bus.py` broadcast + queue · `tts.py` Piper · `stt.py` Whisper · `seed.py` demo history |

**Contracts between lanes live in [contracts.md](contracts.md). Read it first.
Change it only by team agreement — it's the constitution.**

## Technical plan and remaining gates

| Priority | Work | Definition of done |
|---|---|---|
| P0 | Approved runtime | NeMoClaw or OpenClaw executes the same FlowReset tool registry; health and trace show the approved runtime |
| P0 | GB10 model assets | Reasoning model, vision model, pose model, Whisper, and optional Piper resolve without downloading or calling external AI |
| P0 | Golden-path integration | MacBook voice/camera → SSH tunnel → GB10 agent/vision → visible and spoken cue → saved outcome |
| P0 | Offline verification | Golden path succeeds with external egress blocked |
| P0 | Demo reliability | Three clean runs plus a recorded backup with audible local voice coaching |
| P1 | Voice input | Local faster-whisper supports onboarding concerns and reset intake; typed fallback remains available |
| P1 | Lower-body validation | Calibrate lunge and sit-to-stand thresholds against varied bodies, clothing, camera angles, and mobility ranges |
| P2 | Production knowledge governance | Exercise-professional approval, content versioning, evaluation set, accessibility review, and deployment controls |

Do not spend the final build window expanding the exercise library. The strongest live demo is
one reliable, camera-guided reset, while the interface and approved library show the broader
1–10 minute and lower-body scope.

## Recommended live demo

1. An employee uses local voice intake: “My hips and legs feel stiff after sitting. I have
   three minutes and I can stand.”
2. The agent reads private preferences/history and calls `select_approved_routine`.
3. The employee reviews “Why this?” and enables the camera.
4. Use a chair sit-to-stand for the most robust demo, or a split-stance lunge only after
   successful calibration. Intentionally trigger one supported fault and let FlowReset speak
   one approved correction.
5. Complete the reset, choose Better, and show **My insights** update with a recommended next step.
6. Show the privacy setting that makes employer sharing opt-in; do not switch into a team view.
7. Show the approved runtime trace and repeat the local-first proof with external egress
   blocked.

## Deadlines (hard)

- **13:00** — integration checkpoint 1: skeleton on screen end-to-end
- **16:00** — integration checkpoint 2: full loop (request → plan → guided reset → result)
- **17:00** — start recording backup demo video
- **18:00** — internal hard deadline (the photographed rules say 18:00; the schedule says 18:30)
- **18:30** — demo video + submission deadline. CODE FREEZE.
- **19:00** — deck deadline

## Not medical care

FlowReset offers movement breaks and form awareness. It does not diagnose, treat, cure, or
prevent anything, and `agent/persona.py` filters those claims out of model output before
display. Red-flag symptoms in the intake — numbness, weakness, chest pain, vision changes —
skip the routine entirely and point at a healthcare professional.
