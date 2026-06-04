#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pull releases from api-stpreg project-updates API, apply zip, rebuild, relaunch EXE."""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Callable

from edge_agent import edge_config, load_env_file

BUILD_STATE = ".edge-release-state.json"
SKIP_DIRS = {
    "node_modules",
    ".git",
    ".venv",
    "data",
    "__pycache__",
    ".cursor",
    "dist-launcher/build",
    "scripts/company-edge-gui/build",
}
SKIP_FILES = {".env", "server/data/app.db"}
PRESERVE_PREFIXES = ("data/", "server/data/", ".env")


def _parse_version(v: str) -> tuple[int, ...]:
    parts: list[int] = []
    for piece in re.split(r"[.\-]", v.strip()):
        if piece.isdigit():
            parts.append(int(piece))
        elif piece:
            parts.append(0)
    return tuple(parts) if parts else (0,)


def version_newer(remote: str, local: str) -> bool:
    return _parse_version(remote) > _parse_version(local)


def _api_request(
    url: str,
    token: str,
    *,
    method: str = "GET",
    data: bytes | None = None,
    headers: dict | None = None,
    timeout: float = 120,
) -> tuple[int, bytes]:
    h = {"Accept": "application/json", "User-Agent": "CompanyEdgeLauncher/1.0"}
    if token:
        # api-stpreg internal API uses x-api-key (owner token), not Bearer
        h["x-api-key"] = token
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def _parse_success(body: bytes) -> dict | None:
    try:
        doc = json.loads(body.decode("utf-8"))
    except json.JSONDecodeError:
        return None
    if not doc.get("success"):
        return None
    data = doc.get("data")
    return data if isinstance(data, dict) else None


def load_local_state(root: Path) -> dict:
    path = root / BUILD_STATE
    if not path.is_file():
        ver = (root / "package.json").read_text(encoding="utf-8") if (root / "package.json").is_file() else "{}"
        m = re.search(r'"version"\s*:\s*"([^"]+)"', ver)
        return {"version": m.group(1) if m else "0.0.0", "released_at": ""}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"version": "0.0.0", "released_at": ""}


def save_local_state(root: Path, version: str, released_at: str) -> None:
    (root / BUILD_STATE).write_text(
        json.dumps({"version": version, "released_at": released_at}, indent=2),
        encoding="utf-8",
    )


def is_update_available(root: Path, cfg: dict[str, str]) -> dict | None:
    api = cfg.get("updates_api", "").strip().rstrip("/")
    project = cfg.get("updates_project", "ip-cam-viewer").strip()
    token = cfg.get("updates_token", "").strip()
    if not api:
        return None

    url = f"{api}/project-updates/{project}/latest"
    status, body = _api_request(url, token, timeout=30)
    if status != 200:
        return None
    data = _parse_success(body)
    if not data or not data.get("version") or not data.get("download_url"):
        return None

    local = load_local_state(root)
    remote_v = str(data["version"])
    remote_at = str(data.get("released_at") or "")
    local_v = str(local.get("version") or "0.0.0")
    local_at = str(local.get("released_at") or "")

    if version_newer(remote_v, local_v):
        return data
    if remote_v == local_v and remote_at and remote_at > local_at:
        return data
    return None


def _should_skip(rel: str) -> bool:
    rel = rel.replace("\\", "/").lstrip("/")
    if rel in SKIP_FILES:
        return True
    for p in PRESERVE_PREFIXES:
        if rel.startswith(p):
            return True
    parts = rel.split("/")
    for part in parts:
        if part in SKIP_DIRS:
            return True
    return False


def _copy_tree(src: Path, dst: Path) -> None:
    for item in src.rglob("*"):
        rel = item.relative_to(src).as_posix()
        if item.is_dir():
            continue
        if _should_skip(rel):
            continue
        target = dst / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item, target)


