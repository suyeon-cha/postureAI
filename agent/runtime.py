"""Agent runtime adapter — NemoClaw / OpenClaw / native.

The competition requires an approved stack. We don't want to discover the
starter's API at 09:00 on demo day with the whole app wired to it, so the
FlowReset agent talks to *this* interface and nothing else:

    run(messages, tools, on_step) -> final assistant message

`native` is a complete, working tool-calling loop against local Qwen. It is
the fallback that guarantees we always have a demo. `nemoclaw` and `openclaw`
are thin adapters: on the box, fill in the two marked lines, flip
FLOWRESET_RUNTIME, and the rest of the app is unchanged.

Whichever runtime is active, `active_runtime()` reports it and the UI shows it,
so what the judges see on screen is what actually executed.
"""

from __future__ import annotations

import json
import os
from typing import Any, Callable, Dict

from . import llm, tools

RUNTIME = os.environ.get("FLOWRESET_RUNTIME", "native").lower()
MAX_STEPS = int(os.environ.get("FLOWRESET_MAX_STEPS", "6"))

# typing.Dict, not dict[...]: a type *alias* is evaluated at runtime even with
# `from __future__ import annotations`, and builtin generics only became
# subscriptable in 3.9. We don't control the Python on the box.
StepCallback = Callable[[Dict[str, Any]], None]


def active_runtime() -> dict[str, Any]:
    return {
        "runtime": RUNTIME,
        "available": sorted(_RUNTIMES),
        "max_steps": MAX_STEPS,
        "tools": sorted(tools.REGISTRY),
    }


# ───────────────────────────── native loop ─────────────────────────────


def _run_native(
    messages: list[dict[str, Any]],
    tool_schemas: list[dict[str, Any]],
    on_step: StepCallback | None = None,
) -> dict[str, Any]:
    """Tool-calling loop against local Qwen via Ollama.

    Each iteration: ask the model, run any tool calls it emitted, append the
    results, ask again. Stops when the model answers without calling a tool.
    """
    convo = list(messages)

    for step in range(MAX_STEPS):
        reply = llm.chat(convo, tools=tool_schemas)
        calls = reply.get("tool_calls") or []

        if on_step:
            on_step(
                {
                    "kind": "model",
                    "step": step,
                    "content": reply.get("content", ""),
                    "tool_calls": [
                        c.get("function", {}).get("name") for c in calls
                    ],
                    "latency_ms": reply.get("_latency_ms"),
                    "model": reply.get("_model"),
                }
            )

        if not calls:
            return reply

        convo.append(
            {
                "role": "assistant",
                "content": reply.get("content", ""),
                "tool_calls": calls,
            }
        )

        for call in calls:
            fn = call.get("function", {})
            name = fn.get("name", "")
            args = fn.get("arguments") or {}
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except json.JSONDecodeError:
                    args = {}

            result = tools.call(name, args)

            if on_step:
                on_step(
                    {
                        "kind": "tool",
                        "step": step,
                        "name": name,
                        "arguments": args,
                        "result": result,
                    }
                )

            convo.append(
                {
                    "role": "tool",
                    "name": name,
                    "content": json.dumps(result, default=str)[:4000],
                }
            )

    # Out of steps: ask for a plain answer with no tools so we always close out.
    final = llm.chat(convo + [
        {
            "role": "user",
            "content": "Summarize the plan for me now in two sentences, no tools.",
        }
    ])
    if on_step:
        on_step({"kind": "model", "step": MAX_STEPS, "content": final.get("content", ""),
                 "tool_calls": [], "note": "step limit reached"})
    return final


# ──────────────────────── approved-stack adapters ────────────────────────
#
# Neither framework is installed here, so these are honest stubs rather than
# guessed APIs. Each needs exactly one thing filled in on the box: construct
# the framework's agent with our SCHEMAS + REGISTRY and run one turn. The
# import failure message tells whoever is at the keyboard what to do.


def _run_nemoclaw(messages, tool_schemas, on_step=None):
    try:
        import nemoclaw  # type: ignore
    except ImportError as exc:  # pragma: no cover - depends on event image
        raise RuntimeError(
            "FLOWRESET_RUNTIME=nemoclaw but nemoclaw is not importable. "
            "On the box: install the starter, then wire the two lines marked "
            "TODO(box) in agent/runtime.py::_run_nemoclaw. Until then run with "
            "FLOWRESET_RUNTIME=native — same tools, same prompts, same UI."
        ) from exc

    # TODO(box): construct with tools.SCHEMAS / tools.REGISTRY and llm.OLLAMA_HOST,
    # then run one turn and return an assistant message dict with .content.
    agent = nemoclaw.Agent(  # type: ignore[attr-defined]
        model=llm.REASON_MODEL,
        base_url=llm.OLLAMA_HOST,
        tools=tool_schemas,
        tool_impl=tools.REGISTRY,
    )
    return agent.run(messages, on_step=on_step)


