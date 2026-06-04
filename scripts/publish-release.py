#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Zip ip-cam-viewer (source-only release) and upload to api-stpreg project-releases API.

Excludes: node_modules, dist, ML models, go2rtc, launcher binaries.
Models and go2rtc are fetched on the edge via npm run models:download / go2rtc:install.

Usage:
  python scripts/publish-release.py --version 1.0.1 --api https://your-api.com/api/internal --token YOUR_TOKEN
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Exact paths under project root (posix).
INCLUDE_FILES = {
    "package.json",
    "package-lock.json",
    "VERSION",
    ".env.example",
    "PUBLISH-RELEASE.bat",
    "START-CAMERA-GUI.bat",
    "REBUILD-SERVER.bat",
    "OPTIMIZE-WINDOWS-EDGE.bat",
    "BUILD-LAUNCHER.bat",
    "INSTALL-COMPANY-GUI.md",
    "README.md",
    "client/index.html",
    "client/package.json",
    "client/vite.config.ts",
    "client/tsconfig.json",
    "server/package.json",
    "server/tsconfig.json",
}

# Directory prefixes — only source, config, prisma, edge scripts (no dist/models/build).
INCLUDE_PREFIXES = (
    "client/src/",
    "server/src/",
    "server/prisma/",
    "server/scripts/",
    "config/",
    "scripts/patch-onvif-lib.js",
    "scripts/publish-release.py",
    "scripts/release-and-publish.sh",
    "scripts/download-edge-models.mjs",
    "scripts/download_face_models.py",
    "scripts/install-go2rtc.mjs",
    "scripts/install-go2rtc.bat",
    "scripts/install-go2rtc.sh",
    "scripts/setup-windows.bat",
    "scripts/setup-face-python.bat",
    "scripts/setup-face-python.sh",
    "scripts/start-company-edge.bat",
    "scripts/install-company-edge-service.bat",
    "scripts/run-detect-faces.bat",
    "scripts/company-edge-gui/",
)

# Under scripts/company-edge-gui/ skip PyInstaller output.
SKIP_PREFIXES = (
    "scripts/company-edge-gui/build/",
)

SKIP_EXT = {".pyc", ".db", ".zip", ".tsbuildinfo"}


def should_add(path: Path) -> bool:
    rel = path.relative_to(ROOT).as_posix()
    if not rel or rel.startswith(".env"):
        return False
    for prefix in SKIP_PREFIXES:
        if rel.startswith(prefix):
            return False
    if path.suffix.lower() in SKIP_EXT:
        return False
    if rel in INCLUDE_FILES:
        return True
    for prefix in INCLUDE_PREFIXES:
        if rel.startswith(prefix):
            # GUI: source + config only
            if prefix == "scripts/company-edge-gui/":
                name = path.name
                if name.endswith((".py", ".bat", ".md", ".txt", ".spec")):
                    return True
                if name in ("requirements.txt", "requirements-build.txt"):
                    return True
                return False
            return True
    return False


def build_zip(out: Path) -> None:
    added = 0
    skipped = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in ROOT.rglob("*"):
            if not f.is_file():
                continue
            size = f.stat().st_size
            if not should_add(f):
                skipped += size
                continue
            zf.write(f, f.relative_to(ROOT).as_posix())
            added += size
    print(f"Created {out} ({out.stat().st_size // 1024} KB)")
    print(f"  included ~{added // 1024} KB source, skipped ~{skipped // 1024 // 1024} MB")


def upload(api_base: str, project: str, version: str, token: str, zip_path: Path, notes: str) -> None:
    api_base = api_base.rstrip("/")
    url = f"{api_base}/project-updates/{project}/upload"

    boundary = "----EdgeReleaseBoundary7MA4YWxk"
    body = bytearray()
    for name, val in (("version", version), ("release_notes", notes)):
        body.extend(f"--{boundary}\r\n".encode())
        body.extend(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        body.extend(f"{val}\r\n".encode())
    body.extend(f"--{boundary}\r\n".encode())
    body.extend(
        f'Content-Disposition: form-data; name="file"; filename="{version}.zip"\r\n'.encode()
    )
    body.extend(b"Content-Type: application/zip\r\n\r\n")
    body.extend(zip_path.read_bytes())
    body.extend(f"\r\n--{boundary}--\r\n".encode())

    req = urllib.request.Request(
        url,
        data=bytes(body),
        headers={
            "x-api-key": token,
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            doc = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(e.read().decode(), file=sys.stderr)
        sys.exit(1)

    if not doc.get("success"):
        print(doc, file=sys.stderr)
        sys.exit(1)
    print("Upload OK:", doc.get("data") or doc.get("message"))


def main() -> None:
    ap = argparse.ArgumentParser(description="Publish ip-cam-viewer release to API")
    ap.add_argument("--version", required=True, help="Semver e.g. 1.0.1")
    ap.add_argument("--api", default=os.environ.get("EDGE_UPDATES_API", ""), help="API base …/api/internal")
    ap.add_argument("--project", default="ip-cam-viewer")
    ap.add_argument("--token", default=os.environ.get("EDGE_UPDATES_TOKEN", ""))
    ap.add_argument("--notes", default="", help="Release notes")
    ap.add_argument("--zip-only", action="store_true", help="Build zip only, do not upload")
    args = ap.parse_args()

    if not args.zip_only and (not args.api or not args.token):
        print("Set --api and --token (or EDGE_UPDATES_API / EDGE_UPDATES_TOKEN)", file=sys.stderr)
        sys.exit(1)

    if not re.match(r"^\d+\.\d+\.\d+", args.version):
        print("Version should look like 1.0.1", file=sys.stderr)
        sys.exit(1)

    zip_path = ROOT / ".updates" / f"publish-{args.version}.zip"
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    build_zip(zip_path)
    if args.zip_only:
        print(f"Zip ready: {zip_path}")
        return
    upload(args.api.rstrip("/"), args.project, args.version, args.token, zip_path, args.notes)


if __name__ == "__main__":
    main()
