#!/usr/bin/env python3
"""
CCTV detection: YOLOv8 (person + scene objects) + MediaPipe + CNN/HOG faces.
Classifies chairs, TVs, laptops, etc. Filters faces on screens to reduce false "person" tags.
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
    print(json.dumps({"error": f"Missing packages: {e}. Run setup-face-python (see README for Windows/macOS)."}))
    sys.exit(1)

MAX_SIDE = int(os.environ.get("FACE_DETECT_MAX_SIDE", "1920"))
MIN_FACE_PX = int(os.environ.get("FACE_MIN_FACE_PX", "18"))
FACE_DETECT_UPSAMPLES = [
    int(x)
    for x in os.environ.get("FACE_DETECT_UPSAMPLES", "0,1,2").split(",")
    if x.strip().isdigit()
] or [0, 1, 2]
MIN_FACE_AREA = float(os.environ.get("FACE_MIN_AREA_FRAC", "0.0003"))
MAX_FACE_AREA = float(os.environ.get("FACE_MAX_AREA_FRAC", "0.35"))
MIN_PERSON_AREA = float(os.environ.get("FACE_MIN_PERSON_AREA_FRAC", "0.003"))
YOLO_CONF = float(os.environ.get("FACE_YOLO_CONF", "0.38"))
YOLO_IMGSZ = int(os.environ.get("FACE_YOLO_IMGSZ", "960"))
OBJECT_CONF = float(os.environ.get("FACE_OBJECT_CONF", "0.42"))
SCENE_OBJECTS_ENABLED = os.environ.get("FACE_SCENE_OBJECTS", "false").lower() == "true"
FURNITURE_FILTER = os.environ.get("FACE_FURNITURE_FILTER", "true").lower() != "false"
MP_CONF = float(os.environ.get("FACE_MEDIAPIPE_CONF", "0.28"))
CNN_IF_FEWER_FACES = int(os.environ.get("FACE_CNN_IF_FEWER_THAN", "2"))
PERSON_MIN_ASPECT = float(os.environ.get("FACE_PERSON_MIN_ASPECT", "0.65"))
PERSON_KEEP_NO_FACE_CONF = float(os.environ.get("FACE_PERSON_KEEP_NO_FACE_CONF", "0.72"))
PERSON_MAX_WIDTH_RATIO = float(os.environ.get("FACE_PERSON_MAX_WIDTH_RATIO", "0.55"))
PERSON_ENABLED = os.environ.get("FACE_PERSON_DETECT", "true").lower() != "false"
MP_ENABLED = os.environ.get("FACE_MEDIAPIPE_ENABLED", "true").lower() != "false"
CHAIR_MAX_ASPECT = float(os.environ.get("FACE_CHAIR_MAX_ASPECT", "0.78"))
OBJECT_MERGE_IOU = float(os.environ.get("FACE_OBJECT_MERGE_IOU", "0.45"))
FURNITURE_IOU_MIN = float(os.environ.get("FACE_FURNITURE_IOU", "0.12"))
PERSON_FURNITURE_IOU = float(os.environ.get("FACE_PERSON_FURNITURE_IOU", "0.28"))
FACE_PERSON_IOU_MIN = float(os.environ.get("FACE_PERSON_IOU", "0.08"))
FACE_MIN_ASPECT = float(os.environ.get("FACE_MIN_ASPECT", "0.62"))
FACE_MAX_ASPECT = float(os.environ.get("FACE_MAX_ASPECT", "1.45"))
GLOBAL_HOG_MIN_SCORE = float(os.environ.get("FACE_GLOBAL_HOG_MIN", "0.58"))
GLOBAL_MP_MIN_SCORE = float(os.environ.get("FACE_GLOBAL_MP_MIN", "0.45"))
FURNITURE_CLASSES = frozenset({"chair", "couch", "dining_table"})
YOLO_FILTER_CLASS_IDS = (0, 56, 57, 60)

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

# COCO classes we show on the live overlay (person handled via face pipeline).
SCENE_CLASS_IDS: dict[int, str] = {
    0: "person",
    56: "chair",
    57: "couch",
    60: "dining_table",
    62: "tv",
    63: "laptop",
    67: "cell_phone",
    73: "book",
}
SCREEN_OBJECT_CLASSES = frozenset({"tv", "laptop", "cell_phone", "keyboard", "mouse"})

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


def yolo_scene_detections(
    image: np.ndarray,
) -> tuple[list[tuple[tuple, float]], list[dict], list[dict]]:
    """Returns (person_boxes, display_objects, furniture_for_filter) from one YOLO pass."""
    persons: list[tuple[tuple, float]] = []
    objects: list[dict] = []
    furniture: list[dict] = []
    if not PERSON_ENABLED and not SCENE_OBJECTS_ENABLED and not FURNITURE_FILTER:
        return persons, objects, furniture

    img_h, img_w = image.shape[:2]
    class_ids = sorted(
        set(
            (list(SCENE_CLASS_IDS.keys()) if SCENE_OBJECTS_ENABLED else [])
            + ([0] if PERSON_ENABLED else [])
            + (list(YOLO_FILTER_CLASS_IDS[1:]) if FURNITURE_FILTER else [])
        )
    )
    if not class_ids:
        return persons, objects, furniture
    try:
        results = get_yolo().predict(
            image,
            classes=class_ids,
            conf=min(YOLO_CONF, OBJECT_CONF) * 0.85,
            verbose=False,
            imgsz=YOLO_IMGSZ,
        )
    except Exception:
        return persons, objects, furniture

    person_boxes, person_scores = [], []
    obj_boxes: list[tuple] = []
    obj_scores: list[float] = []
    obj_meta: list[dict] = []
    furn_boxes: list[tuple] = []
    furn_scores: list[float] = []
    furn_meta: list[dict] = []

    for r in results:
        if r.boxes is None:
            continue
        for box in r.boxes:
            cls_id = int(box.cls[0])
            label = SCENE_CLASS_IDS.get(cls_id)
            if not label:
                continue
            conf = float(box.conf[0])
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            w, h = x2 - x1, y2 - y1
            loc = (int(y1), int(x2), int(y2), int(x1))

            if label == "person":
                if not PERSON_ENABLED or conf < YOLO_CONF:
                    continue
                if w < 36 or h < 70:
                    continue
                if (w * h) / (img_w * img_h) < MIN_PERSON_AREA:
                    continue
                if h / max(w, 1) < PERSON_MIN_ASPECT:
                    continue
                if w / max(img_w, 1) > PERSON_MAX_WIDTH_RATIO:
                    continue
                person_boxes.append(loc)
                person_scores.append(conf)
            elif label in FURNITURE_CLASSES and FURNITURE_FILTER:
                furn_conf = min(OBJECT_CONF, YOLO_CONF) * 0.82
                if conf < furn_conf:
                    continue
                refined = refine_object_class(label, loc)
                furn_boxes.append(loc)
                furn_scores.append(conf)
                furn_meta.append({"class": refined, "classId": cls_id, "score": round(conf, 3)})
            else:
                if not SCENE_OBJECTS_ENABLED or conf < OBJECT_CONF:
                    continue
                if (w * h) / (img_w * img_h) < 0.001:
                    continue
                obj_boxes.append(loc)
                obj_scores.append(conf)
                obj_meta.append({"class": label, "classId": cls_id, "score": round(conf, 3)})

    for idx in nms_boxes(person_boxes, person_scores, 0.5):
        persons.append((person_boxes[idx], person_scores[idx]))

    for idx in nms_boxes(furn_boxes, furn_scores, 0.45):
        meta = furn_meta[idx]
        meta["loc"] = furn_boxes[idx]
        furniture.append(meta)

    for idx in nms_boxes(obj_boxes, obj_scores, 0.45):
        meta = obj_meta[idx]
        meta["loc"] = obj_boxes[idx]
        objects.append(meta)

    return persons, objects, furniture


def face_on_screen_object(face_bbox: dict, scene_objects: list[dict]) -> bool:
    cx = face_bbox["x"] + face_bbox["width"] / 2
    cy = face_bbox["y"] + face_bbox["height"] / 2
    for obj in scene_objects:
        if obj.get("class") not in SCREEN_OBJECT_CLASSES:
            continue
        b = obj["bbox"]
        if b["x"] <= cx <= b["x"] + b["width"] and b["y"] <= cy <= b["y"] + b["height"]:
            return True
    return False


def person_overlaps_screen_object(person_loc: tuple, scene_objects: list[dict]) -> bool:
    for obj in scene_objects:
        if obj.get("class") not in SCREEN_OBJECT_CLASSES:
            continue
        if iou(person_loc, obj["loc"]) > 0.2:
            return True
    return False


def person_overlaps_furniture(person_loc: tuple, furniture: list[dict]) -> bool:
    best = 0.0
    for item in furniture:
        best = max(best, iou(person_loc, item["loc"]))
    return best >= PERSON_FURNITURE_IOU


def face_loc_on_furniture(face_loc: tuple, furniture: list[dict]) -> bool:
    if not furniture:
        return False
    ft, fr, fb, fl = face_loc
    cx, cy = (fl + fr) / 2, (ft + fb) / 2
    for item in furniture:
        top, right, bottom, left = item["loc"]
        pad_x = int((right - left) * 0.1)
        pad_y = int((bottom - top) * 0.1)
        if (
            left - pad_x <= cx <= right + pad_x
            and top - pad_y <= cy <= bottom + pad_y
        ):
            return True
        if iou(face_loc, item["loc"]) > FURNITURE_IOU_MIN:
            return True
    return False


def face_overlaps_person_box(face_loc: tuple, person_boxes: list[tuple[tuple, float]]) -> bool:
    if not person_boxes:
        return False
    for loc, _ in person_boxes:
        if iou(face_loc, loc) > FACE_PERSON_IOU_MIN:
            return True
    return False


def face_shape_ok(face_loc: tuple) -> bool:
    ft, fr, fb, fl = face_loc
    w, h = fr - fl, fb - ft
    if w < MIN_FACE_PX or h < MIN_FACE_PX:
        return False
    aspect = h / max(w, 1)
    return FACE_MIN_ASPECT <= aspect <= FACE_MAX_ASPECT


def accept_global_face(
    score: float,
    loc: tuple,
    source: str,
    person_boxes: list[tuple[tuple, float]],
    furniture: list[dict],
) -> bool:
    if face_loc_on_furniture(loc, furniture):
        return False
    if not face_shape_ok(loc):
        return False
    if person_boxes:
        if not face_overlaps_person_box(loc, person_boxes):
            return False
        if source == "hog" and score < GLOBAL_HOG_MIN_SCORE:
            return False
        return True
    # No YOLO person in frame — reject HOG/CNN texture false positives (bean bags, posters).
    if source != "mediapipe" or score < GLOBAL_MP_MIN_SCORE:
        return False
    return True


def refine_object_class(label: str, loc: tuple) -> str:
    """Wide flat boxes labeled chair → couch (bean bags, lounge seats)."""
    top, right, bottom, left = loc
    w, h = right - left, bottom - top
    aspect = h / max(w, 1)
    if label == "chair" and aspect < CHAIR_MAX_ASPECT:
        return "couch"
    return label


def merge_overlapping_objects(objects: list[dict]) -> list[dict]:
    """One label per monitor cluster (tv beats laptop when both fire)."""
    screen_priority = {"tv": 3, "laptop": 2, "cell_phone": 1}
    screen_classes = set(screen_priority.keys())
    used: set[int] = set()
    out: list[dict] = []

    for i, a in enumerate(objects):
        if i in used:
            continue
        if a["class"] not in screen_classes:
            out.append(a)
            continue
        cluster = [a]
        used.add(i)
        for j, b in enumerate(objects):
            if j in used or b["class"] not in screen_classes:
                continue
            ba, bb = a["bbox"], b["bbox"]
            al = (int(ba["y"]), int(ba["x"] + ba["width"]), int(ba["y"] + ba["height"]), int(ba["x"]))
            bl = (int(bb["y"]), int(bb["x"] + bb["width"]), int(bb["y"] + bb["height"]), int(bb["x"]))
            if iou(al, bl) >= OBJECT_MERGE_IOU:
                cluster.append(b)
                used.add(j)
        best = max(cluster, key=lambda o: (screen_priority.get(o["class"], 0), o["score"]))
        out.append(best)
    return out


def person_shape_ok(top: int, right: int, bottom: int, left: int) -> bool:
    w, h = right - left, bottom - top
    ratio = h / max(w, 1)
    if ratio < PERSON_MIN_ASPECT or ratio > 6.5:
        return False
    # Wide flat boxes are often bean bags / lounge seats mis-tagged as person.
    if ratio < 1.08 and w >= 72:
        return False
    return True


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
    for ups in FACE_DETECT_UPSAMPLES:
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
    person_mid_y = pt + (pb - pt) * 0.78
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

    person_boxes, scene_raw, furniture_raw = yolo_scene_detections(image)
    objects_out: list[dict] = []
    for obj in scene_raw:
        top, right, bottom, left = obj["loc"]
        label = refine_object_class(obj["class"], obj["loc"])
        objects_out.append(
            {
                "class": label,
                "classId": obj["classId"],
                "score": obj["score"],
                "bbox": loc_to_bbox_dict(top, right, bottom, left, img_w, img_h, orig_w, orig_h),
            }
        )
    objects_out = merge_overlapping_objects(objects_out)

    for (top, right, bottom, left), conf in person_boxes:
        if not person_shape_ok(top, right, bottom, left):
            continue
        if person_overlaps_furniture((top, right, bottom, left), furniture_raw):
            continue
        if person_overlaps_screen_object((top, right, bottom, left), scene_raw):
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

        if person_faces:
            persons_out.append(
                {
                    "score": round(conf, 3),
                    "bbox": loc_to_bbox_dict(top, right, bottom, left, img_w, img_h, orig_w, orig_h),
                    "source": "yolo",
                }
            )
            for score, glob, source, enc in person_faces:
                gt, gr, gb, gl = glob
                fbbox = loc_to_bbox_dict(gt, gr, gb, gl, img_w, img_h, orig_w, orig_h)
                if face_on_screen_object(fbbox, objects_out):
                    continue
                if face_loc_on_furniture(glob, furniture_raw):
                    continue
                if not face_shape_ok(glob):
                    continue
                faces_out.append(
                    {
                        "encoding": enc.tolist(),
                        "score": round(max(score, 0.5), 3),
                        "source": source,
                        "bbox": fbbox,
                    }
                )

    # Extra pass inside each YOLO person crop (profile / small faces at desks)
    if not faces_out and person_boxes:
        for (top, right, bottom, left), _conf in person_boxes:
            pad_x = int((right - left) * 0.08)
            pad_y = int((bottom - top) * 0.06)
            crop = image[
                max(0, top - pad_y) : min(img_h, bottom + pad_y),
                max(0, left - pad_x) : min(img_w, right + pad_x),
            ]
            if crop.size == 0:
                continue
            for score, loc, source, enc in encode_faces(crop, collect_faces_in_rgb(crop)):
                t, r, b, l = loc
                gt, gr, gb, gl = t + max(0, top - pad_y), r + max(0, left - pad_x), b + max(0, top - pad_y), l + max(0, left - pad_x)
                glob = (gt, gr, gb, gl)
                if any(iou(glob, u) > 0.35 for u in used_face_locs):
                    continue
                fbbox = loc_to_bbox_dict(gt, gr, gb, gl, img_w, img_h, orig_w, orig_h)
                if face_on_screen_object(fbbox, objects_out):
                    continue
                if face_loc_on_furniture(glob, furniture_raw):
                    continue
                if not face_shape_ok(glob):
                    continue
                used_face_locs.append(glob)
                faces_out.append(
                    {
                        "encoding": enc.tolist(),
                        "score": round(max(score, 0.5), 3),
                        "source": source,
                        "bbox": fbbox,
                    }
                )

    # Global pass — catch people YOLO missed (e.g. partial / walking); skip furniture texture.
    global_merged = collect_faces_in_rgb(image)
    global_encoded = encode_faces(image, global_merged)
    for score, loc, source, enc in global_encoded:
        if any(iou(loc, used) > 0.35 for used in used_face_locs):
            continue
        if not accept_global_face(score, loc, source, person_boxes, furniture_raw):
            continue
        t, r, b, l = loc
        fbbox = loc_to_bbox_dict(t, r, b, l, img_w, img_h, orig_w, orig_h)
        if face_on_screen_object(fbbox, objects_out):
            continue
        faces_out.append(
            {
                "encoding": enc.tolist(),
                "score": round(max(score, 0.5), 3),
                "source": source,
                "bbox": fbbox,
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

    return {
        "faces": faces_out,
        "persons": persons_out,
        "objects": objects_out,
        "imageWidth": orig_w,
        "imageHeight": orig_h,
    }


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
