import { config } from '../config.js';
import {
  descriptorFromJson,
  descriptorToJson,
  euclideanDistance,
  matchFaceWithMargin,
  type KnownFace,
} from './service.js';

export interface Bbox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CameraTrack {
  trackId: string;
  trackNum: number;
  globalTrackId: string;
  globalTrackNum: number;
  descriptor: Float32Array;
  sampleCount: number;
  bbox: Bbox;
  frameWidth: number;
  frameHeight: number;
  employeeId?: string;
  profileId?: string;
  fullName?: string;
  hits: number;
  lastAt: number;
}

interface GlobalTrack {
  globalTrackId: string;
  globalTrackNum: number;
  descriptor: Float32Array;
  sampleCount: number;
  employeeId?: string;
  profileId?: string;
  fullName?: string;
  hits: number;
  cameraIds: Set<string>;
  lastCameraId: string;
  lastAt: number;
}

const tracksByCamera = new Map<string, Map<string, CameraTrack>>();
const trackNumByCamera = new Map<string, number>();
const globalTracks = new Map<string, GlobalTrack>();

let globalTrackSeq = 0;

const TRACK_TTL_MS = Math.max(config.faceTrackTtlSec * 1000, 30_000);
const GLOBAL_TRACK_TTL_MS = Math.max(config.faceGlobalTrackTtlSec * 1000, TRACK_TTL_MS);

