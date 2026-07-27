"""MCP stdio server exposing the FlowReset tools to OpenClaw.

OpenClaw is a Node CLI, not a Python package, so it cannot import our tools
directly (this is why `import openclaw` in runtime.py could never work). It
reaches them over MCP instead: OpenClaw spawns this process, lists the tools,
and calls them. They are the *same* functions the native runtime calls, so both
runtimes exercise identical behaviour.

JSON-RPC is hand-rolled rather than using the MCP SDK: no extra dependency to
install, nothing to fetch at demo time.

Run as a module so the package-relative imports resolve:
    python -m agent.mcp_server
"""

from __future__ import annotations

import json
import sys
import traceback

from . import tools

PROTOCOL_VERSION = "2024-11-05"


def _mcp_tools() -> list[dict]:
    """Convert our OpenAI-style function schemas into MCP tool descriptors."""
    out = []
    for schema in tools.SCHEMAS:
        fn = schema.get("function", {})
        out.append({
            "name": fn.get("name", ""),
            "description": fn.get("description", ""),
            "inputSchema": fn.get("parameters") or {"type": "object", "properties": {}},
        })
    return out


def _send(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def _result(req_id, result) -> None:
    _send({"jsonrpc": "2.0", "id": req_id, "result": result})


def _error(req_id, code: int, message: str) -> None:
    _send({"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}})


def handle(msg: dict) -> None:
    method = msg.get("method")
    req_id = msg.get("id")

    # Notifications carry no id and must never be answered.
    if req_id is None:
        return

    if method == "initialize":
        _result(req_id, {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "flowreset", "version": "1.0.0"},
        })

    elif method == "tools/list":
        _result(req_id, {"tools": _mcp_tools()})

    elif method == "tools/call":
        params = msg.get("params") or {}
        name = params.get("name", "")
        args = params.get("arguments") or {}

        if name not in tools.REGISTRY:
            _error(req_id, -32602, f"unknown tool: {name}")
            return

        try:
            output = tools.call(name, args)
            _result(req_id, {
                "content": [{"type": "text", "text": json.dumps(output, default=str)}],
                "isError": False,
            })
        except Exception as exc:  # noqa: BLE001 — report, never kill the server
            _result(req_id, {
                "content": [{"type": "text", "text": f"{type(exc).__name__}: {exc}"}],
                "isError": True,
            })
            print(traceback.format_exc(), file=sys.stderr)

    elif method == "ping":
        _result(req_id, {})

    else:
        _error(req_id, -32601, f"method not found: {method}")


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        handle(msg)


if __name__ == "__main__":
    main()
