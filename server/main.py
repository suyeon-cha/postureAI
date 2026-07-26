"""FlowReset walking skeleton — runs end-to-end on FAKE data.

Every lane replaces its fake part with the real one, keeping the contracts:
  - perception lane: replace fake_keypoints/fake session progress with MediaPipe + detectors
  - agent lane: replace stub_agent() with the OpenClaw/NemoClaw agent -> local Ollama
  - ui lane: ui/index.html already renders state/coach; make it beautiful

Run:  uvicorn server.main:app --port 8000   ->  http://localhost:8000
"""

import asyncio
import math
from pathlib import Path

import yaml
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent
LIB = yaml.safe_load((ROOT / "agent" / "exercises.yaml").read_text())

app = FastAPI()


def fake_keypoints(t: float):
    """33 gently-bobbing landmarks so the UI has something to draw. Perception lane deletes this."""
    pts = []
    for i in range(33):
        x = 0.5 + 0.12 * math.sin(i * 1.7) + 0.01 * math.sin(t * 2 + i)
        y = 0.15 + i * 0.022 + 0.008 * math.sin(t * 3 + i * 0.5)
        pts.append([round(x, 4), round(y, 4), 0.95])
    return pts


def stub_agent(card: str, duration_s: int, seated: bool):
    """FAKE agent response. Agent lane replaces this with OpenClaw -> gpt-oss via Ollama.

    Contract: returns a `coach` message (contracts.md section 3) incl. tool trace.
    """
    routine = LIB["cards"][card]["routine"]
    return {
        "type": "coach",
        "text": f"[stub] {LIB['cards'][card]['name']} reset, {duration_s}s, "
                f"{'seated' if seated else 'standing'}. Real agent replaces me.",
        "speak": False,
        "routine": {
            "duration_s": duration_s,
            "moves": routine,
            "why": "[stub] fits your time and constraints",
        },
        "trace": [
            {"tool": "get_reset_history", "result": "[stub] 3 shoulder sessions this week"},
            {"tool": "select_approved_routine", "result": f"[stub] {card}"},
        ],
    }


@app.websocket("/ws")
async def ws(websocket: WebSocket):
    await websocket.accept()
    lock = asyncio.Lock()
    sess = {"mode": "idle", "routine": None, "started": 0.0, "duration_s": 0, "clock": 0.0}

    async def send(msg):
        async with lock:
            await websocket.send_json(msg)

    async def state_loop():
        t = 0.0
        while True:
            session = None
            if sess["mode"] == "reset" and sess["routine"]:
                elapsed = t - sess["started"]
                remaining = max(0, sess["duration_s"] - elapsed)
                moves = sess["routine"]["moves"]
                idx = min(int(elapsed / (sess["duration_s"] / len(moves) + 0.001)), len(moves) - 1)
                session = {
                    "card": sess["card"],
                    "move": moves[idx],
                    "move_index": idx,
                    "rep": int(elapsed / 4) % 6,
                    "target_reps": 5,
                    "hold_s": 0,
                    "form": "ok",
                    "tempo": "good",
                    "remaining_s": int(remaining),
                }
                if remaining <= 0:
                    sess["mode"] = "idle"
                    await send({"type": "coach", "text": "[stub] Done — Better, Same, or Worse?",
                                "speak": False, "routine": None, "trace": []})
            await send({
                "type": "state",
                "mode": sess["mode"],
                "keypoints": fake_keypoints(t) if sess["mode"] == "reset" else None,
                "session": session,
                "framing": "torso_only",
            })
            await asyncio.sleep(0.1)
            t += 0.1
            sess["clock"] = t

    task = asyncio.create_task(state_loop())
    try:
        while True:
            msg = await websocket.receive_json()
            if msg.get("type") == "start_reset":
                coach = stub_agent(msg["card"], msg["duration_s"], msg.get("seated", True))
                sess.update(mode="reset", routine=coach["routine"], card=msg["card"],
                            started=sess["clock"], duration_s=msg["duration_s"])
                await send(coach)
            elif msg.get("type") == "session_result":
                await send({"type": "coach", "speak": False, "routine": None,
                            "text": f"[stub] Logged '{msg['feeling']}'. Real agent will adapt.",
                            "trace": [{"tool": "record_session_result", "result": msg["feeling"]}]})
            elif msg.get("type") == "end_session":
                sess["mode"] = "idle"
            # {"type": "frame"} ignored by skeleton; perception lane consumes it
    except WebSocketDisconnect:
        task.cancel()


app.mount("/", StaticFiles(directory=ROOT / "ui", html=True), name="ui")