function bboxIou(a: Bbox, b: Bbox): number {
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

function blendDescriptor(prev: Float32Array, next: Float32Array, sampleCount: number): Float32Array {
  const out = new Float32Array(prev.length);
  const weight = 1 / Math.max(sampleCount, 1);
  for (let i = 0; i < prev.length; i++) {
    out[i] = prev[i] * (1 - weight) + next[i] * weight;
  }
  return out;
}

function prune(cameraId: string) {
  const map = tracksByCamera.get(cameraId);
  if (map) {
    const localCutoff = Date.now() - TRACK_TTL_MS;
    for (const [id, t] of map) {
      if (t.lastAt < localCutoff) map.delete(id);
    }
  }

  const globalCutoff = Date.now() - GLOBAL_TRACK_TTL_MS;
  for (const [id, t] of globalTracks) {
    if (t.lastAt < globalCutoff) globalTracks.delete(id);
  }
}

function nextTrackNum(cameraId: string): number {
  const n = (trackNumByCamera.get(cameraId) ?? 0) + 1;
  trackNumByCamera.set(cameraId, n);
  return n;
}

function createGlobalTrack(
  cameraId: string,
  descriptor: Float32Array,
  slot: FaceMatchSlot | null,
  now: number
): GlobalTrack {
  const globalTrackNum = ++globalTrackSeq;
  const globalTrack: GlobalTrack = {
    globalTrackId: `person-${globalTrackNum}`,
    globalTrackNum,
    descriptor: new Float32Array(descriptor),
    sampleCount: 1,
    employeeId: slot?.employeeId,
    profileId: slot?.profileId,
    fullName: slot?.fullName,
    hits: 0,
    cameraIds: new Set([cameraId]),
    lastCameraId: cameraId,
    lastAt: now,
  };
  globalTracks.set(globalTrack.globalTrackId, globalTrack);
  return globalTrack;
}

function findGlobalByEmployee(employeeId: string, claimedGlobal: Set<string>): GlobalTrack | null {
  for (const track of globalTracks.values()) {
    if (claimedGlobal.has(track.globalTrackId)) continue;
    if (track.employeeId === employeeId) return track;
  }
  return null;
}

function findBestGlobalTrack(
  descriptor: Float32Array,
  slot: FaceMatchSlot | null,
  claimedGlobal: Set<string>
): GlobalTrack | null {
  let best: { track: GlobalTrack; distance: number; sameEmployee: boolean } | null = null;
  let secondDistance = Infinity;

  for (const track of globalTracks.values()) {
    if (claimedGlobal.has(track.globalTrackId)) continue;
    if (slot?.employeeId && track.employeeId && track.employeeId !== slot.employeeId) continue;

    const distance = euclideanDistance(descriptor, track.descriptor);
    const sameEmployee = Boolean(slot?.employeeId && track.employeeId === slot.employeeId);
    const threshold = sameEmployee
      ? config.faceMatchThresholdCctv
      : track.employeeId
        ? config.faceAutoEnrollMatchThreshold
        : config.faceGlobalTrackMatchThreshold;

    if (distance > threshold) continue;

    if (!best || distance < best.distance) {
      secondDistance = best?.distance ?? Infinity;
      best = { track, distance, sameEmployee };
    } else {
      secondDistance = Math.min(secondDistance, distance);
    }
  }

  if (!best) return null;
  if (best.sameEmployee) return best.track;
  if (secondDistance - best.distance < config.faceMatchMargin) return null;
  return best.track;
}

function updateGlobalTrack(
  cameraId: string,
  descriptor: Float32Array,
  slot: FaceMatchSlot | null,
  existingGlobalId: string | undefined,
  claimedGlobal: Set<string>
): GlobalTrack {
  const now = Date.now();
  let globalTrack =
    existingGlobalId && !claimedGlobal.has(existingGlobalId)
      ? globalTracks.get(existingGlobalId) ?? null
      : null;

  if (globalTrack && slot?.employeeId && globalTrack.employeeId && globalTrack.employeeId !== slot.employeeId) {
    globalTrack = null;
  }

  if (!globalTrack && slot?.employeeId) {
    globalTrack = findGlobalByEmployee(slot.employeeId, claimedGlobal);
  }

  if (!globalTrack) {
    globalTrack = findBestGlobalTrack(descriptor, slot, claimedGlobal);
  }

  if (!globalTrack) {
    globalTrack = createGlobalTrack(cameraId, descriptor, slot, now);
  } else {
    globalTrack.sampleCount += 1;
    globalTrack.descriptor = blendDescriptor(
      globalTrack.descriptor,
      descriptor,
      globalTrack.sampleCount
    );
  }

  if (slot) {
    globalTrack.employeeId = slot.employeeId;
    globalTrack.profileId = slot.profileId;
    globalTrack.fullName = slot.fullName;
  }

  globalTrack.hits += 1;
  globalTrack.cameraIds.add(cameraId);
  globalTrack.lastCameraId = cameraId;
  globalTrack.lastAt = now;
  claimedGlobal.add(globalTrack.globalTrackId);
  return globalTrack;
}

function canLinkLocalTrack(
  track: CameraTrack,
  descriptor: Float32Array,
  bbox: Bbox,
  slot: FaceMatchSlot | null
): { ok: boolean; score: number } {
  const distance = euclideanDistance(descriptor, track.descriptor);
  const iou = bboxIou(bbox, track.bbox);
  const sameEmployee = Boolean(slot?.employeeId && track.employeeId === slot.employeeId);
  const employeeConflict = Boolean(slot?.employeeId && track.employeeId && track.employeeId !== slot.employeeId);

  if (employeeConflict) return { ok: false, score: Infinity };

  const descriptorMatch = distance <= config.faceTrackMatchThreshold;
  const knownTrackGrace =
    Boolean(track.employeeId) && !slot && iou >= 0.16 && distance <= config.faceTrackHardMaxDistance;
  const sameEmployeeGrace = sameEmployee && distance <= config.faceTrackHardMaxDistance;
  const positionalMatch =
    iou >= 0.18 &&
    distance <= config.faceTrackHardMaxDistance &&
    (!track.employeeId || !slot || sameEmployee);

  if (!descriptorMatch && !knownTrackGrace && !sameEmployeeGrace && !positionalMatch) {
    return { ok: false, score: Infinity };
  }

  const score =
    distance * 0.7 +
    (1 - iou) * 0.22 -
    (sameEmployee ? 0.18 : 0) -
    (knownTrackGrace ? 0.05 : 0);

  return { ok: true, score };
}

export interface TrackedFace {
  trackId: string;
  trackLabel: string;
  trackNum: number;
  globalTrackId: string;
  globalTrackLabel: string;
  globalTrackNum: number;
  bbox: Bbox;
  descriptor: Float32Array;
  employeeId?: string;
  profileId?: string;
  employeeName?: string;
  isUnknown: boolean;
  hits: number;
  matchDistance?: number;
}

export interface FaceMatchSlot {
  employeeId: string;
  profileId: string;
  fullName: string;
  distance: number;
}

/**
 * Assign each detected face to at most one employee; each employee at most one face per frame.
 */
export function assignUniqueFaceMatches(
  descriptors: Float32Array[],
  known: KnownFace[]
): Map<number, FaceMatchSlot | null> {
  type Cand = FaceMatchSlot & { faceIdx: number };
  const cands: Cand[] = [];

  for (let faceIdx = 0; faceIdx < descriptors.length; faceIdx++) {
    const ranked: FaceMatchSlot[] = [];
    for (const k of known) {
      const distance = euclideanDistance(descriptors[faceIdx], k.descriptor);
      if (distance < config.faceMatchThresholdCctv) {
        ranked.push({
          employeeId: k.employeeId,
          profileId: k.profileId,
          fullName: k.fullName,
          distance,
        });
      }
    }
    ranked.sort((a, b) => a.distance - b.distance);
    if (!ranked.length) continue;
    if (ranked.length > 1 && ranked[1].distance - ranked[0].distance < config.faceMatchMargin) {
      continue;
    }
    cands.push({ faceIdx, ...ranked[0] });
  }

  cands.sort((a, b) => a.distance - b.distance);
  const result = new Map<number, FaceMatchSlot | null>();
  const usedFace = new Set<number>();
  const usedEmployee = new Set<string>();

  for (const c of cands) {
    if (usedFace.has(c.faceIdx) || usedEmployee.has(c.employeeId)) continue;
    result.set(c.faceIdx, {
      employeeId: c.employeeId,
      profileId: c.profileId,
      fullName: c.fullName,
      distance: c.distance,
    });
    usedFace.add(c.faceIdx);
    usedEmployee.add(c.employeeId);
  }

  for (let i = 0; i < descriptors.length; i++) {
    if (!result.has(i)) result.set(i, null);
  }
  return result;
}

/**
 * Stable tracks per camera, plus a global face fingerprint track shared by all cameras.
 */
export function updateFaceTracks(
  cameraId: string,
  faces: Array<{ descriptor: Float32Array; bbox: Bbox }>,
  frameWidth: number,
  frameHeight: number,
  matches: Map<number, FaceMatchSlot | null>
): TrackedFace[] {
  prune(cameraId);
  let map = tracksByCamera.get(cameraId);
  if (!map) {
    map = new Map();
    tracksByCamera.set(cameraId, map);
  }

  type Candidate = { faceIdx: number; track: CameraTrack; score: number };
  const candidates: Candidate[] = [];

  for (let faceIdx = 0; faceIdx < faces.length; faceIdx++) {
    const slot = matches.get(faceIdx) ?? null;
    for (const track of map.values()) {
      const candidate = canLinkLocalTrack(track, faces[faceIdx].descriptor, faces[faceIdx].bbox, slot);
      if (candidate.ok) candidates.push({ faceIdx, track, score: candidate.score });
    }
  }

  candidates.sort((a, b) => a.score - b.score);

  const assignmentByFace = new Map<number, CameraTrack>();
  const claimedLocal = new Set<string>();
  for (const candidate of candidates) {
    if (assignmentByFace.has(candidate.faceIdx) || claimedLocal.has(candidate.track.trackId)) continue;
    assignmentByFace.set(candidate.faceIdx, candidate.track);
    claimedLocal.add(candidate.track.trackId);
  }

  const now = Date.now();
  const claimedGlobal = new Set<string>();
  const out: TrackedFace[] = [];

  for (let faceIdx = 0; faceIdx < faces.length; faceIdx++) {
    const { descriptor, bbox } = faces[faceIdx];
    const slot = matches.get(faceIdx) ?? null;

    let track = assignmentByFace.get(faceIdx);
    if (track) {
      track.sampleCount += 1;
      track.descriptor = blendDescriptor(track.descriptor, descriptor, track.sampleCount);
      track.bbox = bbox;
      track.frameWidth = frameWidth;
      track.frameHeight = frameHeight;
      track.hits += 1;
      track.lastAt = now;
    } else {
      const num = nextTrackNum(cameraId);
      track = {
        trackId: `${cameraId.slice(0, 8)}-t${num}`,
        trackNum: num,
        globalTrackId: '',
        globalTrackNum: 0,
        descriptor: new Float32Array(descriptor),
        sampleCount: 1,
        bbox,
        frameWidth,
        frameHeight,
        hits: 1,
        lastAt: now,
      };
      map.set(track.trackId, track);
    }

    const globalTrack = updateGlobalTrack(
      cameraId,
      track.descriptor,
      slot,
      track.globalTrackId,
      claimedGlobal
    );

    track.globalTrackId = globalTrack.globalTrackId;
    track.globalTrackNum = globalTrack.globalTrackNum;

    if (slot) {
      track.employeeId = slot.employeeId;
      track.profileId = slot.profileId;
      track.fullName = slot.fullName;
    } else if (globalTrack.employeeId) {
      track.employeeId = globalTrack.employeeId;
      track.profileId = globalTrack.profileId;
      track.fullName = globalTrack.fullName;
    }

    const isUnknown = !track.employeeId;
    const fallbackLabel = `شخص #${globalTrack.globalTrackNum}`;
    const globalTrackLabel = globalTrack.fullName ?? fallbackLabel;
    const trackLabel = track.fullName ?? globalTrackLabel;

    out.push({
      trackId: track.trackId,
      trackLabel,
      trackNum: track.trackNum,
      globalTrackId: globalTrack.globalTrackId,
      globalTrackLabel,
      globalTrackNum: globalTrack.globalTrackNum,
      bbox,
      descriptor: track.descriptor,
      employeeId: track.employeeId,
      profileId: track.profileId,
      employeeName: track.fullName,
      isUnknown,
      hits: track.hits,
      matchDistance: slot?.distance,
    });
  }

  return out;
}

export function getTrackDescriptor(cameraId: string, trackId: string): Float32Array | null {
  return tracksByCamera.get(cameraId)?.get(trackId)?.descriptor ?? null;
}

export function linkTrackToEmployee(
  cameraId: string,
  trackId: string,
  employeeId: string,
  profileId: string,
  fullName: string
) {
  const track = tracksByCamera.get(cameraId)?.get(trackId);
  if (!track) return;
  track.employeeId = employeeId;
  track.profileId = profileId;
  track.fullName = fullName;

  const globalTrack = globalTracks.get(track.globalTrackId);
  if (!globalTrack) return;
  globalTrack.employeeId = employeeId;
  globalTrack.profileId = profileId;
  globalTrack.fullName = fullName;
}

export function fingerprintMatchesKnown(descriptor: Float32Array, known: KnownFace[]): FaceMatchSlot | null {
  return matchFaceWithMargin(descriptor, known, config.faceAutoEnrollMatchThreshold, config.faceMatchMargin);
}

export function serializeTrackDescriptor(descriptor: Float32Array): string {
  return descriptorToJson(descriptor);
}

export function deserializeTrackDescriptor(json: string): Float32Array {
  return descriptorFromJson(json);
}
