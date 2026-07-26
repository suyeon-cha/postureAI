#!/usr/bin/env bash
# Prove FlowReset is local before demoing it.
#
# Judges shouldn't take our word for it, and neither should we. This greps the
# tree for cloud inference, checks the configured endpoint is on-box, and prints
# live model health. Run it again with egress blocked — the golden path has to
# complete either way.
#
# Exits non-zero if anything looks like it would leave the machine.

set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=1; }
info() { printf '  · %s\n' "$1"; }

echo
echo "FlowReset — local inference check"
echo "================================="

# ── 1. no cloud inference hosts or SDKs in our own source ──
echo
echo "1. Source contains no external AI provider"
HOSTS='api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis|
openai\.azure\.com|api\.cohere|api\.mistral\.ai|api\.replicate\.com|
huggingface\.co/api|api\.groq\.com|bedrock.*amazonaws|api\.deepseek\.com'
SDKS='^\s*(import|from)\s+(openai|anthropic|google\.generativeai|cohere|mistralai|replicate|boto3)\b'

SRC=$(git ls-files '*.py' '*.js' '*.yaml' '*.yml' '*.json' '*.sh' 2>/dev/null \
      | grep -v -e '^scripts/verify-local.sh$' || true)

if [ -z "$SRC" ]; then
  info "no tracked source files found (run from a git checkout)"
else
  if echo "$SRC" | xargs grep -nEi "$(echo "$HOSTS" | tr -d '\n ')" 2>/dev/null; then
    bad "a cloud inference host appears in the source above"
  else
    pass "no cloud inference hostnames"
  fi

  if echo "$SRC" | xargs grep -nE "$SDKS" 2>/dev/null; then
    bad "a hosted-model SDK is imported above"
  else
    pass "no hosted-model SDK imports"
  fi

  # A real key, not the word "key" in prose.
  if echo "$SRC" | xargs grep -nE '(sk-[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,})' 2>/dev/null; then
    bad "something shaped like an API key is committed above"
  else
    pass "no API keys committed"
  fi
fi

# ── 2. the configured endpoint is on this machine ──
echo
echo "2. Configured inference endpoint is local"
if python3 -c "
import sys
sys.path.insert(0, '.')
try:
    from agent import llm
except Exception as exc:
    print(f'  import failed: {exc}')
    sys.exit(2)
print(f'  endpoint  {llm.OLLAMA_HOST}')
print(f'  reasoning {llm.REASON_MODEL}')
print(f'  vision    {llm.VISION_MODEL}')
" 2>&1; then
  pass "agent.llm imported — assert_local() accepted the endpoint"
else
  bad "agent.llm refused the configured endpoint (or failed to import)"
fi

# ── 3. live model health ──
echo
echo "3. Local models responding"
OLLAMA="${FLOWRESET_OLLAMA:-http://127.0.0.1:11434}"
if curl -sf --max-time 3 "$OLLAMA/api/tags" >/dev/null 2>&1; then
  pass "Ollama up at $OLLAMA"
  curl -sf --max-time 3 "$OLLAMA/api/tags" \
    | python3 -c "import json,sys; [print('  ·',m['name']) for m in json.load(sys.stdin).get('models',[])]" \
    2>/dev/null || true
else
  info "Ollama not reachable at $OLLAMA (start it on the box before demoing)"
fi

for f in models/pose_landmarker_heavy.task; do
  [ -f "$f" ] && pass "$f present" || info "$f missing — copy from the USB drive"
done

if curl -sf --max-time 3 http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
  pass "FlowReset server up"
  curl -sf http://127.0.0.1:8000/api/health | python3 -c "
import json, sys
h = json.load(sys.stdin)
print('  runtime      ', h.get('runtime', {}).get('runtime'))
print('  llm reachable', h.get('llm', {}).get('reachable'))
print('  pose         ', h.get('pose', {}).get('available'))
print('  frames stored', h.get('pose', {}).get('frames_stored'))
print('  external APIs', h.get('external_ai_apis'))
" 2>/dev/null || true
else
  info "server not running (uvicorn server.main:app --host 0.0.0.0 --port 8000)"
fi

echo
if [ "$fail" -eq 0 ]; then
  printf '\033[32mAll local-inference checks passed.\033[0m\n'
else
  printf '\033[31mFAILED — fix the ✗ items before submitting.\033[0m\n'
fi
echo
exit "$fail"
