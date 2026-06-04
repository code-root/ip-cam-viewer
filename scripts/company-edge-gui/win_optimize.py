#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Windows-only: Defender exclusions, optional RT disable, stop heavy background apps.
Requires Administrator for full effect — run START-CAMERA-GUI.bat as Admin once.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import Callable

from edge_agent import edge_config, load_env_file


def is_windows() -> bool:
    return sys.platform == "win32"


def is_admin() -> bool:
    if not is_windows():
        return False
    try:
        import ctypes

        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def _run_ps(script: str, log: Callable[[str], None]) -> bool:
    cmd = [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
    ]
    try:
        r = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=120,
            creationflags=subprocess.CREATE_NO_WINDOW if is_windows() else 0,
        )
        if r.returncode != 0:
            err = (r.stderr or r.stdout or "").strip()
            if err:
                log(f"[windows] {err[:400]}")
            return False
        out = (r.stdout or "").strip()
        if out:
            log(f"[windows] {out[:300]}")
        return True
    except Exception as exc:
        log(f"[windows] PowerShell failed: {exc}")
        return False


def _defender_exclusions(root: Path, log: Callable[[str], None]) -> None:
    paths = [
        str(root.resolve()),
        str((root / "bin").resolve()),
        str((root / "node_modules").resolve()),
        str((root / "data").resolve()),
        str((root / ".venv").resolve()),
    ]
    for name in ("node.exe", "go2rtc.exe", "python.exe", "ffmpeg.exe"):
        found = _which(name)
        if found:
            paths.append(found)

    arr = []
    for p in paths:
        if p and (Path(p).exists() or p.endswith(".exe")):
            arr.append(f"'{p.replace(chr(39), chr(39) * 2)}'")
    if not arr:
        return
    ps = (
        "$paths = @(" + ",".join(arr) + "); "
        "foreach ($p in $paths) { "
        "  try { Add-MpPreference -ExclusionPath $p -ErrorAction Stop } catch {} "
        "  try { Add-MpPreference -ExclusionProcess (Split-Path $p -Leaf) -ErrorAction SilentlyContinue } catch {} "
        "}; "
        "Write-Output ('Defender exclusions: ' + $paths.Count)"
    )
    if _run_ps(ps, log):
        log("[windows] Defender exclusions added for project + node/go2rtc/ffmpeg")


def _which(exe: str) -> str | None:
    import shutil

    return shutil.which(exe)


def _disable_defender_realtime(log: Callable[[str], None]) -> None:
    ps = (
        "Set-MpPreference -DisableRealtimeMonitoring $true -ErrorAction Stop; "
        "Set-MpPreference -DisableBehaviorMonitoring $true -ErrorAction SilentlyContinue; "
        "Set-MpPreference -DisableIOAVProtection $true -ErrorAction SilentlyContinue; "
        "Write-Output 'Windows Defender real-time protection: OFF (until reboot or policy resets)'"
    )
    if _run_ps(ps, log):
        log("[windows] Defender real-time monitoring disabled")
    else:
        log("[windows] Could not disable Defender — run as Administrator")


def _stop_security_ui(log: Callable[[str], None]) -> None:
    """Stop SecurityHealthSystray (tray) — Defender service may still run until Set-MpPreference."""
    for img in ("SecurityHealthSystray.exe", "SecHealthUI.exe"):
        subprocess.run(
            ["taskkill", "/F", "/IM", img],
            capture_output=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    log("[windows] Stopped Windows Security tray/UI processes (if they were running)")


def _stop_processes(names: list[str], log: Callable[[str], None]) -> None:
    blocked = {
        "csrss.exe",
        "lsass.exe",
        "services.exe",
        "smss.exe",
        "wininit.exe",
        "winlogon.exe",
        "explorer.exe",
        "svchost.exe",
        "dwm.exe",
        "node.exe",
        "go2rtc.exe",
        "python.exe",
        "ffmpeg.exe",
        "msmpeng.exe",
        "system",
    }
    stopped = 0
    for name in names:
        n = name.strip().lower()
        if not n:
            continue
        base = n if n.endswith(".exe") else f"{n}.exe"
        if base in blocked:
            log(f"[windows] Skip protected process: {base}")
            continue
        r = subprocess.run(
            ["taskkill", "/F", "/IM", base],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        if r.returncode == 0:
            stopped += 1
            log(f"[windows] Stopped {base}")
    if stopped:
        log(f"[windows] Stopped {stopped} background process(es)")


def _default_stop_list() -> list[str]:
    return [
        "OneDrive",
        "MicrosoftTeams",
        "ms-teams",
        "SkypeApp",
        "YourPhoneAppProxy",
        "GameBar",
        "SearchHost",
        "Widgets",
        "PhoneExperienceHost",
    ]


def apply_windows_optimizations(root: Path, log: Callable[[str], None]) -> None:
    if not is_windows():
        return

    env = {**load_env_file(root / ".env"), **os.environ}
    if env.get("EDGE_WINDOWS_OPTIMIZE", "true").lower() not in ("1", "true", "yes"):
        log("[windows] Optimization skipped (EDGE_WINDOWS_OPTIMIZE=false)")
        return

    log("[windows] Applying startup optimizations…")
    if not is_admin():
        log("[windows] WARNING: Not running as Administrator — right-click → Run as administrator for full effect")

    _defender_exclusions(root, log)

    if env.get("EDGE_DISABLE_DEFENDER", "true").lower() in ("1", "true", "yes"):
        if is_admin():
            _disable_defender_realtime(log)
            _stop_security_ui(log)
        else:
            log("[windows] Skip Defender OFF — need Administrator (right-click Run as administrator)")

    raw = env.get("EDGE_STOP_PROCESSES", "").strip()
    names = [x.strip() for x in raw.replace(";", ",").split(",") if x.strip()] if raw else _default_stop_list()
    _stop_processes(names, log)

    log("[windows] Optimization pass done")
