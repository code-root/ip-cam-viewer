#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""اتصال Socket.IO real-time مع السيرفر (بث + أحداث الكاميرات)."""
from __future__ import annotations

from typing import Any, Callable

try:
    import socketio
except ImportError:
    socketio = None  # type: ignore


class EdgeSocketClient:
    def __init__(self, base_url: str, token: str, on_log: Callable[[str], None]) -> None:
        if socketio is None:
            raise RuntimeError("ثبّت: pip install python-socketio[client]")
        self.base = base_url.rstrip("/")
        self.token = token
        self.on_log = on_log
        self._sio = socketio.Client(reconnection=True, reconnection_attempts=5)
        self._handlers: list[tuple[str, Callable]] = []
        self._wire_events()

    def _wire_events(self) -> None:
        @self._sio.event
        def connect() -> None:
            self.on_log("[WebSocket] متصل — Socket.IO real-time ✓")

        @self._sio.event
        def disconnect() -> None:
            self.on_log("[WebSocket] انقطع الاتصال")

        @self._sio.on("connected")
        def on_connected(data: dict) -> None:
            self.on_log(f"[WebSocket] جلسة: user={data.get('userId', '?')}")

        @self._sio.on("stream:started")
        def on_stream_started(data: dict) -> None:
            name = data.get("streamName", "?")
            ws = (data.get("urls") or {}).get("ws", "")
            self.on_log(f"[WebSocket] بث نشط — {name}")
            if ws:
                self.on_log(f"[WebSocket]   WS: {self.base}{ws}")

        @self._sio.on("heartbeat")
        def on_heartbeat(_data: dict) -> None:
            pass

    @property
    def connected(self) -> bool:
        return self._sio.connected

    def connect(self) -> None:
        if self._sio.connected:
            return
        self.on_log(f"[WebSocket] اتصال بـ {self.base} …")
        self._sio.connect(
            self.base,
            auth={"token": self.token},
            transports=["websocket"],
            wait_timeout=10,
        )

    def disconnect(self) -> None:
        if self._sio.connected:
            self._sio.disconnect()

    def subscribe_camera(self, camera_id: str) -> None:
        self._sio.emit("subscribe:camera", camera_id)
        self.on_log(f"[WebSocket] اشتراك كاميرا {camera_id}")

    def wait(self, timeout: float | None = None) -> None:
        self._sio.wait(timeout=timeout)
