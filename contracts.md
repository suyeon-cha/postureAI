# Contracts — the constitution

Three JSON shapes cross lane boundaries. Build against these with fake data;
never block on another lane. Changes require team agreement + a commit that
updates this file AND both sides in the same PR.

## 1. `state` — perception → server → UI (WebSocket, ~15 Hz)

The UI is a pure renderer of this blob. Everything on screen comes from here.

```json
{
  "type": "state",
  "mode": "watch",                  // "watch" | "reset" | "idle"
  "keypoints": [[0.51, 0.32, 0.9], ...],   // 33 × [x, y, visibility], normalized 0-1
  "posture_debt": {                 // minutes of accumulated bad posture
    "neck": 42.5,
    "shoulders": 17.0,
    "sitting": 96.0
  },
  "session": {                      // null when mode != "reset"
    "move": "squat",                // key into agent/exercises.yaml
    "move_index": 1,                // 0-based position in routine
    "rep": 3,
    "target_reps": 8,
    "hold_seconds": 0,              // >0 during holds
    "form": "ok",                   // "ok" | "fault" | "checking"  (checking = VLM judging)
    "tempo": "good"                 // "good" | "too_fast"
  },
  "framing": "full_body"            // "full_body" | "torso_only" | "no_person"
}
```

## 2. `event` — perception → agent (in-process queue)

Events are edge-triggered facts. The agent decides what, if anything, to say.
Perception NEVER phrases coaching language; the agent NEVER does geometry.

```json
{
  "type": "debt_threshold",         // see catalog below
  "move": "squat",                  // null in watch mode
  "detail": "knee_valgus",
  "value": 42.5,
  "frame_jpeg_b64": null            // populated ONLY on vlm_check_needed
}
```

Event catalog:

| type | fired when | detail examples |
|---|---|---|
| `debt_threshold` | a posture_debt counter crosses its limit | "neck", "sitting" |
| `rep_done` | rep state machine completes a rep | — |
| `form_fault` | a rule fires during a move | "knee_valgus", "too_shallow", "rushing" |
| `hold_complete` | stillness held for target duration | — |
| `move_complete` | reps/holds for current move finished | — |
| `vlm_check_needed` | rules can't judge this plane (chin tuck, squat depth) | includes frame |
| `framing_lost` | required keypoints missing for current move | "need_ankles" |
| `user_speech` | push-to-talk transcript ready (stretch goal) | transcript text |

## 3. `coach` — agent → server → UI + TTS (WebSocket)

```json
{
  "type": "coach",
  "text": "Slower — feel your shoulder blades pull together.",
  "speak": true,                    // server pipes to Piper when true
  "routine": null                   // populated only when composing a new reset:
  //  { "duration_min": 3, "moves": ["neck_side_stretch", "y_raise", "squat"] }
}
```

## Transport

- UI subscribes to `ws://<box>:8000/ws` — receives `state` and `coach` messages interleaved.
- UI sends user actions on the same socket: `{"type": "start_reset", "duration_min": 3}`,
  `{"type": "end_session"}`.
- perception ↔ agent ↔ server are in-process (one FastAPI app, queues) — no network hops.

## exercises.yaml schema (agent lane owns this file)

```yaml
squat:
  name: "Bodyweight squat"
  targets: [sitting, hips]
  detection: reps          # reps | angle_hold | tempo | vlm_judge | timer_only
  target_reps: 8
  requires_full_body: true
  cues:
    setup: "Step back until I can see your ankles."
    during: "Slow on the way down — four seconds."
    fault_knee_valgus: "Knees are caving — push them out."
```
