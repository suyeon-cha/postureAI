# Contracts v2 — the constitution (FlowReset)

Messages cross one WebSocket: `ws://localhost:8000/ws`
(on the event box, reach it via SSH tunnel: `ssh -L 8000:localhost:8000 dell@<gb10>` —
browsers only allow camera on secure origins, and `localhost` counts. Never open
the UI via `http://<ip>`.)

UI is a pure renderer. Perception never phrases coaching. The agent never does geometry.
All model calls go through the OpenClaw/NemoClaw agent → local Ollama. No cloud, ever.

## 1. `state` — server → UI (~10–15 Hz)

```json
{
  "type": "state",
  "mode": "idle",                     // "idle" | "reset"
  "keypoints": [[0.51, 0.32, 0.9]],   // 33 × [x, y, visibility] or null (camera off)
  "session": {                        // null unless mode == "reset"
    "card": "neck_shoulders",
    "move": "shoulder_rolls",         // key into agent/exercises.yaml
    "move_index": 0,
    "rep": 2, "target_reps": 5,
    "hold_s": 0,                      // >0 during holds
    "form": "ok",                     // "ok" | "fault"
    "tempo": "good",                  // "good" | "too_fast"
    "remaining_s": 61
  },
  "framing": "torso_only"             // "full_body" | "torso_only" | "no_person"
}
```

## 2. UI → server (user actions)

```json
{ "type": "start_reset", "card": "neck_shoulders", "duration_s": 90, "seated": true }
{ "type": "frame", "jpeg_b64": "..." }          // sampled webcam frames during reset only
{ "type": "session_result", "feeling": "better" } // "better" | "same" | "worse"
{ "type": "end_session" }
```

## 3. `coach` — agent → server → UI

```json
{
  "type": "coach",
  "text": "Third shoulder session this week — here's a quiet seated reset.",
  "speak": false,                     // true → server pipes text to Piper
  "routine": {                        // only when a new plan is composed
    "duration_s": 75,
    "moves": ["shoulder_rolls", "neck_side_stretch", "chest_opener"],
    "why": "fits 90s, seated, targets your recurring shoulder tension"
  },
  "trace": [                          // judges' agent-loop proof, rendered in trace panel
    { "tool": "get_reset_history", "result": "3 shoulder sessions this week" },
    { "tool": "select_approved_routine", "result": "seated_shoulder_reset" }
  ]
}
```

## Agent tools (implemented during the event, agent lane)

```
get_user_context()                       -> goals, constraints, preferences
get_reset_history()                      -> recent sessions + outcomes
select_approved_routine(card, duration_s, seated) -> routine from exercises.yaml
analyze_pose(landmarks_window)           -> {tempo, range, faults[]}   (deterministic)
generate_coaching_cue(metrics)           -> one short cue (via local LLM)
record_session_result(feeling)           -> persists to SQLite
```

Demo requirement: ≥3 tool calls visible in the trace during the golden path.

## Detection primitives (perception lane) — only five exist

tempo · hold · reps (state machine w/ hysteresis) · knee_valgus · framing/yaw check.
Every move in exercises.yaml declares which primitive judges it (`detection:` field).
