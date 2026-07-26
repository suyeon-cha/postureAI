"""Piper TTS — local voice, on the box.

Synthesis runs as a subprocess against a voice model from the USB drive. If
Piper isn't present the app degrades to text-only coaching rather than
failing: a silent demo is survivable, a crashed one is not.

Audio is written to a temp file, streamed once, and unlinked. Nothing is kept.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

VOICE_PATH = Path(
    os.environ.get(
        "FLOWRESET_PIPER_VOICE",
        Path(__file__).parent.parent / "models" / "en_US-amy-medium.onnx",
    )
)
PIPER_BIN = os.environ.get("FLOWRESET_PIPER_BIN", "piper")


def available() -> bool:
    return shutil.which(PIPER_BIN) is not None and VOICE_PATH.exists()


def status() -> dict[str, object]:
    return {
        "engine": "Piper (local)",
        "binary": shutil.which(PIPER_BIN),
        "voice": str(VOICE_PATH),
        "available": available(),
    }


def synthesize(text: str) -> bytes | None:
    """Return WAV bytes for `text`, or None if Piper isn't usable."""
    if not available() or not text.strip():
        return None
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        out_path = Path(tmp.name)
    try:
        subprocess.run(
            [PIPER_BIN, "--model", str(VOICE_PATH), "--output_file", str(out_path)],
            input=text.encode("utf-8"),
            check=True,
            capture_output=True,
            timeout=15,
        )
        return out_path.read_bytes()
    except (subprocess.SubprocessError, OSError):
        return None
    finally:
        out_path.unlink(missing_ok=True)
