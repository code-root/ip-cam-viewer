import { config } from '../config.js';

interface Track {
  employeeId: string;
  fullName: string;
  hits: number;
  lastAt: number;
  bbox: { x: number; y: number; width: number; height: number };
  frameWidth: number;
  frameHeight: number;
  confidence: number;
}

const tracksByCamera = new Map<string, Map<string, Track>>();

function cellKey(
  bbox: { x: number; y: number; width: number; height: number },
  frameWidth: number,
  frameHeight: number
): string {
  const cx = (bbox.x + bbox.width / 2) / frameWidth;
  const cy = (bbox.y + bbox.height / 2) / frameHeight;
  return `${Math.round(cx * 12)}_${Math.round(cy * 12)}`;
}

const TRACK_TTL_MS = Math.max(config.faceScanIntervalSec * 3000, 45_000);

function prune(cameraId: string) {
  const map = tracksByCamera.get(cameraId);
  if (!map) return;
  const cutoff = Date.now() - TRACK_TTL_MS;
  for (const [k, t] of map) {
    if (t.lastAt < cutoff) map.delete(k);
  }
}

export function confirmLiveDetection(
  cameraId: string,
  employeeId: string,
  fullName: string,
  bbox: { x: number; y: number; width: number; height: number },
  frameWidth: number,
  frameHeight: number,
  confidence: number
): boolean {
  prune(cameraId);
  let map = tracksByCamera.get(cameraId);
  if (!map) {
    map = new Map();
    tracksByCamera.set(cameraId, map);
  }

  const key = `${employeeId}:${cellKey(bbox, frameWidth, frameHeight)}`;
  const now = Date.now();
  const prev = map.get(key);

  if (prev && prev.employeeId === employeeId) {
    prev.hits += 1;
    prev.lastAt = now;
    prev.bbox = bbox;
    prev.confidence = Math.max(prev.confidence, confidence);
    prev.frameWidth = frameWidth;
    prev.frameHeight = frameHeight;
    return prev.hits >= config.faceConfirmScans;
  }

  map.set(key, {
    employeeId,
    fullName,
    hits: 1,
    lastAt: now,
    bbox,
    frameWidth,
    frameHeight,
    confidence,
  });
  return false;
}

export function confirmUnknownDetection(
  cameraId: string,
  bbox: { x: number; y: number; width: number; height: number },
  frameWidth: number,
  frameHeight: number
): boolean {
  const key = `unknown:${cellKey(bbox, frameWidth, frameHeight)}`;
  prune(cameraId);
  let map = tracksByCamera.get(cameraId);
  if (!map) {
    map = new Map();
    tracksByCamera.set(cameraId, map);
  }
  const now = Date.now();
  const prev = map.get(key);
  if (prev) {
    prev.hits += 1;
    prev.lastAt = now;
    return prev.hits >= Math.max(config.faceConfirmScans, 3);
  }
  map.set(key, {
    employeeId: '',
    fullName: '',
    hits: 1,
    lastAt: now,
    bbox,
    frameWidth,
    frameHeight,
    confidence: 0,
  });
  return false;
}
