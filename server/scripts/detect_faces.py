#!/usr/bin/env python3
"""
CCTV detection: YOLOv8 persons + MediaPipe (full-range) + CNN/HOG faces.
Faces are detected inside person crops first for alignment; persons without a face
in the upper body are dropped unless confidence is very high.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile

CACHE_DIR = os.environ.get("FACE_CACHE_DIR", os.path.join(tempfile.gettempdir(), "ip-cam-viewer-ai-cache"))
os.makedirs(CACHE_DIR, exist_ok=True)
os.environ.setdefault("MPLCONFIGDIR", os.path.join(CACHE_DIR, "matplotlib"))
os.environ.setdefault("XDG_CACHE_HOME", os.path.join(CACHE_DIR, "xdg"))
os.environ.setdefault("YOLO_CONFIG_DIR", os.path.join(CACHE_DIR, "ultralytics"))

try:
    import face_recognition
    import numpy as np
    from PIL import Image
except ImportError as e:
    print(json.dumps({"error": f"Missing packages: {e}. Run: bash scripts/setup-face-python.sh"}))
    sys.exit(1)

MAX_SIDE = int(os.environ.get("FACE_DETECT_MAX_SIDE", "1920"))
MIN_FACE_PX = int(os.environ.get("FACE_MIN_FACE_PX", "20"))
MIN_FACE_AREA = float(os.environ.get("FACE_MIN_AREA_FRAC", "0.0003"))
MAX_FACE_AREA = float(os.environ.get("FACE_MAX_AREA_FRAC", "0.35"))
MIN_PERSON_AREA = float(os.environ.get("FACE_MIN_PERSON_AREA_FRAC", "0.003"))
YOLO_CONF = float(os.environ.get("FACE_YOLO_CONF", "0.28"))
YOLO_IMGSZ = int(os.environ.get("FACE_YOLO_IMGSZ", "960"))
MP_CONF = float(os.environ.get("FACE_MEDIAPIPE_CONF", "0.28"))
CNN_IF_FEWER_FACES = int(os.environ.get("FACE_CNN_IF_FEWER_THAN", "2"))
PERSON_MIN_ASPECT = float(os.environ.get("FACE_PERSON_MIN_ASPECT", "0.65"))
PERSON_KEEP_NO_FACE_CONF = float(os.environ.get("FACE_PERSON_KEEP_NO_FACE_CONF", "0.5"))
PERSON_ENABLED = os.environ.get("FACE_PERSON_DETECT", "true").lower() != "false"
MP_DEFAULT = "false" if sys.platform == "darwin" else "true"
MP_ENABLED = os.environ.get("FACE_MEDIAPIPE_ENABLED", MP_DEFAULT).lower() != "false"

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.environ.get("FACE_MODELS_DIR", os.path.join(SCRIPT_DIR, "..", "models"))
YOLO_WEIGHTS = os.environ.get("FACE_YOLO_WEIGHTS", os.path.join(MODELS_DIR, "yolov8n.pt"))
MP_FACE_MODEL = os.environ.get(
    "FACE_MEDIAPIPE_MODEL",
    os.path.join(MODELS_DIR, "blaze_face_full_range.tflite"),
)
MP_MODEL_URL = os.environ.get(
    "FACE_MEDIAPIPE_MODEL_URL",
    "https://storage.googleapis.com/mediapipe-models/face_detector/"
    "blaze_face_full_range/float16/1/blaze_face_full_range.tflite",
)

_yolo = None
_mp_detector = None


def load_image(path: str) -> tuple[np.ndarray, int, int]:
    image = face_recognition.load_image_file(path)
    orig_h, orig_w = image.shape[:2]
    if max(orig_h, orig_w) > MAX_SIDE:
        scale = MAX_SIDE / max(orig_h, orig_w)
        image = np.array(
            Image.fromarray(image).resize(
                (int(orig_w * scale), int(orig_h * scale)), Image.Resampling.LANCZOS
            )
        )
    return image, orig_w, orig_h


def scale_bbox(x: float, y: float, w: float, h: float, img_w: int, img_h: int, orig_w: int, orig_h: int) -> dict:
    sx, sy = orig_w / img_w, orig_h / img_h
    return {"x": float(x * sx), "y": float(y * sy), "width": float(w * sx), "height": float(h * sy)}


def iou(a: tuple, b: tuple) -> float:
    at, ar, ab, al = a
    bt, br, bb, bl = b
    ix1, iy1 = max(al, bl), max(at, bt)
    ix2, iy2 = min(ar, br), min(ab, bb)
    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0
    inter = (ix2 - ix1) * (iy2 - iy1)
    ua = (ar - al) * (ab - at) + (br - bl) * (bb - bt) - inter
    return inter / max(ua, 1)


def nms_boxes(boxes: list[tuple], scores: list[float], thr: float = 0.45) -> list[int]:
    if not boxes:
        return []
    order = sorted(range(len(boxes)), key=lambda i: scores[i], reverse=True)
    keep: list[int] = []
    for i in order:
        if any(iou(boxes[i], boxes[j]) > thr for j in keep):
            continue
        keep.append(i)
    return keep


def loc_to_bbox_dict(top: int, right: int, bottom: int, left: int, img_w: int, img_h: int, orig_w: int, orig_h: int) -> dict:
    return scale_bbox(left, top, right - left, bottom - top, img_w, img_h, orig_w, orig_h)


def get_yolo():
    global _yolo
    if _yolo is not None:
        return _yolo
    from ultralytics import YOLO

    os.makedirs(MODELS_DIR, exist_ok=True)
    _yolo = YOLO(YOLO_WEIGHTS if os.path.isfile(YOLO_WEIGHTS) else "yolov8n.pt")
    return _yolo


def ensure_mp_model() -> str:
    os.makedirs(MODELS_DIR, exist_ok=True)
    if os.path.isfile(MP_FACE_MODEL):
        return MP_FACE_MODEL
    import urllib.request

    urllib.request.urlretrieve(MP_MODEL_URL, MP_FACE_MODEL)
    return MP_FACE_MODEL


def get_mp_detector():
    global _mp_detector
    if _mp_detector is not None:
        return _mp_detector
    from mediapipe.tasks import python as mp_tasks
    from mediapipe.tasks.python import vision

    options = vision.FaceDetectorOptions(
        base_options=mp_tasks.BaseOptions(model_asset_path=ensure_mp_model()),
        running_mode=vision.RunningMode.IMAGE,
        min_detection_confidence=MP_CONF,
    )
    _mp_detector = vision.FaceDetector.create_from_options(options)
    return _mp_detector


def yolo_person_boxes(image: np.ndarray) -> list[tuple[tuple, float]]:
    if not PERSON_ENABLED:
        return []
    img_h, img_w = image.shape[:2]
    try:
        results = get_yolo().predict(image, classes=[0], conf=YOLO_CONF, verbose=False, imgsz=YOLO_IMGSZ)
    except Exception:
        return []

    boxes, scores = [], []
    for r in results:
        if r.boxes is None:
            continue
        for box in r.boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            conf = float(box.conf[0])
            w, h = x2 - x1, y2 - y1
            if w < 36 or h < 70:
                continue
            if (w * h) / (img_w * img_h) < MIN_PERSON_AREA:
                continue
            if h / max(w, 1) < PERSON_MIN_ASPECT:
                continue
            boxes.append((int(y1), int(x2), int(y2), int(x1)))
            scores.append(conf)
    out = []
    for idx in nms_boxes(boxes, scores, 0.5):
        out.append((boxes[idx], scores[idx]))
    return out


def person_shape_ok(top: int, right: int, bottom: int, left: int) -> bool:
    w, h = right - left, bottom - top
    ratio = h / max(w, 1)
    return PERSON_MIN_ASPECT <= ratio <= 6.5


def mp_faces_in_image(rgb: np.ndarray) -> list[tuple[float, tuple]]:
    if not MP_ENABLED:
        return []
    try:
        import mediapipe as mp
    except ImportError:
        return []
    try:
        detector = get_mp_detector()
    except Exception:
        return []
    img_h, img_w = rgb.shape[:2]
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
    results = detector.detect(mp_image)
    out = []
    if not results.detections:
        return out
    for det in results.detections:
        score = float(det.categories[0].score) if det.categories else 0.0
        if score < MP_CONF:
            continue
        bb = det.bounding_box
        x, y = max(0, bb.origin_x), max(0, bb.origin_y)
        w = min(img_w - x, bb.width)
        h = min(img_h - y, bb.height)
        if w < MIN_FACE_PX or h < MIN_FACE_PX:
            continue
        if (w * h) / (img_w * img_h) < MIN_FACE_AREA:
            continue
        out.append((score, (int(y), int(x + w), int(y + h), int(x))))
    return out


def hog_cnn_faces(rgb: np.ndarray) -> list[tuple[float, tuple, str]]:
    img_h, img_w = rgb.shape[:2]
    found: list[tuple[float, tuple, str]] = []
    for ups in (0, 1):
        for loc in face_recognition.face_locations(rgb, model="hog", number_of_times_to_upsample=ups):
            t, r, b, l = loc
            w, h = r - l, b - t
            if w < MIN_FACE_PX or h < MIN_FACE_PX:
                continue
            if (w * h) / (img_w * img_h) < MIN_FACE_AREA:
                continue
            found.append((0.55, loc, "hog"))
    if len(found) < CNN_IF_FEWER_FACES:
        for loc in face_recognition.face_locations(rgb, model="cnn"):
            t, r, b, l = loc
            w, h = r - l, b - t
            if w >= MIN_FACE_PX and h >= MIN_FACE_PX:
                found.append((0.65, loc, "cnn"))
    return found


def merge_face_candidates(candidates: list[tuple[float, tuple, str]]) -> list[tuple[float, tuple, str]]:
    if not candidates:
        return []
    boxes = [c[1] for c in candidates]
    scores = [c[0] for c in candidates]
    return [candidates[i] for i in nms_boxes(boxes, scores, 0.4)]


def collect_faces_in_rgb(rgb: np.ndarray) -> list[tuple[float, tuple, str]]:
    candidates: list[tuple[float, tuple, str]] = []
    for score, loc in mp_faces_in_image(rgb):
        candidates.append((score, loc, "mediapipe"))
    candidates.extend(hog_cnn_faces(rgb))
    return merge_face_candidates(candidates)


def face_in_upper_person(face_loc: tuple, person_loc: tuple) -> bool:
    pt, pr, pb, pl = person_loc
    ft, fr, fb, fl = face_loc
    face_cy = (ft + fb) / 2
    person_mid_y = pt + (pb - pt) * 0.72
    horiz_ok = max(pl, fl - 20) <= min(pr, fr + 20)
    return horiz_ok and ft >= pt - 10 and face_cy <= person_mid_y


def encode_faces(rgb: np.ndarray, merged: list[tuple[float, tuple, str]]) -> list[tuple[float, tuple, str, np.ndarray]]:
    out = []
    for score, loc, source in merged:
        try:
            encs = face_recognition.face_encodings(rgb, [loc], num_jitters=1)
            if encs:
                out.append((score, loc, source, encs[0]))
        except Exception:
            continue
    return out


def detect(path: str) -> dict:
    image, orig_w, orig_h = load_image(path)
    img_h, img_w = image.shape[:2]
    sx, sy = img_w / orig_w, img_h / orig_h

    persons_out: list[dict] = []
    faces_out: list[dict] = []
    used_face_locs: list[tuple] = []

    for (top, right, bottom, left), conf in yolo_person_boxes(image):
        if not person_shape_ok(top, right, bottom, left):
            continue
        pad_x = int((right - left) * 0.06)
        pad_y = int((bottom - top) * 0.04)
        x0 = max(0, left - pad_x)
        y0 = max(0, top - pad_y)
        x1 = min(img_w, right + pad_x)
        y1 = min(img_h, bottom + pad_y)
        crop = image[y0:y1, x0:x1]
        if crop.size == 0:
            continue

        merged = collect_faces_in_rgb(crop)
        encoded = encode_faces(crop, merged)
        person_faces = []
        for score, loc, source, enc in encoded:
            t, r, b, l = loc
            gt, gr, gb, gl = t + y0, r + x0, b + y0, l + x0
            glob = (gt, gr, gb, gl)
            if not face_in_upper_person(glob, (top, right, bottom, left)):
                continue
            used_face_locs.append(glob)
            person_faces.append((score, glob, source, enc))

        if person_faces or conf >= PERSON_KEEP_NO_FACE_CONF:
            persons_out.append(
                {
                    "score": round(conf, 3),
                    "bbox": loc_to_bbox_dict(top, right, bottom, left, img_w, img_h, orig_w, orig_h),
                    "source": "yolo",
                }
            )
            for score, glob, source, enc in person_faces:
                gt, gr, gb, gl = glob
                faces_out.append(
                    {
                        "encoding": enc.tolist(),
                        "score": round(max(score, 0.5), 3),
                        "source": source,
                        "bbox": loc_to_bbox_dict(gt, gr, gb, gl, img_w, img_h, orig_w, orig_h),
                    }
                )

    # Global pass — catch people YOLO missed (e.g. partial / walking)
    global_merged = collect_faces_in_rgb(image)
    global_encoded = encode_faces(image, global_merged)
    for score, loc, source, enc in global_encoded:
        if any(iou(loc, used) > 0.35 for used in used_face_locs):
            continue
        t, r, b, l = loc
        faces_out.append(
            {
                "encoding": enc.tolist(),
                "score": round(max(score, 0.5), 3),
                "source": source,
                "bbox": loc_to_bbox_dict(t, r, b, l, img_w, img_h, orig_w, orig_h),
            }
        )
    # NMS on faces (YOLO crop + global can duplicate)
    if len(faces_out) > 1:
        flocs = []
        fscores = []
        for f in faces_out:
            b = f["bbox"]
            left, top = int(b["x"] * sx), int(b["y"] * sy)
            right = int((b["x"] + b["width"]) * sx)
            bottom = int((b["y"] + b["height"]) * sy)
            flocs.append((top, right, bottom, left))
            fscores.append(f["score"])
        keep = nms_boxes(flocs, fscores, 0.4)
        faces_out = [faces_out[i] for i in keep]

    if len(persons_out) > 1:
        boxes = []
        scores = []
        for p in persons_out:
            b = p["bbox"]
            left = int(b["x"] * sx)
            top = int(b["y"] * sy)
            right = int((b["x"] + b["width"]) * sx)
            bottom = int((b["y"] + b["height"]) * sy)
            boxes.append((top, right, bottom, left))
            scores.append(p["score"])
        keep = nms_boxes(boxes, scores, 0.5)
        persons_out = [persons_out[i] for i in keep]

    return {"faces": faces_out, "persons": persons_out, "imageWidth": orig_w, "imageHeight": orig_h}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: detect_faces.py <image_path>"}))
        sys.exit(1)
    try:
        print(json.dumps(detect(sys.argv[1])))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
