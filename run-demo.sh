#!/usr/bin/env bash
# FlowReset judging build. Every model below is local to this GB10 — no hosted
# inference, no API keys. Paths point at what is actually installed on this box,
# which differs from the repo defaults.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"

export FLOWRESET_RUNTIME=native            # openclaw removed: 50-100s/turn was unusable

# Reasoning. Repo default qwen3:8b is not installed here; 14b is.
export FLOWRESET_REASON_MODEL=qwen3:14b
export FLOWRESET_VISION_MODEL=gemma4:latest      # only multimodal model on the box (vision+audio+tools)

# Piper: the wheel installs the CLI inside the venv rather than on PATH, and
# the voice we downloaded is lessac, not amy.
export FLOWRESET_PIPER_BIN="$ROOT/.venv/bin/piper"
export FLOWRESET_PIPER_VOICE="$ROOT/voices/en_US-lessac-medium.onnx"

# Whisper weights, if a faster-whisper model dir is present.
export FLOWRESET_WHISPER_MODEL="$ROOT/models/faster-whisper-base.en"

# ── demo shaping ───────────────────────────────────────────────────────────
# Deterministic circuits per check-in (see routines.DEMO_RECIPES). The composer
# already picks moves by rule rather than by model, but it shuffles the tail of
# a round when no seed is given; this pins the result so every rehearsal and
# every take is identical. Set to 0 to fall back to the composer.
export FLOWRESET_DETERMINISTIC=1

# Speak form corrections for the lunge only. The upper-body holds run silently;
# their detectors are angle-holds we have not calibrated as carefully, and a
# confident wrong correction on camera is worse than staying quiet.
export FLOWRESET_COACHED_MOVES=lunge

# An OpenClaw agent turn takes ~50-100s. uvicorn's default 20s websocket ping
# timeout will drop the camera socket while the user waits for a plan, so give
# the heartbeat enough room to survive a full turn.
exec .venv/bin/uvicorn server.main:app --host 0.0.0.0 --port 8000 \
    --ws-ping-interval 30 --ws-ping-timeout 180 --timeout-keep-alive 180
