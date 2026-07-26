# postureAI — FlowReset

A private workplace wellbeing agent running entirely on the Dell Pro Max with GB10.
It watches posture all day, notices when a desk worker needs a reset, composes a
free-body recovery routine for the time they have, and coaches the movement with
real-time voice — no video or prompts ever leaving the box.

Dell x NVIDIA Local AI Hackathon, Seattle — July 26, 2026.

## Architecture

```
camera → perception (MediaPipe + rules) → events → agent (OpenClaw + local models) → voice
                    ↓ state (15 Hz)                        ↓ coach lines / routines
                 server (FastAPI) ── WebSocket ──→ ui (browser)
```

All inference local: gpt-oss:20b (coach) + qwen2.5vl:7b (vision judge) via Ollama,
MediaPipe pose on CPU, Piper TTS. No remote API calls in the runtime path.

## Repo layout & lanes

| Folder | Lane | Owner |
|---|---|---|
| `perception/` | camera, pose, detectors, posture debt | |
| `agent/` | OpenClaw skill, routine composer, VLM tool, TTS | |
| `ui/` | onboarding, live session screen, EHS dashboard | |
| `server/` | FastAPI glue, WebSocket, integration | |

**Contracts between lanes live in [contracts.md](contracts.md). Read it first.
Change it only by team agreement — it's the constitution.**

## Deadlines (hard)

- **13:00** — integration checkpoint 1: skeleton on screen end-to-end
- **16:00** — integration checkpoint 2: full loop (slouch → voice → routine)
- **17:00** — start recording backup demo video
- **18:30** — demo video + submission deadline. CODE FREEZE.
- **19:00** — deck deadline

## Quickstart (on the box)

```bash
pip install -r requirements.txt
# models come from the USB drive → ~/.ollama/models + pose_landmarker_heavy.task
uvicorn server.main:app --host 0.0.0.0 --port 8000
```
