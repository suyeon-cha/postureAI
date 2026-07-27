"""FastAPI glue — lane 4.

One process: pose backend + agent + WebSocket broadcast. Serves ui/ statics
and /ws per contracts.md Transport, pipes coach.speak to Piper.

Everything below binds to the box. There is no outbound call in this file,
and agent.llm refuses a non-local inference endpoint at import time.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from agent import coach as coach_mod
from agent import knowledge, llm, memory, routines, tools
from perception import debt as debt_mod
from perception import detectors, pose

from . import bus, stt, tts

UI_DIR = Path(__file__).parent.parent / "ui"
STATE_HZ = 15
#: Seconds of continuously-good framing before the guide turns ready. Long
#: enough that settling into position doesn't flicker it, short enough that
#: someone already standing correctly isn't left waiting.
FRAME_READY_S = 1.2

app = FastAPI(title="FlowReset", docs_url=None, redoc_url=None)

broadcast = bus.Broadcast()
events = bus.EventQueue()

pose_backend = pose.PoseBackend()
frame_sink = pose.FrameSink(pose_backend)
posture_debt = debt_mod.PostureDebt()

agent = coach_mod.FlowResetAgent(user_id="local")


class SessionRunner:
    """Drives one guided reset: move by move, tick by tick."""

    def __init__(self) -> None:
        self.plan: dict[str, Any] | None = None
        self.trackers: list[detectors.MoveTracker] = []
        self.index = 0
        self.camera_on = False
        self.paused = False
        self.started_at = 0.0
        self._task: asyncio.Task | None = None
        # Framing has to *hold*, not just touch, before we call it ready:
        # a landmark flickering in and out would otherwise strobe the
        # indicator green/red while the user is still settling.
        self._frame_ok_since: float | None = None

    @property
    def active(self) -> bool:
        return self.plan is not None

    @property
    def tracker(self) -> detectors.MoveTracker | None:
        if 0 <= self.index < len(self.trackers):
            return self.trackers[self.index]
        return None

    def start(self, plan: dict[str, Any], camera_on: bool) -> None:
        self.plan = plan
        self.camera_on = camera_on
        self.paused = False
        self.index = 0
        self.started_at = time.monotonic()
        self.trackers = [
            detectors.build_tracker(key, routines.describe_move(key))
            for key in plan["moves"]
        ]

    def advance(self) -> bool:
        """Move to the next exercise. False when the routine is done."""
        self.index += 1
        return self.index < len(self.trackers)

    def stop(self) -> None:
        self.plan = None
        self.trackers = []
        self.index = 0
        self.camera_on = False

    def frame_status(self, kp, tracker) -> dict[str, Any]:
        """Guided-frame state: what this move needs, and whether we have it."""
        target = detectors.frame_target(tracker.spec) if tracker else "torso"
        if not self.camera_on:
            return {"target": target, "seen": "no_person", "ok": False,
                    "reason": "Camera is off.", "held_s": 0.0, "ready": False}
        check = detectors.frame_check(kp, target)
        now = time.monotonic()
        if check["ok"]:
            self._frame_ok_since = self._frame_ok_since or now
            held = now - self._frame_ok_since
        else:
            self._frame_ok_since = None
            held = 0.0
        check["held_s"] = round(held, 1)
        check["ready"] = held >= FRAME_READY_S
        return check

    def state(self) -> dict[str, Any]:
        """contracts.md §1 `state`."""
        kp = pose_backend.get_keypoints() if self.camera_on else None
        tracker = self.tracker
        return {
            "type": "state",
            "mode": "reset" if self.active else ("watch" if posture_debt.enabled else "idle"),
            "keypoints": kp or [],
            "posture_debt": posture_debt.snapshot(),
            "session": (
                {
                    **tracker.session_state(),
                    "move_index": self.index,
                    "move_count": len(self.trackers),
                    "elapsed": round(time.monotonic() - self.started_at, 1),
                    "paused": self.paused,
                }
                if tracker
                else None
            ),
            "framing": detectors.framing(kp),
            "frame": self.frame_status(kp, tracker),  # (v1.2) guided-frame gate
            "camera_on": self.camera_on,
        }


session = SessionRunner()


def _pose_snapshot() -> dict[str, Any]:
    """What tools.analyze_pose reads. Geometry only, never a frame."""
    tracker = session.tracker
    kp = pose_backend.get_keypoints() if session.camera_on else None
    snap: dict[str, Any] = {
        "camera_on": session.camera_on and frame_sink.is_live(),
        "framing": detectors.framing(kp),
        "move": tracker.move if tracker else None,
    }
    if tracker:
        snap.update(tracker.metrics())
    return snap


tools.bind_pose_source(_pose_snapshot)


# ──────────────────────────── background loops ────────────────────────────


async def state_loop() -> None:
    """Broadcast `state` at ~15 Hz and pump detector events into the queue."""
    interval = 1.0 / STATE_HZ
    while True:
        await asyncio.sleep(interval)
        try:
            kp = pose_backend.get_keypoints()

            if session.active and session.camera_on and not session.paused:
                tracker = session.tracker
                if tracker:
                    for event in tracker.update(kp):
                        events.put_nowait(event)
                        if event["type"] == "move_complete":
                            if not session.advance():
                                events.put_nowait({"type": "routine_complete", "move": None})

            if posture_debt.enabled and not session.active:
                for event in posture_debt.update(kp):
                    events.put_nowait(event)

            if broadcast.count:
                await broadcast.send(session.state())
        except Exception as exc:  # noqa: BLE001 - never let the loop die mid-demo
            await broadcast.send({"type": "error", "where": "state_loop", "detail": str(exc)})


async def agent_loop() -> None:
    """Drain perception events, let the agent decide what (if anything) to say."""
    while True:
        event = await events.get()
        try:
            if event["type"] == "routine_complete":
                await broadcast.send({"type": "routine_complete"})
                continue

            if event["type"] == "vlm_check_needed":
                frame = frame_sink.take_frame_for_vlm()
                if frame:
                    await _vlm_check(event, frame)
                continue

            message = await asyncio.to_thread(agent.on_event, event)
            if message:
                await _emit_coach(message)
        except Exception as exc:  # noqa: BLE001
            await broadcast.send({"type": "error", "where": "agent_loop", "detail": str(exc)})


async def _vlm_check(event: dict[str, Any], frame_b64: str) -> None:
    """Run a bounded local vision check and publish a conservative UI cue."""
    move = event.get("move") or ""
    try:
        spec = routines.describe_move(move)
    except routines.NoApprovedRoutine:
        return
    verdict = await asyncio.to_thread(
        llm.look_at_frame,
        frame_b64,
        (
            f"The person is doing: {spec['name']}. Only assess whether the relevant "
            "body area is visible and the movement appears slow and controlled. "
            "Do not diagnose or make a medical claim."
        ),
    )
    agent._emit({"kind": "tool", "name": "look_at_frame",
                 "arguments": {"move": move}, "result": {"verdict": verdict}})
    lowered = verdict.lower()
    if any(word in lowered for word in ("unclear", "cannot", "can't see", "not visible")):
        cue = "Video AI needs a clearer view. Reframe the relevant body area, or continue by timer."
        status = "reframe"
    elif any(word in lowered for word in ("fast", "rushed", "not controlled")):
        cue = "Video AI check: slow the movement down and stay within a comfortable range."
        status = "adjust"
    else:
        cue = "Video AI check complete: movement is visible. Continue slowly and comfortably."
        status = "ready"
    await broadcast.send({"type": "video_ai", "status": status, "text": cue, "move": move})
    # Visual-model feedback used to stop at the screen. Conversational mode
    # now reads that same approved cue aloud; visual mode remains silent.
    if memory.get_prefs().get("voice", False):
        await _emit_audio(cue)


async def _emit_audio(text: str) -> None:
    audio = await asyncio.to_thread(tts.synthesize, text)
    if audio:
        await broadcast.send({
            "type": "audio",
            "wav_b64": base64.b64encode(audio).decode("ascii"),
        })


async def _emit_coach(message: dict[str, Any]) -> None:
    await broadcast.send(message)
    if message.get("speak") and message.get("text"):
        await _emit_audio(message["text"])


@app.on_event("startup")
async def _startup() -> None:
    memory.init()
    pose_backend.start()  # logs into pose_backend.error if the model isn't there
    # The agent runs in worker threads (asyncio.to_thread), and a worker thread
    # has no event loop of its own — get_event_loop() raises there. Capture the
    # running loop once, here, and hand traces back to it from any thread.
    loop = asyncio.get_running_loop()

    def _on_trace(entry: dict[str, Any]) -> None:
        loop.call_soon_threadsafe(
            lambda: asyncio.ensure_future(broadcast.send({"type": "trace", "entry": entry}))
        )

    agent.on_trace = _on_trace
    app.state.tasks = [
        asyncio.create_task(state_loop()),
        asyncio.create_task(agent_loop()),
    ]


@app.on_event("shutdown")
async def _shutdown() -> None:
    for task in getattr(app.state, "tasks", []):
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
    pose_backend.close()


# ────────────────────────────── WebSocket ──────────────────────────────


@app.websocket("/ws")
async def websocket(ws: WebSocket) -> None:
    await ws.accept()
    await broadcast.add(ws)
    await ws.send_json({"type": "hello", "health": _health_payload()})
    try:
        while True:
            msg = await ws.receive_json()
            await _handle_ui_message(msg)
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        pass
    finally:
        await broadcast.remove(ws)


async def _handle_ui_message(msg: dict[str, Any]) -> None:
    kind = msg.get("type")

    if kind == "frame":
        # The only path camera data takes. Decoded, inferred on, dropped.
        await asyncio.to_thread(frame_sink.push_jpeg_b64, msg.get("data", ""))
        return

    if kind == "intake":
        agent.reset_trace()
        try:
            plan_msg = await asyncio.to_thread(
                agent.plan_reset, msg.get("text", ""), msg.get("override")
            )
        except coach_mod.RedFlag as flag:
            await broadcast.send({
                "type": "coach", "text": str(flag), "speak": True,
                "routine": None, "escalate": True,
            })
            return
        await _emit_coach(plan_msg)
        return

    if kind == "start_reset":
        plan = agent.plan
        if plan is None:
            plan = tools.select_approved_routine(
                symptom=msg.get("symptom", "general"),
                duration_min=int(msg.get("duration_min", 3)),
                can_stand=bool(msg.get("can_stand", True)),
            )
            agent.plan = plan
        if agent.session_id is None:
            agent.session_id = memory.start_session(
                plan["symptom"], plan["duration_min"], plan["moves"]
            )
            agent._emit({
                "kind": "action",
                "action": "session_started",
                "session_id": agent.session_id,
                "moves": plan["moves"],
            })
        session.start(plan, camera_on=bool(msg.get("camera", False)))
        await broadcast.send({"type": "session_started", "plan": plan,
                              "camera_on": session.camera_on})
        first = session.tracker
        if first:
            await _emit_coach({
                "type": "coach",
                "text": routines.describe_move(first.move)["cues"]["setup"],
                "speak": memory.get_prefs().get("voice", False),
                "routine": None,
            })
        return

    if kind == "camera":
        session.camera_on = bool(msg.get("on"))
        await broadcast.send({"type": "camera", "on": session.camera_on})
        return

    if kind == "pause":
        session.paused = bool(msg.get("on"))
        return

    if kind == "restart_move":
        # User confirmed they're in position. Rebuild this move's tracker so
        # reps, tempo and range all measure from now, discarding whatever was
        # captured while they were getting into frame.
        tracker = session.tracker
        if tracker:
            session.trackers[session.index] = detectors.build_tracker(
                tracker.move, tracker.spec
            )
        return

    if kind == "skip":
        if not session.advance():
            await broadcast.send({"type": "routine_complete"})
        else:
            tracker = session.tracker
            if tracker:
                await _emit_coach({
                    "type": "coach",
                    "text": routines.describe_move(tracker.move)["cues"]["setup"],
                    "speak": memory.get_prefs().get("voice", False),
                    "routine": None,
                })
        return

    if kind == "end_session":
        session.stop()
        result = await asyncio.to_thread(
            agent.finish, bool(msg.get("completed", True)), msg.get("response")
        )
        await _emit_coach(result)
        await broadcast.send({"type": "dashboard", "data": _dashboard_payload()})
        return

    if kind == "watch_mode":
        on = bool(msg.get("on"))
        posture_debt.set_enabled(on)
        memory.set_prefs({"watch_mode": on})
        await broadcast.send({"type": "watch_mode", "on": on})
        return


# ──────────────────────────────── REST ────────────────────────────────


def _health_payload() -> dict[str, Any]:
    return {
        **coach_mod.health(),
        "pose": pose.status(pose_backend, frame_sink),
        "tts": tts.status(),
        "stt": stt.status(),
        "ui_clients": broadcast.count,
    }


def _dashboard_payload() -> dict[str, Any]:
    return {
        "summary": memory.summary(days=7),
        "daily": memory.daily_counts(days=7),
        "recent": memory.recent(limit=8),
        # 30 days, not 7: time-of-day patterns and per-move practice need more
        # than a week of a habit that is only just forming.
        "practice": memory.practice(days=30),
        "symptom_labels": routines.SYMPTOM_LABELS,
    }


@app.get("/api/health")
async def health() -> JSONResponse:
    return JSONResponse(_health_payload())


@app.get("/api/dashboard")
async def dashboard() -> JSONResponse:
    return JSONResponse(_dashboard_payload())


@app.get("/api/workspace")
async def workspace(days: int = 30) -> JSONResponse:
    """B2B view. Aggregate only — see memory.workspace_summary."""
    return JSONResponse({
        "workspace": memory.workspace_summary(days=days),
        "symptom_labels": routines.SYMPTOM_LABELS,
    })


@app.get("/api/prefs")
async def get_prefs() -> JSONResponse:
    return JSONResponse(memory.get_prefs())


@app.post("/api/prefs")
async def set_prefs(patch: dict[str, Any]) -> JSONResponse:
    prefs = memory.set_prefs(patch)
    if "watch_mode" in patch:
        posture_debt.set_enabled(bool(patch["watch_mode"]))
    return JSONResponse(prefs)


@app.get("/api/routines")
async def library() -> JSONResponse:
    lib = routines.load_library()
    return JSONResponse({
        # describe_move(), not the raw library — it merges in the muscle map.
        "moves": {k: routines.describe_move(k) for k in lib},
        "symptoms": routines.SYMPTOM_LABELS,
        "durations": routines.DURATION_CHOICES_MIN,
    })


@app.get("/api/knowledge")
async def knowledge_catalog() -> JSONResponse:
    """Approved employee-wellness content; contains no employee data."""
    return JSONResponse(knowledge.catalog())


@app.get("/api/trace")
async def trace() -> JSONResponse:
    return JSONResponse({"trace": agent.trace})


@app.post("/api/plan")
async def plan(body: dict[str, Any]) -> JSONResponse:
    """Non-WebSocket path to the agent — handy for curl during integration."""
    agent.reset_trace()
    try:
        result = await asyncio.to_thread(agent.plan_reset, body.get("text", ""), body.get("override"))
    except coach_mod.RedFlag as flag:
        return JSONResponse({"escalate": True, "text": str(flag)}, status_code=200)
    return JSONResponse({**result, "trace": agent.trace})


@app.post("/api/ask")
async def ask(body: dict[str, Any]) -> JSONResponse:
    """A question asked mid-session: "where should I feel this?"

    Same handler whether it arrived by voice (Whisper transcript) or by tapping
    a button, so the feature works with speech-to-text absent.
    """
    question = body.get("text", "")
    move = body.get("move") or (session.tracker.move if session.tracker else None)
    message = await asyncio.to_thread(agent.answer, question, move)
    if message:
        await _emit_coach(message)
    return JSONResponse(message or {"type": "coach", "text": None, "speak": False})


@app.post("/api/frame")
async def frame(body: dict[str, Any]) -> JSONResponse:
    ok = await asyncio.to_thread(frame_sink.push_jpeg_b64, body.get("data", ""))
    kp = pose_backend.get_keypoints()
    return JSONResponse({
        "accepted": ok,
        "keypoints": kp or [],
        "framing": detectors.framing(kp),
        "stored": False,
    })


@app.post("/api/transcribe")
async def transcribe(body: dict[str, Any]) -> JSONResponse:
    """Local Whisper. The browser records; the box transcribes. No Web Speech API."""
    result = await asyncio.to_thread(stt.transcribe, body.get("audio", ""))
    return JSONResponse(result)


@app.delete("/api/history")
async def wipe_history() -> JSONResponse:
    memory.wipe()
    return JSONResponse({"deleted": True})


@app.get("/api/export")
async def export_history() -> JSONResponse:
    return JSONResponse(memory.export())


@app.get("/")
async def index() -> Response:
    return FileResponse(UI_DIR / "index.html")


app.mount("/ui", StaticFiles(directory=UI_DIR), name="ui")
