"""Speech-to-text — local Whisper on the box.

WHY NOT THE BROWSER'S SPEECH API: `webkitSpeechRecognition` / the Web Speech
API streams microphone audio to Google's servers. It is one line of JavaScript
and it would silently break the competition's no-external-AI rule and every
privacy claim in our pitch. Do not use it. The UI records audio locally and
POSTs it here instead.

Model comes from the USB drive. If faster-whisper or the weights are missing,
`available()` is False and the UI keeps its text box — voice is a P1 nicety,
not a dependency of the golden path.
"""

from __future__ import annotations

import base64
import os
import tempfile
import threading
from pathlib import Path
from typing import Any

MODEL_DIR = Path(
    os.environ.get(
        "FLOWRESET_WHISPER_MODEL",
        Path(__file__).parent.parent / "models" / "faster-whisper-base.en",
    )
)
DEVICE = os.environ.get("FLOWRESET_WHISPER_DEVICE", "auto")

_model = None
_lock = threading.Lock()
_error: str | None = None


def _load():
    """Lazy: don't pay for Whisper unless someone actually taps the mic."""
    global _model, _error
    if _model is not None or _error is not None:
        return _model
    with _lock:
        if _model is not None or _error is not None:
            return _model
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            _error = f"faster-whisper not installed: {exc}"
            return None
        if not MODEL_DIR.exists():
            _error = (
                f"whisper weights missing at {MODEL_DIR}. Copy the "
                "faster-whisper model directory from the USB drive into models/."
            )
            return None
        try:
            _model = WhisperModel(
                str(MODEL_DIR),
                device="cuda" if DEVICE == "auto" else DEVICE,
                compute_type="float16" if DEVICE == "auto" else "default",
                local_files_only=True,  # never reach for a hub download
            )
        except Exception as exc:  # noqa: BLE001 - fall back to CPU, then give up
            try:
                _model = WhisperModel(
                    str(MODEL_DIR), device="cpu", compute_type="int8", local_files_only=True
                )
            except Exception as inner:  # noqa: BLE001
                _error = f"{type(inner).__name__}: {inner} (after {exc})"
                return None
    return _model


def available() -> bool:
    return _load() is not None


def status() -> dict[str, Any]:
    _load()
    return {
        "engine": "faster-whisper (local)",
        "model": str(MODEL_DIR),
        "available": _model is not None,
        "error": _error,
        "audio_stored": 0,  # always. the temp file is unlinked before we return.
    }


def transcribe(audio_b64: str) -> dict[str, Any]:
    """Transcribe one recording. Audio is written to a temp file, read by the
    model, and unlinked in `finally` — nothing survives the call."""
    model = _load()
    if model is None:
        return {"ok": False, "error": _error or "speech-to-text unavailable", "text": ""}

    if "," in audio_b64[:64]:
        audio_b64 = audio_b64.split(",", 1)[1]
    try:
        raw = base64.b64decode(audio_b64)
    except (ValueError, TypeError):
        return {"ok": False, "error": "could not decode audio", "text": ""}
    if not raw:
        return {"ok": False, "error": "empty recording", "text": ""}

    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        tmp.write(raw)
        path = Path(tmp.name)
    try:
        segments, info = model.transcribe(str(path), language="en", vad_filter=True)
        text = " ".join(seg.text.strip() for seg in segments).strip()
        return {
            "ok": True,
            "text": text,
            "duration": round(getattr(info, "duration", 0.0), 1),
            "stored": False,
        }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}", "text": ""}
    finally:
        path.unlink(missing_ok=True)
