#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""اكتشاف الكاميرات وربطها عبر API السيرفر المحلي (جهاز الشركة → البث للهوست)."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


def load_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def edge_config(root: Path) -> dict[str, str]:
    env = {**load_env_file(root / ".env"), **os.environ}
    return {
        "auto_discover": env.get("EDGE_AUTO_DISCOVER", "true").lower() in ("1", "true", "yes"),
        "auto_provision": env.get("EDGE_AUTO_PROVISION", "true").lower() in ("1", "true", "yes"),
        "api_user": env.get("EDGE_API_USERNAME", env.get("EDGE_API_USER", "admin")),
        "api_password": env.get("EDGE_API_PASSWORD", "admin123"),
        "camera_user": env.get("EDGE_CAMERA_USERNAME", "admin"),
        "camera_password": env.get("EDGE_CAMERA_PASSWORD", ""),
        "camera_passwords": env.get("EDGE_CAMERA_PASSWORDS", ""),
        "discover_timeout": env.get("EDGE_DISCOVER_TIMEOUT_MS", "12000"),
    }


def camera_password_candidates(cfg: dict[str, str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in (cfg.get("camera_password"), cfg.get("camera_passwords", "")):
        if not raw:
            continue
        for part in raw.replace(";", ",").split(","):
            p = part.strip()
            if p not in seen:
                seen.add(p)
                out.append(p)
    for default in ("", "admin", "admin123", "admin123456", "12345", "123456"):
        if default not in seen:
            seen.add(default)
            out.append(default)
    return out


@dataclass
class ProvisionResult:
    discovered: int = 0
    linked: int = 0
    added: int = 0
    failed: int = 0
    streams_started: int = 0


class EdgeApiClient:
    def __init__(self, base_url: str) -> None:
        self.base = base_url.rstrip("/")
        self.token: str | None = None

    def _request(
        self,
        method: str,
        path: str,
        body: dict | None = None,
        timeout: float = 30,
    ) -> Any:
        url = f"{self.base}{path}"
        data = None
        headers = {"Accept": "application/json"}
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            try:
                detail = json.loads(err_body)
            except json.JSONDecodeError:
                detail = err_body
            raise RuntimeError(f"{method} {path} → {e.code}: {detail}") from e

    def login(self, username: str, password: str) -> None:
        data = self._request("POST", "/api/auth/login", {"username": username, "password": password})
        token = data.get("accessToken")
        if not token:
            raise RuntimeError("فشل تسجيل الدخول — لا يوجد accessToken")
        self.token = token

    def discover(self, timeout_ms: int = 12000) -> list[dict]:
        q = f"?timeout={timeout_ms}&subnetScan=true"
        data = self._request("GET", f"/api/cameras/discover{q}", timeout=max(30, timeout_ms / 1000 + 15))
        return list(data.get("devices") or [])

    def test_camera(
        self,
        host: str,
        onvif_port: int,
        username: str,
        password: str,
    ) -> dict:
        return self._request(
            "POST",
            "/api/cameras/test",
            {
                "host": host,
                "onvifPort": onvif_port,
                "username": username,
                "password": password,
            },
            timeout=25,
        )

    def create_camera(
        self,
        name: str,
        host: str,
        onvif_port: int,
        username: str,
        password: str,
    ) -> dict:
        return self._request(
            "POST",
            "/api/cameras",
            {
                "name": name,
                "host": host,
                "onvifPort": onvif_port,
                "username": username,
                "password": password,
            },
            timeout=30,
        )

    def list_cameras(self) -> list[dict]:
        data = self._request("GET", "/api/cameras")
        return list(data.get("cameras") or [])

    def start_stream(self, camera_id: str, quality: str = "sub") -> dict:
        return self._request(
            "POST",
            f"/api/streams/{camera_id}/start",
            {"quality": quality},
            timeout=20,
        )


def try_camera_credentials(
    client: EdgeApiClient,
    host: str,
    port: int,
    username: str,
    passwords: list[str],
) -> tuple[str | None, dict | None]:
    for pwd in passwords:
        try:
            r = client.test_camera(host, port, username, pwd)
            if r.get("ok"):
                return pwd, r
        except RuntimeError as e:
            msg = str(e)
            if "AUTH_REQUIRED" in msg or "requires login" in msg.lower():
                continue
            if "AUTH_FAILED" in msg or "Invalid username" in msg:
                break
    return None, None


def provision_cameras(
    base_url: str,
    root: Path,
    log: Callable[[str], None],
    *,
    force: bool = False,
) -> ProvisionResult:
    cfg = edge_config(root)
    if not force and not cfg["auto_provision"]:
        log("[وكيل] الربط التلقائي معطّل (EDGE_AUTO_PROVISION=false)")
        return ProvisionResult()

    result = ProvisionResult()
    client = EdgeApiClient(base_url)

    log(f"[وكيل] تسجيل الدخول API — مستخدم {cfg['api_user']}")
    client.login(cfg["api_user"], cfg["api_password"])

    if cfg["auto_discover"] or force:
        timeout = int(cfg["discover_timeout"])
        log(f"[وكيل] مسح الشبكة للكاميرات (حتى {timeout}ms)…")
        devices = client.discover(timeout_ms=timeout)
        result.discovered = len(devices)
        log(f"[وكيل] وُجد {result.discovered} جهاز ONVIF/RTSP")
    else:
        devices = []

    passwords = camera_password_candidates(cfg)
    cam_user = cfg["camera_user"]

    for dev in devices:
        if dev.get("linkStatus") == "exact":
            result.linked += 1
            continue

        host = dev["host"]
        port = int(dev.get("port") or 80)
        name = (dev.get("name") or host).strip() or host
        log(f"[وكيل] محاولة ربط {host}:{port} ({name})…")

        pwd, test = try_camera_credentials(client, host, port, cam_user, passwords)
        if not pwd or not test:
            result.failed += 1
            log(f"[وكيل] ✗ فشل الدخول/الاختبار — {host}")
            continue

        try:
            created = client.create_camera(name, host, port, cam_user, pwd)
            cam = created.get("camera") or {}
            result.added += 1
            log(f"[وكيل] ✓ أُضيفت الكاميرا {cam.get('name', name)} (id={cam.get('id', '?')})")
            if test.get("preview", {}).get("streamName"):
                log(f"[وكيل]   معاينة: {test['preview']['streamName']}")
        except RuntimeError as e:
            if "already" in str(e).lower() or "unique" in str(e).lower():
                result.linked += 1
                log(f"[وكيل] ○ مربوطة مسبقاً — {host}")
            else:
                result.failed += 1
                log(f"[وكيل] ✗ إنشاء الكاميرا: {e}")

    cameras = client.list_cameras()
    for cam in cameras:
        if not cam.get("enabled", True):
            continue
        cid = cam.get("id")
        if not cid:
            continue
        try:
            stream = client.start_stream(cid, "sub")
            urls = stream.get("urls") or {}
            hls = urls.get("hls", "")
            ws = urls.get("ws", "")
            log(f"[وكيل] بث API — {cam.get('name')}: {base_url}{hls}")
            if ws:
                log(f"[وكيل] WebSocket real-time: {base_url}{ws}")
            result.streams_started += 1
        except RuntimeError as e:
            log(f"[وكيل] تحذير بث {cam.get('name')}: {e}")

    log(
        f"[وكيل] اكتمل — اكتشاف:{result.discovered} مربوطة:{result.linked} "
        f"جديدة:{result.added} فشل:{result.failed} بث:{result.streams_started}"
    )
    log(f"[وكيل] الهوست يفتح: {base_url} (نفس API + WebSocket + HLS/WebRTC)")
    return result
