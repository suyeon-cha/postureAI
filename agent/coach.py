"""FlowReset coach — OpenClaw (or NemoClaw) skill.

Owns: coach persona + session memory, routine composer (posture debt ->
moves from exercises.yaml scaled to user-chosen duration), tools:
  - speak(text)        -> Piper TTS via server
  - look_at_frame(jpg) -> qwen2.5vl:7b via local Ollama (vlm_check_needed)

LLM: gpt-oss:20b via local Ollama. No remote calls — compliance lives here.
Consumes `event`, emits `coach` messages per contracts.md section 3.
"""

# TODO(lane 2): implement at the event
