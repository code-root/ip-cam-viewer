import type { Bbox } from './face-tracker.js';

/** One torso box per face track (avoids duplicate YOLO + proxy boxes). */
export function bodyBoxFromFace(face: Bbox, frameWidth: number, frameHeight: number): Bbox {
  const cx = face.x + face.width / 2;
  const bodyW = Math.min(frameWidth, face.width * 2.4);
  const bodyH = Math.min(frameHeight - face.y, face.height * 4.2);
  return {
    x: Math.max(0, cx - bodyW / 2),
    y: Math.max(0, face.y - face.height * 0.25),
    width: bodyW,
    height: Math.min(bodyH, frameHeight - Math.max(0, face.y - face.height * 0.25)),
  };
}

export function bboxIou(a: Bbox, b: Bbox): number {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);
  if (ix2 <= ix1 || iy2 <= iy1) return 0;
  const inter = (ix2 - ix1) * (iy2 - iy1);
  const ua = a.width * a.height + b.width * b.height - inter;
  return inter / Math.max(ua, 1);
}
