# postureAI — FlowReset

A private wellbeing agent for desk workers, running entirely on the Dell Pro Max with GB10.
You say what feels uncomfortable, how long you have, and whether you can stand. FlowReset
picks the smallest reset that fits, guides the movement — with the camera only if you want —
and remembers what actually helped.

No video, prompts, or history leave the box. There is no cloud fallback.

Dell × NVIDIA Local AI Hackathon, Seattle — July 26, 2026.

## Two modes, one agent

| Mode | Trigger | Camera | Default |
|---|---|---|---|
| **Reset** (the golden path) | You ask for one | Off until you opt in, per session | ✅ on |
| **Watch** | Accumulated sitting / neck / crossed-leg time crosses a threshold, then it *offers* | Off unless you enable watch mode | ❌ off |

Watch mode never starts a session, stops asking when you decline, and clears its accumulator
when switched off. Reset mode is what the live demo uses.

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
       │       approved knowledge: rationale → camera checks → sources → limitations
       │       reasoning + language: Qwen via local Ollama
       │       form judge (rare, one frame): qwen2.5vl via local Ollama
  server/      FastAPI, WebSocket at /ws, Piper TTS, Whisper STT, SQLite, serves ui/
```

All inference is local: **`qwen3:8b`** (agent reasoning and coach language) and
**`qwen2.5vl:7b`** (vision form judge) via Ollama, MediaPipe pose, Piper TTS,
faster-whisper STT. `agent/llm.py` refuses any non-loopback/non-private inference endpoint at
import time — a stray cloud URL crashes the app instead of quietly working.

The agent retrieves source-grounded guidance from `agent/knowledge.yaml`; employee
history remains outside the shared content store. See
[`FLOWRESET_KNOWLEDGE_BASE.md`](FLOWRESET_KNOWLEDGE_BASE.md) for the content and
privacy contract and [`FEATURE_STATUS.md`](FEATURE_STATUS.md) for the truthful
implemented/missing feature matrix. UI decisions and regression checks are
mapped to Nielsen's ten heuristics in
[`USABILITY_HEURISTIC_AUDIT.md`](USABILITY_HEURISTIC_AUDIT.md).

### The agent is ours; the framework is not the agent

`agent/runtime.py` is an adapter with one interface: `run(messages, tools, on_step)`.

- `native` — a complete, working tool-calling loop against local Qwen. **Default.**
- `nemoclaw` / `openclaw` — thin adapters. Two lines marked `TODO(box)` each; set
  `FLOWRESET_RUNTIME=nemoclaw` on the box and nothing else in the app changes.

Everything that makes FlowReset a product — system instructions and coach styles, the intake
state machine, the seven tool definitions and implementations, the approved-routine policy,
pose-metrics-to-cue logic, the memory schema, the safety guardrails, and the agent trace —
lives in `agent/` and `perception/` and was written here.

### The seven tools

`get_user_context` · `get_reset_history` · `retrieve_wellness_guidance` ·
`select_approved_routine` · `analyze_pose` · `generate_coaching_cue` ·
`record_session_result`

Two guardrails matter more than the rest:

- **`select_approved_routine` is the only way a movement reaches the user.** It composes from
  `agent/exercises.yaml` and nothing else, so a model that invents "do a deep backbend" can't
  reach anyone. The model chooses *among* approved routines; it never authors one.
- **`generate_coaching_cue` returns authored copy, not model prose.** Safety-critical form
  corrections come from the detectors' named faults and the library's wording. The model
  decides *whether and when* to speak, not *what the correction is*.

### 1 minute to 10 minutes

`agent/routines.py` spends a time budget over moves ranked for the stated symptom, so the same
request yields a 60-second reset between meetings or a 10-minute one at the end of the day.
Longer sessions cycle back through the ranked list without ever repeating a move
back-to-back; anything 2 minutes or over reserves room for a closing breath.

### Scope: five areas, including lower body

Neck & shoulders · Back & hips · **Legs & glutes** · Wrists & hands · Tired eyes.

Long sitting leaves glutes under-used and hip flexors short, so the library loads as well as
stretches: `chair_squat` (sit-to-stand), `hip_hinge`, `lunge`, `glute_squeeze`, and
`figure_four`. These are the only moves that load a muscle rather than lengthen one, so they
carry the strictest form rules in `perception/detectors.py`:

- **Lunge** — `knee_past_toes` (front knee travel, normalized by shin length so distance from
  the camera doesn't matter), `knee_valgus`, `torso_pitched`, `too_shallow`, `too_fast`.
  Ordered by what hurts if you get it wrong; the agent still speaks at most one cue.
- **Sit-to-stand / hinge** — `knee_valgus`, `rounding` (hips back, not spine bending),
  `locked_knees`.

Crossed legs are handled as *duration*, not posture: `legs_crossed()` compares ankle and hip
ordering, and watch mode accrues time held on one side. Uncrossing resets the counter, because
switching sides genuinely relieves the load. Crossing your legs is not a defect; staying that
way for half an hour is what leaves one hip tighter than the other.

## Privacy, concretely

- Frames live in **one variable**, are decoded, inferred on, and overwritten. Never queued,
  never written to disk. `/api/health` reports `frames_stored`, and it is always `0`.
- Qwen never receives raw video. It gets work context, user choices, and structured movement
  metrics. The vision judge sees one frame, rarely, and only for planes geometry can't read.
- **Voice input does not use the Web Speech API.** That browser API streams microphone audio to
  Google's servers — one line of JavaScript that would break both the competition rule and
  every privacy claim in the pitch. The UI records locally and POSTs to `/api/transcribe`,
  where faster-whisper runs on the box. The temp file is unlinked before the response returns.
- Memory stores symptom, routine, duration, and a Better/Same/Worse answer. No landmarks, no
  video, no audio, no scores.
- Settings has a real export and a real delete.

### Workspace (B2B) mode

`memory.workspace_summary()` aggregates in SQL and suppresses any cohort under
`K_ANONYMITY = 10`. It takes no `user_id` parameter, so there is no per-person query to call.
Teams below the floor are suppressed entirely rather than rounded. Sharing is opt-in per user
and off by default.

## Quickstart (on the box)

```bash
pip install -r requirements.txt
```

Models come from the USB drive:

```bash
ollama pull qwen3:8b && ollama pull qwen2.5vl:7b   # or copy into ~/.ollama/models
cp /Volumes/<drive>/pose_landmarker_heavy.task models/
cp /Volumes/<drive>/en_US-amy-medium.onnx models/            # optional, voice out
cp -r /Volumes/<drive>/faster-whisper-base.en models/        # optional, voice in
```

Seed the demo history, then run:

```bash
python -m server.seed
uvicorn server.main:app --host 0.0.0.0 --port 8000
```

Open `http://<box-ip>:8000` from the MacBook. See `.env.example` for every knob.

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
| `agent/` | 2 | `coach.py` the agent · `runtime.py` stack adapter · `tools.py` the seven tools · `knowledge.py` approved local retrieval · `routines.py` composer · `persona.py` prompts + claim filter · `memory.py` SQLite · `llm.py` local Qwen client · YAML content libraries |
| `ui/` | 3 | `app.js` screens · `charts.js` · `overlay.js` skeleton · `mock.js` offline stand-in · no build step |
| `server/` | 4 | `main.py` FastAPI + `/ws` · `bus.py` broadcast + queue · `tts.py` Piper · `stt.py` Whisper · `seed.py` demo history |

**Contracts between lanes live in [contracts.md](contracts.md). Read it first.
Change it only by team agreement — it's the constitution.**

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
