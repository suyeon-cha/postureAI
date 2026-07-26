# Three people, three hours

Two hours to build, one hour to validate. Times are T+minutes from when you start.

**The split in one line each:**

| Who | Owns | Plain English |
|---|---|---|
| **SWE** | the Dell | makes the box work — models, server, approved runtime |
| **FSE** | the connection | makes the Mac talk to the Dell — tunnel, camera, overlay |
| **Data consultant** | the story | makes it convincing — dashboards, deck, video, submission |

Nobody edits the same files. The SWE is the critical path — the other two work
around them, not behind them.

---

## The one thing that can disqualify us

`FLOWRESET_RUNTIME=native` is the default, and **native is not an approved stack.**
Rule 02 requires NemoClaw, OpenClaw, or OpenShell in the runtime path. Everything
else in this repo is compliant and provable. This env var is the whole gap.

It gets a 50-minute block on the critical path, not "if we have time."

**If the approved runtime isn't working by T+85, stop and ask a mentor.** Nazib is
on-site and has already commented on our submission. Do not spend the validation
hour debugging a framework import.

---

## Scope decisions already made

- **Voice input: cut.** Speech-to-text needs Whisper; we can't download it and no
  text LLM (gpt-oss, qwen) can substitute — they take tokens, not audio. The
  intake screen keeps its text box. The golden path never used voice.
- **Voice output: only if Piper is already on the box.** Check with
  `which piper; ls models/*.onnx`. If absent, cues render as on-screen text and
  the demo is unaffected.
- **Never use the browser's Web Speech API.** It streams mic audio to Google —
  instant rule violation. `server/stt.py` explains why in its docstring.

---

## SWE — box owner

| T+ | Task | Est |
|---|---|---|
| 0–25 | USB → box: Ollama blobs, pose `.task`, piper voice if present. `pip install -r requirements.txt`. Verify `ollama run qwen3:8b` answers in ~1s | 25m |
| 25–35 | `python -m server.seed`, then `uvicorn server.main:app --host 0.0.0.0 --port 8000`. Confirm `/api/health` shows pose available + llm reachable | 10m |
| 35–85 | **Compliance:** fill the two `TODO(box)` lines in `agent/runtime.py`, set `FLOWRESET_RUNTIME=openclaw` (or nemoclaw), confirm the agent trace still shows real tool calls | 50m |
| 85–120 | Buffer, then `./scripts/verify-local.sh` with egress blocked | 35m |

## FSE — connection owner

| T+ | Task | Est |
|---|---|---|
| 0–20 | SSH keys for all three laptops. Tunnel up. **Fix the README line that says to open `http://<box-ip>:8000`** — that breaks the camera (see below) | 20m |
| 20–60 | Camera path end to end: permission prompt → frames reach the box → pose overlay renders → reps and tempo tick | 40m |
| 60–90 | Session flow: plan → guided reset → Better/Same/Worse → dashboard appends the real row | 30m |
| 90–120 | Break it on purpose: camera denied, server restarted mid-session, framing lost, tunnel dropped | 30m |

## Data consultant — proof owner

Works on her own laptop until T+90. No box dependency.

| T+ | Task | Est |
|---|---|---|
| 0–40 | Seed history + the three dashboard questions: *am I building the habit · is it helping · where do I need support*. Label seeded rows honestly as demo data | 40m |
| 40–80 | Five slides + 5-minute script, mapped to the 30/30/30/10 rubric | 40m |
| 80–120 | BuilderBase writeup (declare the stack), architecture diagram with every AI component inside the GB10 boundary | 40m |

---

## T+120 → T+180: validation hour, all three together

1. **T+120** — golden path on the box, three clean runs back to back (25m)
2. **T+145** — **block egress / pull the cable**, run it again. This is the pitch's
   mic-drop and 30% of the rubric (10m)
3. **T+155** — record the backup demo video. A finished video of the T+145 build
   beats a missing video of the T+179 build (15m)
4. **T+170** — submit, then rehearse the pitch out loud (10m)

---

## How the hosting works

The Dell runs everything. The Mac is a browser and a webcam.

```
MacBook                                    Dell GB10
┌─────────────────────┐                   ┌──────────────────────────────┐
│ Chrome              │  SSH tunnel       │ uvicorn :8000  (FastAPI)     │
│  localhost:8000 ────┼──── port 8000 ───▶│   ├─ serves ui/              │
│                     │                   │   ├─ /ws  state + coach      │
│  webcam → JPEG ─────┼──────────────────▶│   ├─ MediaPipe pose          │
│  ◀── state/coach ───┼───────────────────┤   └─ agent → 127.0.0.1:11434 │
└─────────────────────┘                   │                    (Ollama)  │
                                          └──────────────────────────────┘
```

On the Mac:

```bash
ssh -L 8000:localhost:8000 dell@<box-ip>
```

Then open **`http://localhost:8000`** — not the box's IP.

**Why the tunnel is mandatory:** browsers only grant camera access on a *secure
origin*. `http://192.168.x.x:8000` is not one — `getUserMedia` fails silently
with no permission prompt, and you will lose thirty minutes thinking the webcam
is broken. `localhost` counts as secure, and the tunnel makes the box's port be
localhost on the Mac.

Ollama is never exposed. The agent calls `127.0.0.1:11434` from inside the box,
so the Mac never touches a model directly. That is also the compliance story:
one machine, one loopback call, nothing on the wire.
