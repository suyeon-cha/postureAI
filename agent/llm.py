"""Local LLM client — Ollama on the box, nothing else.

Compliance lives here. `assert_local()` refuses any host that isn't loopback
or RFC1918, so a stray cloud endpoint in the environment fails at import time
rather than silently during the demo. Judges can read this file in 30 seconds.

Models (Qwen family, both from the USB drive):
  reason  qwen3:8b        - agent reasoning, routine selection, coach language
  vision  qwen2.5vl:7b    - form judge for planes the geometry rules can't see
"""

from __future__ import annotations

import ipaddress
import json
import os
import socket
import time
from typing import Any, Iterator
from urllib.parse import urlparse

import requests

OLLAMA_HOST = os.environ.get("FLOWRESET_OLLAMA", "http://127.0.0.1:11434")
REASON_MODEL = os.environ.get("FLOWRESET_REASON_MODEL", "qwen3:8b")
VISION_MODEL = os.environ.get("FLOWRESET_VISION_MODEL", "qwen2.5vl:7b")

REQUEST_TIMEOUT = float(os.environ.get("FLOWRESET_LLM_TIMEOUT", "45"))


class NonLocalEndpoint(RuntimeError):
    """Raised when a configured inference endpoint would leave the box."""


def _is_local_host(host: str) -> bool:
    if host in ("localhost", "::1"):
        return True
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        # A name, not a literal. Resolve it — a hostname that maps off-box is
        # still off-box, and this is exactly the mistake we want to catch.
        try:
            addr = ipaddress.ip_address(socket.gethostbyname(host))
        except (socket.gaierror, ValueError):
            return False
    return addr.is_loopback or addr.is_private or addr.is_link_local


def assert_local(url: str = OLLAMA_HOST) -> str:
    """Fail loudly if `url` points anywhere off this machine's network."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise NonLocalEndpoint(f"refusing non-http inference endpoint: {url}")
    if not parsed.hostname or not _is_local_host(parsed.hostname):
        raise NonLocalEndpoint(
            f"refusing non-local inference endpoint: {url}. "
            "FlowReset runs every model on the GB10; there is no cloud fallback."
        )
    return url


assert_local(OLLAMA_HOST)


def health() -> dict[str, Any]:
    """Model + endpoint status for the UI's local-AI badge."""
    status = {
        "endpoint": OLLAMA_HOST,
        "local": True,
        "reason_model": REASON_MODEL,
        "vision_model": VISION_MODEL,
        "reachable": False,
        "loaded": [],
    }
    try:
        resp = requests.get(f"{OLLAMA_HOST}/api/tags", timeout=3)
        resp.raise_for_status()
        status["reachable"] = True
        status["loaded"] = [m["name"] for m in resp.json().get("models", [])]
    except requests.RequestException as exc:
        status["error"] = str(exc)
    return status


def chat(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    model: str | None = None,
    temperature: float = 0.4,
    num_predict: int = 320,
) -> dict[str, Any]:
    """One turn against local Ollama. Returns the raw assistant message.

    The message carries `content` and, when the model decided to act,
    `tool_calls` — the agent loop in coach.py drives from there.
    """
    payload = {
        "model": model or REASON_MODEL,
        "messages": messages,
        "stream": False,
        "options": {"temperature": temperature, "num_predict": num_predict},
    }
    if tools:
        payload["tools"] = tools

    started = time.monotonic()
    resp = requests.post(
        f"{OLLAMA_HOST}/api/chat", json=payload, timeout=REQUEST_TIMEOUT
    )
    resp.raise_for_status()
    body = resp.json()
    message = body.get("message", {}) or {}
    message["_latency_ms"] = round((time.monotonic() - started) * 1000)
    message["_model"] = payload["model"]
    return message


def stream(messages: list[dict[str, Any]], model: str | None = None) -> Iterator[str]:
    """Token stream for coach lines we want on screen before TTS finishes."""
    payload = {
        "model": model or REASON_MODEL,
        "messages": messages,
        "stream": True,
        "options": {"temperature": 0.5, "num_predict": 120},
    }
    with requests.post(
        f"{OLLAMA_HOST}/api/chat", json=payload, timeout=REQUEST_TIMEOUT, stream=True
    ) as resp:
        resp.raise_for_status()
        for line in resp.iter_lines():
            if not line:
                continue
            chunk = json.loads(line)
            piece = chunk.get("message", {}).get("content", "")
            if piece:
                yield piece
            if chunk.get("done"):
                return


def look_at_frame(jpeg_b64: str, question: str) -> str:
    """Vision judge — qwen2.5vl on the box, one frame, held in memory only.

    Used when the pose geometry genuinely can't answer (chin tuck depth,
    squat depth in the sagittal plane). Never a diagnosis, only form.
    """
    message = chat(
        messages=[
            {
                "role": "system",
                "content": (
                    "You judge exercise form from a single webcam frame. "
                    "Answer in one short sentence describing what you see about "
                    "the movement only. Never comment on the person's appearance, "
                    "surroundings, or health."
                ),
            },
            {"role": "user", "content": question, "images": [jpeg_b64]},
        ],
        model=VISION_MODEL,
        temperature=0.2,
        num_predict=80,
    )
    return (message.get("content") or "").strip()
