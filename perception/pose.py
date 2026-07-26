"""Camera capture + MediaPipe PoseLandmarker.

Everything sits behind get_keypoints() so the backend can be swapped
(Ultralytics, MoveNet) without touching detectors.

Two capture paths, same output:
  LocalCamera   a webcam attached to the box (dev, or a USB cam on the GB10)
  FrameSink     JPEG frames POSTed from the MacBook browser over the LAN

Frames are held in a single mutable buffer and overwritten on arrival. They
are never written to disk, never queued, and never leave this process.
"""

from __future__ import annotations

import base64
import os
import threading
import time
from pathlib import Path
from typing import Any

import numpy as np

MODEL_PATH = Path(
    os.environ.get(
        "FLOWRESET_POSE_MODEL",
        Path(__file__).parent.parent / "models" / "pose_landmarker_heavy.task",
    )
)

# MediaPipe BlazePose landmark indices we actually use.
NOSE, L_EAR, R_EAR = 0, 7, 8
L_SHOULDER, R_SHOULDER = 11, 12
L_ELBOW, R_ELBOW = 13, 14
L_WRIST, R_WRIST = 15, 16
L_HIP, R_HIP = 23, 24
L_KNEE, R_KNEE = 25, 26
L_ANKLE, R_ANKLE = 27, 28

NUM_LANDMARKS = 33

# Drawn by the UI overlay. Kept here so the skeleton definition lives with
# the landmark indices it refers to.
SKELETON_EDGES = [
    (L_SHOULDER, R_SHOULDER), (L_SHOULDER, L_ELBOW), (L_ELBOW, L_WRIST),
    (R_SHOULDER, R_ELBOW), (R_ELBOW, R_WRIST), (L_SHOULDER, L_HIP),
    (R_SHOULDER, R_HIP), (L_HIP, R_HIP), (L_HIP, L_KNEE), (L_KNEE, L_ANKLE),
    (R_HIP, R_KNEE), (R_KNEE, R_ANKLE),
]


class PoseBackend:
    """MediaPipe PoseLandmarker in LIVE_STREAM mode."""

    def __init__(self, model_path: Path = MODEL_PATH):
        self.model_path = Path(model_path)
        self._landmarker = None
        self._mp = None
        self._latest: list[list[float]] | None = None
        self._lock = threading.Lock()
        self.available = False
        self.error: str | None = None

    def start(self) -> bool:
        try:
            import mediapipe as mp
            from mediapipe.tasks import python as mp_python
            from mediapipe.tasks.python import vision
        except ImportError as exc:
            self.error = f"mediapipe not installed: {exc}"
            return False
        if not self.model_path.exists():
            self.error = (
                f"pose model missing at {self.model_path}. Copy "
                "pose_landmarker_heavy.task from the USB drive into models/."
            )
            return False

        def _on_result(result, output_image, timestamp_ms):  # noqa: ARG001
            if not result.pose_landmarks:
                with self._lock:
                    self._latest = None
                return
            lm = result.pose_landmarks[0]
            with self._lock:
                self._latest = [
                    [round(p.x, 4), round(p.y, 4), round(p.visibility, 3)] for p in lm
                ]

        options = vision.PoseLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=str(self.model_path)),
            running_mode=vision.RunningMode.LIVE_STREAM,
            num_poses=1,
            min_pose_detection_confidence=0.5,
            min_tracking_confidence=0.5,
            result_callback=_on_result,
        )
        self._landmarker = vision.PoseLandmarker.create_from_options(options)
        self._mp = mp
        self.available = True
        self.error = None
        return True

    def submit(self, bgr_frame: np.ndarray, timestamp_ms: int | None = None) -> None:
        if not self.available or self._landmarker is None:
            return
        import cv2

        rgb = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
        mp_image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=rgb)
        self._landmarker.detect_async(
            mp_image,
            timestamp_ms if timestamp_ms is not None else int(time.time() * 1000),
        )

    def get_keypoints(self) -> list[list[float]] | None:
        with self._lock:
            return list(self._latest) if self._latest else None

    def close(self) -> None:
        if self._landmarker is not None:
            self._landmarker.close()
            self._landmarker = None
        self.available = False


class FrameSink:
    """Accepts base64 JPEG frames from the browser and runs pose on them.

    This is the path the demo actually uses: the MacBook captures, the GB10
    infers. The frame lives in one variable, is decoded, handed to MediaPipe,
    and dropped. `frames_seen` is a counter, not a store.
    """

    def __init__(self, backend: PoseBackend):
        self.backend = backend
        self.frames_seen = 0
        self.last_frame_at: float = 0.0
        self._last_jpeg_b64: str | None = None  # one frame deep, for the VLM check

    def push_jpeg_b64(self, data: str) -> bool:
        try:
            import cv2
        except ImportError:
            return False
        if "," in data[:64]:  # strip a data: URL prefix if the browser sent one
            data = data.split(",", 1)[1]
        try:
            raw = base64.b64decode(data)
        except (ValueError, TypeError):
            return False
        buf = np.frombuffer(raw, dtype=np.uint8)
        frame = cv2.imdecode(buf, cv2.IMREAD_COLOR)
        if frame is None:
            return False

        self.frames_seen += 1
        self.last_frame_at = time.time()
        self._last_jpeg_b64 = data  # overwritten every frame; never persisted
        self.backend.submit(frame, int(self.last_frame_at * 1000))
        return True

    def take_frame_for_vlm(self) -> str | None:
        """Hand the current frame to the local vision judge, then forget it."""
        frame, self._last_jpeg_b64 = self._last_jpeg_b64, None
        return frame

    def is_live(self, within_seconds: float = 2.0) -> bool:
        return (time.time() - self.last_frame_at) < within_seconds


class LocalCamera:
    """Optional: a webcam on the box itself. Used for dev without the MacBook."""

    def __init__(self, backend: PoseBackend, index: int = 0, fps: int = 15):
        self.backend = backend
        self.index = index
        self.interval = 1.0 / fps
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()

    def start(self) -> None:
        if self._thread:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def _loop(self) -> None:
        import cv2

        cap = cv2.VideoCapture(self.index)
        try:
            while not self._stop.is_set():
                ok, frame = cap.read()
                if ok:
                    self.backend.submit(frame)
                time.sleep(self.interval)
        finally:
            cap.release()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=1.0)
            self._thread = None


def status(backend: PoseBackend, sink: FrameSink | None = None) -> dict[str, Any]:
    """Health for the UI badge — is the vision model actually up on this box?"""
    return {
        "model": "MediaPipe PoseLandmarker (heavy)",
        "model_path": str(backend.model_path),
        "available": backend.available,
        "error": backend.error,
        "frames_seen": sink.frames_seen if sink else 0,
        "live": sink.is_live() if sink else False,
        "frames_stored": 0,  # always. we do not persist frames.
    }