def _run_build(root: Path, log: Callable[[str], None]) -> None:
    npm = shutil.which("npm") or "npm"
    node = shutil.which("node") or "node"
    patch = root / "scripts" / "patch-onvif-lib.js"
    if patch.is_file():
        log("[update] patch onvif…")
        subprocess.run([node, str(patch)], cwd=str(root), check=False)

    log("[update] npm install…")
    r = subprocess.run([npm, "install"], cwd=str(root), capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"npm install failed: {r.stderr or r.stdout}")

    log("[update] npm run build…")
    r = subprocess.run([npm, "run", "build"], cwd=str(root), capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"npm run build failed: {r.stderr or r.stdout}")

    go2rtc = root / "bin" / ("go2rtc.exe" if os.name == "nt" else "go2rtc")
    if not go2rtc.is_file():
        log("[update] go2rtc install…")
        subprocess.run([npm, "run", "go2rtc:install"], cwd=str(root), check=False)

    yolo = root / "server" / "models" / "yolov8n.pt"
    if not yolo.is_file():
        log("[update] ML models download…")
        subprocess.run([npm, "run", "models:download"], cwd=str(root), check=False)

    env = os.environ.copy()
    env["DATABASE_URL"] = "file:./server/data/app.db"
    srv = root / "server"
    if (srv / "prisma").is_dir():
        log("[update] prisma migrate…")
        subprocess.run(["npx", "prisma", "migrate", "deploy"], cwd=str(srv), env=env, check=False)


def download_release(url: str, token: str, dest: Path, log: Callable[[str], None]) -> None:
    log(f"[update] Downloading…")
    status, body = _api_request(url, token, timeout=600)
    if status != 200:
        raise RuntimeError(f"Download failed HTTP {status}")
    dest.write_bytes(body)
    log(f"[update] Saved {dest.name} ({len(body) // 1024} KB)")


def apply_release_zip(root: Path, zip_path: Path, log: Callable[[str], None]) -> None:
    log("[update] Extracting…")
    with tempfile.TemporaryDirectory(prefix="edge-update-") as tmp:
        tmp_path = Path(tmp)
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(tmp_path)

        # zip may have single top folder
        entries = [p for p in tmp_path.iterdir() if p.name not in ("__MACOSX",)]
        src = entries[0] if len(entries) == 1 and entries[0].is_dir() else tmp_path
        _copy_tree(src, root)


def relaunch_exe_if_updated(root: Path) -> bool:
    if not getattr(sys, "frozen", False):
        return False
    new_exe = root / "dist-launcher" / "CompanyEdgeLauncher.exe"
    if not new_exe.is_file():
        return False
    try:
        if new_exe.stat().st_mtime <= Path(sys.executable).stat().st_mtime:
            return False
    except OSError:
        return False
    subprocess.Popen(
        [str(new_exe)],
        cwd=str(root),
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
    )
    return True


def check_and_apply_updates(root: Path, log: Callable[[str], None]) -> bool:
    """Returns True if app should exit (relaunch scheduled)."""
    cfg = edge_config(root)
    if not cfg.get("auto_update", True):
        log("[update] Auto-update disabled (EDGE_AUTO_UPDATE=false)")
        return False

    api = cfg.get("updates_api", "").strip()
    if not api:
        log("[update] No EDGE_UPDATES_API — skip")
        return False

    release = is_update_available(root, cfg)
    if not release:
        local = load_local_state(root)
        log(f"[update] Up to date ({local.get('version', '?')})")
        return False

    version = str(release["version"])
    released_at = str(release.get("released_at") or datetime.utcnow().isoformat())
    download_url = str(release["download_url"])
    token = cfg.get("updates_token", "").strip()

    log(f"[update] New release {version} — applying…")
    if release.get("release_notes"):
        log(f"[update] Notes: {release['release_notes'][:200]}")

    zip_path = root / ".updates" / f"{version}.zip"
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    download_release(download_url, token, zip_path, log)
    apply_release_zip(root, zip_path, log)
    _run_build(root, log)
    save_local_state(root, version, released_at)
    log(f"[update] Installed {version} — rebuild done")

    try:
        zip_path.unlink(missing_ok=True)
    except OSError:
        pass

    if relaunch_exe_if_updated(root):
        log("[update] Relaunching updated EXE…")
        sys.exit(0)
    return False
