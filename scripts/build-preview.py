#!/usr/bin/env python3
"""Bundle the UI into one self-contained HTML file.

Why: the real app is served by the box as separate ES modules, which is right
for the box and useless for sharing. This inlines the CSS and concatenates the
modules into a single file that opens from a filesystem or a static host with no
server, no build tool, and no network — for demo backups, pitch screenshots, and
sending the interface to someone who doesn't have the GB10.

The bundle forces preview mode, so it shows the mock stand-in and says so. It is
not the judging path.

    python3 scripts/build-preview.py                       -> ui/preview.html
    python3 scripts/build-preview.py out.html
    python3 scripts/build-preview.py out.html --fragment   -> no <html>/<head>,
        for hosts that supply their own document shell.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

UI = Path(__file__).parent.parent / "ui"

# Dependency order. Each is wrapped in a block and the names it provides are
# handed to the next module, so the modules keep their own `el`/`esc` helpers
# without colliding.
MODULES = [
    ("overlay.js", ["SKELETON_EDGES", "drawSkeleton", "drawFrameGuide"]),
    ("charts.js", ["dayBars", "responseSplit", "areaBars"]),
    ("mock.js", ["MockBackend"]),
]

IMPORT_RE = re.compile(r"^\s*import\s.*?;\s*$", re.M)
EXPORT_RE = re.compile(r"^(\s*)export\s+(?=(?:const|let|var|function|class)\b)", re.M)


def strip_module_syntax(src: str) -> str:
    src = IMPORT_RE.sub("", src)
    return EXPORT_RE.sub(r"\1", src)


def build(fragment: bool = False) -> str:
    css = (UI / "styles.css").read_text()

    parts: list[str] = [
        "/* Bundled by scripts/build-preview.py — edit ui/*.js, not this file. */",
        "window.__FLOWRESET_PREVIEW = true;",
        "const __exports = {};",
    ]

    for filename, names in MODULES:
        body = strip_module_syntax((UI / filename).read_text())
        assigns = "\n".join(f"  __exports.{n} = {n};" for n in names)
        parts.append(f"/* ── {filename} ── */\n{{\n{body}\n{assigns}\n}}")

    app = strip_module_syntax((UI / "app.js").read_text())
    parts.append(
        "/* ── app.js ── */\n{\n"
        "  const { SKELETON_EDGES, drawSkeleton, drawFrameGuide } = __exports;\n"
        "  const charts = {\n"
        "    dayBars: __exports.dayBars,\n"
        "    responseSplit: __exports.responseSplit,\n"
        "    areaBars: __exports.areaBars,\n"
        "  };\n"
        "  const MockBackend = __exports.MockBackend;\n"
        f"{app}\n}}"
    )

    script = "\n\n".join(parts)

    # The chrome from index.html, minus the external <link> and <script src>.
    html = (UI / "index.html").read_text()
    body_start = html.index("<body>") + len("<body>")
    body_end = html.index("</body>")
    body = html[body_start:body_end]
    body = re.sub(r'\s*<script type="module".*?</script>', "", body, flags=re.S)

    inner = f"""<style>
{css}
</style>
{body}
<script type="module">
{script}
</script>
"""
    if fragment:
        return inner

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>FlowReset — interface preview</title>
</head>
<body>
{inner}</body>
</html>
"""


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    is_fragment = "--fragment" in sys.argv
    out = Path(args[0]) if args else UI / "preview.html"
    text = build(fragment=is_fragment)
    out.write_text(text)
    print(f"wrote {out} ({len(text) / 1024:.0f} KB){' [fragment]' if is_fragment else ''}")
