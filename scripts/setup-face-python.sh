#!/usr/bin/env bash
# Strong detection stack: face_recognition + MediaPipe + YOLOv8
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -z "${PYTHON:-}" ]; then
  for candidate in python3.12 python3.11 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
      PYTHON="$candidate"
      break
    fi
  done
fi
if [ -z "${PYTHON:-}" ] || ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "python3 not found" >&2
  exit 1
fi

echo "Creating venv at $ROOT/.venv (using $PYTHON) ..."
"$PYTHON" -m venv .venv
.venv/bin/pip install --upgrade pip 'setuptools<81'
.venv/bin/pip install \
  face_recognition pillow numpy opencv-python-headless \
  mediapipe ultralytics

echo ""
echo "Downloading MediaPipe face model..."
mkdir -p "$ROOT/server/models"
MP_MODEL="$ROOT/server/models/blaze_face_full_range.tflite"
if [ ! -f "$MP_MODEL" ]; then
  curl -fsSL -o "$MP_MODEL" \
    "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/1/blaze_face_full_range.tflite"
  echo "Saved $MP_MODEL"
else
  echo "Already have $MP_MODEL"
fi

echo ""
echo "Downloading YOLOv8n weights (one-time)..."
mkdir -p "$ROOT/server/models"
.venv/bin/python -c "
from ultralytics import YOLO
import os, shutil
dst = os.path.join('$ROOT/server/models/yolov8n.pt')
if not os.path.isfile(dst):
    m = YOLO('yolov8n.pt')
    src = getattr(m, 'ckpt_path', None) or ''
    if src and os.path.isfile(src):
        shutil.copy2(src, dst)
        print('Saved', dst)
    else:
        print('YOLO ready (cached by ultralytics)')
else:
    print('Already have', dst)
"

echo ""
echo "Verifying imports..."
.venv/bin/python -c "
import face_recognition, mediapipe, cv2
from ultralytics import YOLO
print('face_recognition OK')
print('mediapipe OK')
print('ultralytics OK')
"

echo ""
echo "Done. Add to .env:"
echo "  PYTHON_BIN=./.venv/bin/python3"
echo "  FACE_PERSON_DETECT=true"
echo "Restart: npm run dev"
