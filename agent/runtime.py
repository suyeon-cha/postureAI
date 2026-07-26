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


def _run_openclaw(messages, tool_schemas, on_step=None):
    try:
        import openclaw  # type: ignore
    except ImportError as exc:  # pragma: no cover - depends on event image
        raise RuntimeError(
            "FLOWRESET_RUNTIME=openclaw but openclaw is not importable. "
            "See _run_nemoclaw for the same wiring note; run native meanwhile."
        ) from exc

    # TODO(box): same two lines as above, against OpenClaw's constructor.
    agent = openclaw.Agent(  # type: ignore[attr-defined]
        model=llm.REASON_MODEL,
        base_url=llm.OLLAMA_HOST,
        tools=tool_schemas,
        tool_impl=tools.REGISTRY,
    )
    return agent.run(messages, on_step=on_step)


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
