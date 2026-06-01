#!/usr/bin/env python3
"""Download MediaPipe + YOLO weights into server/models (used by setup scripts)."""
from __future__ import annotations

import os
import shutil
import sys
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MODELS = os.path.join(ROOT, "server", "models")
MP_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_detector/"
    "blaze_face_full_range/float16/1/blaze_face_full_range.tflite"
)
MP_DST = os.path.join(MODELS, "blaze_face_full_range.tflite")
YOLO_DST = os.path.join(MODELS, "yolov8n.pt")


def main() -> int:
    os.makedirs(MODELS, exist_ok=True)

    if os.path.isfile(MP_DST):
        print("Already have", MP_DST)
    else:
        print("Downloading MediaPipe face model...")
        urllib.request.urlretrieve(MP_URL, MP_DST)
        print("Saved", MP_DST)

    if os.path.isfile(YOLO_DST):
        print("Already have", YOLO_DST)
    else:
        from ultralytics import YOLO

        print("Downloading YOLOv8n weights...")
        m = YOLO("yolov8n.pt")
        src = getattr(m, "ckpt_path", None) or ""
        if src and os.path.isfile(src):
            shutil.copy2(src, YOLO_DST)
            print("Saved", YOLO_DST)
        else:
            print("YOLO ready (cached by ultralytics)")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        print("Error:", e, file=sys.stderr)
        raise SystemExit(1)