OPENCLAW_BIN = os.environ.get("FLOWRESET_OPENCLAW_BIN", "openclaw")
OPENCLAW_AGENT = os.environ.get("FLOWRESET_OPENCLAW_AGENT", "flowreset")
OPENCLAW_TIMEOUT = int(os.environ.get("FLOWRESET_OPENCLAW_TIMEOUT", "240"))


def _extract_json(blob: str) -> dict[str, Any]:
    """Pull the result object out of OpenClaw's stdout.

    The CLI interleaves log lines with the JSON payload, so we scan for the
    last balanced top-level object rather than trusting the whole stream.
    """
    depth = 0
    start = -1
    best = None
    in_str = False
    escape = False

    for i, ch in enumerate(blob):
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start >= 0:
                candidate = blob[start:i + 1]
                if len(candidate) > len(best or ""):
                    best = candidate

    if not best:
        return {}
    try:
        return json.loads(best)
    except json.JSONDecodeError:
        return {}


def _walk_tool_calls(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Read the tools OpenClaw actually invoked.

    They arrive under meta.toolSummary.tools, namespaced by MCP server as
    `flowreset__<tool>`; strip the prefix so the UI trace shows our own names.
    """
    meta = payload.get("meta") or {}
    names = ((meta.get("toolSummary") or {}).get("tools")) or []

    calls = []
    for raw in names:
        name = raw.split("__")[-1] if isinstance(raw, str) else ""
        if name in tools.REGISTRY:
            calls.append({"name": name, "arguments": {}, "result": None})
    return calls


def _run_openclaw(messages, tool_schemas, on_step=None):
    """Drive OpenClaw's CLI as a subprocess.

    OpenClaw ships as a Node CLI, not a Python package — `import openclaw` can
    never succeed. The tools reach it over MCP instead (see agent/mcp_server.py),
    registered once with:

        openclaw mcp add flowreset --command <venv python> \
            --arg -m --arg agent.mcp_server --cwd <repo root>

    Note the latency: a turn costs ~50-75s, dominated by ~18k tokens of
    OpenClaw's own scaffolding plus node start-up. Call this once per session,
    off the interactive path — never inside the movement loop.
    """
    import subprocess
    import uuid

    prompt = ""
    for msg in reversed(messages):
        if msg.get("role") == "user" and msg.get("content"):
            prompt = msg["content"]
            break
    if not prompt:
        raise RuntimeError("openclaw runtime: no user message to send")

    cmd = [
        OPENCLAW_BIN, "agent", "--local",
        "--agent", OPENCLAW_AGENT,
        "--session-key", f"flowreset-{uuid.uuid4().hex[:12]}",
        "--message", prompt,
        "--json",
    ]

    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=OPENCLAW_TIMEOUT,
        )
    except FileNotFoundError as exc:
        raise RuntimeError(
            f"FLOWRESET_RUNTIME=openclaw but {OPENCLAW_BIN!r} is not on PATH. "
            "Install the CLI (npm i -g openclaw) or set FLOWRESET_OPENCLAW_BIN. "
            "Run with FLOWRESET_RUNTIME=native meanwhile — same tools, same UI."
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(
            f"openclaw agent turn exceeded {OPENCLAW_TIMEOUT}s"
        ) from exc

    payload = _extract_json(proc.stdout)
    meta = payload.get("meta") or {}
    payloads = payload.get("payloads") or []

    # The reply lives at meta.finalAssistantVisibleText, with payloads[0].text
    # carrying the same string — not at the top level.
    content = (
        meta.get("finalAssistantVisibleText")
        or meta.get("finalAssistantRawText")
        or (payloads[0].get("text") if payloads else "")
        or ""
    )

    if not content:
        raise RuntimeError(
            "openclaw returned no assistant text "
            f"(exit {proc.returncode}): {proc.stderr.strip()[:300]}"
        )

    calls = _walk_tool_calls(payload)

    if on_step:
        for call in calls:
            on_step({
                "kind": "tool",
                "step": 0,
                "name": call["name"],
                "arguments": call["arguments"],
                "result": call["result"],
            })

        trace = meta.get("executionTrace") or {}
        on_step({
            "kind": "model",
            "step": len(calls),
            "content": content,
            "tool_calls": [c["name"] for c in calls],
            "model": trace.get("winnerModel"),
            "runtime": "openclaw",
            "duration_ms": meta.get("durationMs"),
        })

    return {"role": "assistant", "content": content, "tool_calls": []}


_RUNTIMES: dict[str, Callable[..., dict[str, Any]]] = {
    "native": _run_native,
    "nemoclaw": _run_nemoclaw,
    "openclaw": _run_openclaw,
}


def run(
    messages: list[dict[str, Any]],
    tool_schemas: list[dict[str, Any]] | None = None,
    on_step: StepCallback | None = None,
) -> dict[str, Any]:
    impl = _RUNTIMES.get(RUNTIME)
    if impl is None:
        raise RuntimeError(
            f"unknown FLOWRESET_RUNTIME={RUNTIME!r}; choose one of {sorted(_RUNTIMES)}"
        )
    return impl(messages, tool_schemas or tools.SCHEMAS, on_step)
