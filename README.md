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

## Run it (walking skeleton works today, on any machine)

```bash
pip install fastapi 'uvicorn[standard]' pyyaml   # skeleton needs only these three
uvicorn server.main:app --port 8000
```

Open **http://localhost:8000** → pick a card → Start reset. You'll see the stub
coach plan, a fake-keypoint canvas, the live session ticker, and the agent trace
panel. Everything marked `[stub]` is a lane's job to replace (see contracts.md).

Full install (event, on the box): `pip install -r requirements.txt`
(adds mediapipe/opencv/piper). Models come from the USB → `~/.ollama/models`.

### Hosting on the GB10 + viewing from the MacBook

Browsers only allow the camera on secure origins, so **never open the UI via
`http://<box-ip>`** — the webcam prompt will silently never appear. Instead:

```bash
# on the box
uvicorn server.main:app --port 8000

# on the MacBook — tunnel makes it localhost, which browsers trust
ssh -L 8000:localhost:8000 dell@<box-ip>
```

Then open **http://localhost:8000** on the MacBook. Camera permission works,
frames go through the tunnel to the box, and nothing is exposed to the venue
network. If venue Wi-Fi blocks laptop↔box traffic (AP isolation), connect a
direct ethernet cable and use its IP for the same ssh command.
