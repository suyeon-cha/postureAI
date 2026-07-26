"""In-process bus: one broadcaster, one event queue.

perception → agent → server are all in this process (contracts.md Transport),
so this is a couple of asyncio primitives rather than a message broker. Kept
in its own module so the WebSocket layer and the session runner don't import
each other.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any


class Broadcast:
    """Fan-out to every connected UI. A slow client is dropped, not buffered."""

    def __init__(self) -> None:
        self._clients: set[Any] = set()
        self._lock = asyncio.Lock()

    async def add(self, ws: Any) -> None:
        async with self._lock:
            self._clients.add(ws)

    async def remove(self, ws: Any) -> None:
        async with self._lock:
            self._clients.discard(ws)

    @property
    def count(self) -> int:
        return len(self._clients)

    async def send(self, message: dict[str, Any]) -> None:
        if not self._clients:
            return
        payload = json.dumps(message, default=str)
        async with self._lock:
            targets = list(self._clients)
        dead = []
        for ws in targets:
            try:
                await ws.send_text(payload)
            except Exception:  # noqa: BLE001 - a closed socket is normal
                dead.append(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    self._clients.discard(ws)


class EventQueue:
    """perception → agent. Bounded: under load we drop the oldest, never block
    the capture path."""

    def __init__(self, maxsize: int = 64) -> None:
        self._q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=maxsize)

    def put_nowait(self, event: dict[str, Any]) -> None:
        try:
            self._q.put_nowait(event)
        except asyncio.QueueFull:
            try:
                self._q.get_nowait()
                self._q.put_nowait(event)
            except (asyncio.QueueEmpty, asyncio.QueueFull):
                pass

    async def get(self) -> dict[str, Any]:
        return await self._q.get()

    def empty(self) -> bool:
        return self._q.empty()
