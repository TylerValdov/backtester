"""WebSocket connection manager for live paper trading updates."""
import asyncio
import json

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self._subs: dict[str, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, session_id: str, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._subs.setdefault(session_id, set()).add(ws)

    async def disconnect(self, session_id: str, ws: WebSocket) -> None:
        async with self._lock:
            self._subs.get(session_id, set()).discard(ws)

    async def broadcast(self, session_id: str, payload: dict) -> None:
        conns = list(self._subs.get(session_id, ()))
        if not conns:
            return
        text = json.dumps(payload)
        for ws in conns:
            try:
                await ws.send_text(text)
            except Exception:
                await self.disconnect(session_id, ws)


manager = ConnectionManager()
