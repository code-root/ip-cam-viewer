#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Zip ip-cam-viewer and upload to api-stpreg project-releases API.

Usage:
  python scripts/publish-release.py --version 1.0.1 --api https://your-api.com/api/internal --token YOUR_TOKEN

Requires API token with update.server permission.
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
SKIP_DIRS = {
    "node_modules",
    ".git",
    ".venv",
    "data",
    "__pycache__",
    ".updates",
    "dist-launcher/build",
    "scripts/company-edge-gui/build",
}
SKIP_EXT = {".pyc", ".db", ".zip"}


def should_add(path: Path) -> bool:
    rel = path.relative_to(ROOT).as_posix()
    if rel.startswith(".env"):
        return False
    parts = rel.split("/")
    for p in parts:
        if p in SKIP_DIRS:
            return False
    if path.suffix.lower() in SKIP_EXT:
        return False
    return True


def build_zip(out: Path) -> None:
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in ROOT.rglob("*"):
            if not f.is_file() or not should_add(f):
                continue
            zf.write(f, f.relative_to(ROOT).as_posix())
    print(f"Created {out} ({out.stat().st_size // 1024} KB)")


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
