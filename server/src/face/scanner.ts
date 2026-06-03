import path from 'path';
import type { Camera } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';
import { faceSetupCommand } from '../lib/platform.js';
import * as onvif from '../onvif/service.js';
import { registerStream, fetchGo2rtcFrame } from '../streams/go2rtc.js';
import {
  loadFaceModels,
  detectAndMatchAll,
  cropFaceSnapshot,
  descriptorFromJson,
  matchConfidence,
  isFaceRecognitionAvailable,
  getFaceLoadError,
  type KnownFace,
} from './service.js';
import { emitToAll } from '../ws/hub.js';
import { dispatchEvent } from '../routes/notifications.js';
import { autoEnrollFromTrack } from './auto-enroll.js';
import { confirmLiveDetection } from './confirm.js';
import {
  getGlobalTrackMeta,
  initGlobalFaceTracksFromDb,
  setCrossCameraHandler,
  updateFaceTracks,
} from './face-tracker.js';
import { sceneObjectsEnabled } from './analysis-settings.js';
import { emitLiveClear, emitLiveFrame, setScanStatus } from './scanner-status.js';

const lastSeenByEmployee = new Map<string, { cameraId: string; logId: string; at: number }>();
const lastEventByKey = new Map<string, number>();
const EVENT_DEBOUNCE_MS = Math.max(config.faceScanIntervalSec * 1000, 45_000);

const cameraLoopRunning = new Set<string>();
const cameraScanInFlight = new Set<string>();
const loopAbort = new Map<string, boolean>();

let knownFacesCache: KnownFace[] = [];
let knownFacesCacheAt = 0;
const KNOWN_CACHE_MS = 30_000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function friendlyError(err: unknown): string {
  const raw = String(err instanceof Error ? err.message : err);
  if (raw.includes('timed out')) return 'انتهت مهلة التحليل — المحاولة التالية قريباً';
  if (raw.includes('face_recognition not found') || raw.includes('not installed')) {
    return `محرك التعرف غير مثبت — شغّل ${faceSetupCommand}`;
  }
  if (raw.includes('No module') || raw.includes('ultralytics') || raw.includes('mediapipe')) {
    return `حزمة Python ناقصة — شغّل ${faceSetupCommand}`;
  }
  if (raw.includes('Could not capture') || raw.includes('FRAME_CAPTURE')) {
    return 'تعذّر التقاط صورة من الكاميرا';
  }
  if (raw.length > 120) return raw.slice(0, 120) + '…';
  return raw || 'خطأ غير معروف';
}

async function getKnownFaces(): Promise<KnownFace[]> {
  const now = Date.now();
  if (knownFacesCacheAt > 0 && now - knownFacesCacheAt < KNOWN_CACHE_MS) {
    return knownFacesCache;
  }
  try {
    const profiles = await prisma.faceProfile.findMany({
      include: { employee: { select: { id: true, fullName: true, isActive: true } } },
    });
    const next: KnownFace[] = [];
    for (const p of profiles) {
      if (!p.employee.isActive) continue;
      try {
        next.push({
          employeeId: p.employeeId,
          profileId: p.id,
          fullName: p.employee.fullName,
          descriptor: descriptorFromJson(p.descriptor),
        });
      } catch (e) {
        console.warn('[face] skipped invalid face profile:', p.id, e);
      }
    }
    knownFacesCache = next;
    knownFacesCacheAt = now;
  } catch (e) {
    console.error('[face] load known faces failed:', e);
  }
  return knownFacesCache;
}

export async function fetchCameraFrame(camera: Camera): Promise<Buffer | null> {
  const primary = config.faceScanStreamQuality;
  const secondary = primary === 'sub' ? 'main' : 'sub';
  for (const quality of [primary, secondary] as const) {
    try {
      const streamName = await registerStream(camera, quality);
      const res = await fetchGo2rtcFrame(streamName);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length >= 500) return buf;
      }
    } catch (e) {
      console.warn(`[face] frame ${camera.name} (${quality}):`, e);
    }
  }

  try {
    const snap = await onvif.getSnapshot(
      camera.host,
      camera.onvifPort,
      camera.username,
      camera.passwordEnc
    );
    return snap && snap.length >= 500 ? snap : null;
  } catch (e) {
    console.warn(`[face] ONVIF snapshot ${camera.name}:`, e);
    return null;
  }
}

async function closeStaleSessions() {
  try {
    const cutoff = new Date(Date.now() - config.faceAbsenceCloseSec * 1000);
    const stale = await prisma.movementLog.findMany({
      where: { exitedAt: null, lastSeenAt: { lt: cutoff } },
    });
    for (const log of stale) {
      await prisma.movementLog.update({
        where: { id: log.id },
        data: { exitedAt: log.lastSeenAt },
      });
      lastSeenByEmployee.delete(log.employeeId);
    }
  } catch (e) {
    console.error('[face] closeStaleSessions:', e);
  }
}

function shouldEmitDetectionEvent(employeeId: string, cameraId: string): boolean {
  const key = `${employeeId}:${cameraId}`;
  const now = Date.now();
  const last = lastEventByKey.get(key) ?? 0;
  if (now - last < EVENT_DEBOUNCE_MS) return false;
  lastEventByKey.set(key, now);
  return true;
}

async function recordDetection(
  employeeId: string,
  cameraId: string,
  matchConfidence: number,
  snapshotPath: string,
  bbox: object
) {
  try {
    const now = new Date();
    const cached = lastSeenByEmployee.get(employeeId);
    let movementLogId: string;

    if (cached && cached.cameraId === cameraId) {
      movementLogId = cached.logId;
      await prisma.movementLog.update({
        where: { id: cached.logId },
        data: { lastSeenAt: now, confidence: matchConfidence },
      });
      lastSeenByEmployee.set(employeeId, { cameraId, logId: cached.logId, at: Date.now() });
    } else {
      if (cached) {
        await prisma.movementLog.update({
          where: { id: cached.logId },
          data: { exitedAt: now },
        });
      }
      const openOther = await prisma.movementLog.findFirst({
        where: { employeeId, exitedAt: null },
      });
      if (openOther && openOther.cameraId !== cameraId) {
        await prisma.movementLog.update({
          where: { id: openOther.id },
          data: { exitedAt: now },
        });
      }
      const log = await prisma.movementLog.create({
        data: {
          employeeId,
          cameraId,
          enteredAt: now,
          lastSeenAt: now,
          confidence: matchConfidence,
          entrySnapshot: snapshotPath,
        },
      });
      movementLogId = log.id;
      lastSeenByEmployee.set(employeeId, { cameraId, logId: log.id, at: Date.now() });
    }

    if (!shouldEmitDetectionEvent(employeeId, cameraId)) return;

    const event = await prisma.faceDetectionEvent.create({
      data: {
        employeeId,
        cameraId,
        movementLogId,
        confidence: matchConfidence,
        snapshotPath,
        bbox: JSON.stringify(bbox),
        isUnknown: false,
      },
    });

    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    const payload = {
      employeeId,
      employeeName: employee?.fullName,
      cameraId,
      movementLogId,
      eventId: event.id,
      confidence: matchConfidence,
      bbox,
      at: now.toISOString(),
    };
    emitToAll('face:detected', payload);
    void dispatchEvent('face_detected', {
      employeeId,
      employeeName: employee?.fullName,
      cameraId,
    });
  } catch (e) {
    console.error('[face] recordDetection failed:', e);
  }
}

async function recordUnknown(
  cameraId: string,
  trackKey: string,
  snapshotPath: string,
  bbox: object,
  detectionScore: number
) {
  try {
    const key = `unknown:${cameraId}:${trackKey}`;
    const now = Date.now();
    if (now - (lastEventByKey.get(key) ?? 0) < EVENT_DEBOUNCE_MS) return;
    lastEventByKey.set(key, now);
    await prisma.faceDetectionEvent.create({
      data: {
        cameraId,
        snapshotPath,
        bbox: JSON.stringify(bbox),
        isUnknown: true,
        confidence: detectionScore,
      },
    });
  } catch (e) {
    console.error('[face] recordUnknown failed:', e);
  }
}

/** One live scan tick for a camera — throws on hard failure. */
export async function scanCameraOnce(cameraId: string, known: KnownFace[]): Promise<void> {
  const camera = await prisma.camera.findUnique({ where: { id: cameraId } });
  if (!camera?.enabled || !camera.faceRecognitionEnabled) {
    emitLiveClear(cameraId, 'disabled');
    return;
  }

  const frame = await fetchCameraFrame(camera);
  if (!frame || frame.length < 500) {
    throw new Error('FRAME_CAPTURE_FAILED');
  }

  const { detections, objects, meta, error } = await detectAndMatchAll(frame, known);
  if (error) throw new Error(error);

  const frameWidth = meta.imageWidth;
  const frameHeight = meta.imageHeight;
  const liveItems: Parameters<typeof emitLiveFrame>[3] = [];

  const matchMap = new Map<
    number,
    { employeeId: string; profileId: string; fullName: string; distance: number } | null
  >();
  detections.forEach((d, i) => {
    if (d.match) {
      matchMap.set(i, {
        employeeId: d.match.employeeId,
        profileId: d.match.profileId ?? '',
        fullName: d.match.fullName,
        distance: d.match.distance,
      });
    } else {
      matchMap.set(i, null);
    }
  });

  const tracked = updateFaceTracks(
    cameraId,
    detections.map((d) => ({ descriptor: d.descriptor, bbox: d.bbox })),
    frameWidth,
    frameHeight,
    matchMap
  );

  const ts = Date.now();

  if (sceneObjectsEnabled()) {
    for (const obj of objects) {
      if (obj.class === 'person') continue;
      liveItems.push({
        detectionType: 'object',
        objectClass: obj.class,
        trackLabel: obj.class,
        bbox: obj.bbox,
        confidence: obj.score,
      });
    }
  }

  for (let i = 0; i < tracked.length; i++) {
    const tr = tracked[i];
    const det = detections[i];
    if (!det) continue;

    const displayName = tr.employeeName ?? tr.globalTrackLabel ?? tr.trackLabel;
    const liveConf = det.liveMatch?.confidence ?? det.detectionScore;

    if (det.detectionScore < config.faceMinDetectionScore) continue;

    const showFace =
      tr.employeeId && det.liveMatch
        ? confirmLiveDetection(
            cameraId,
            tr.employeeId,
            displayName,
            tr.bbox,
            frameWidth,
            frameHeight,
            liveConf
          )
        : true;

    if (showFace) {
      liveItems.push({
        detectionType: 'face',
        trackId: tr.trackId,
        trackLabel: displayName,
        globalTrackId: tr.globalTrackId,
        globalTrackLabel: tr.globalTrackLabel,
        employeeId: tr.employeeId,
        employeeName: displayName,
        isUnknown: !tr.employeeId,
        bbox: tr.bbox,
        confidence: liveConf,
      });
    }

    try {
      const snapDir = path.join(config.facesPath, 'detections', cameraId);
      const snapPath = path.join(snapDir, `${ts}_${tr.trackId}.jpg`);
      await cropFaceSnapshot(frame, tr.bbox, snapPath);

      if (tr.employeeId && !tr.isUnknown) {
        const confidence =
          det.match?.confidence ??
          (tr.matchDistance
            ? matchConfidence(tr.matchDistance, config.faceMatchThresholdCctv)
            : Math.min(0.65, Math.max(0.45, det.detectionScore)));
        await recordDetection(tr.employeeId, cameraId, confidence, snapPath, tr.bbox);
      } else if (tr.isUnknown && det.detectionScore >= config.faceMinDetectionScore) {
        const gMeta = getGlobalTrackMeta(tr.globalTrackId);
        const minHits =
          gMeta && gMeta.cameraIds.length >= 2
            ? config.faceCrossCameraEnrollHits
            : config.faceTrackEnrollMinHits;
        const enrolled = await autoEnrollFromTrack(
          cameraId,
          tr.trackId,
          tr.globalTrackId,
          tr.globalTrackNum,
          tr.descriptor,
          snapPath,
          known,
          tr.hits,
          minHits
        );
        if (enrolled) {
          await recordDetection(enrolled.employeeId, cameraId, 0.75, snapPath, tr.bbox);
          knownFacesCacheAt = 0;
        } else if (tr.hits >= config.faceTrackEnrollMinHits) {
          await recordUnknown(cameraId, tr.globalTrackId, snapPath, tr.bbox, det.detectionScore);
        }
      }
    } catch (e) {
      console.warn(`[face] snapshot/record ${camera.name} ${tr.trackId}:`, e);
    }
  }

  if (liveItems.length) {
    emitLiveFrame(cameraId, frameWidth, frameHeight, liveItems);
  } else {
    emitLiveClear(cameraId, 'empty');
  }
}

async function runCameraLiveLoop(cameraId: string, cameraName: string) {
  if (cameraLoopRunning.has(cameraId)) return;
  cameraLoopRunning.add(cameraId);
  loopAbort.set(cameraId, false);

  let consecutiveErrors = 0;
  const baseMs = config.faceScanIntervalSec * 1000;

  setScanStatus(cameraId, {
    state: 'idle',
    consecutiveErrors: 0,
    intervalSec: config.faceScanIntervalSec,
  });

  while (!loopAbort.get(cameraId)) {
    if (!config.faceScanEnabled) {
      await sleep(2000);
      continue;
    }

    if (!isFaceRecognitionAvailable()) {
      const ok = await loadFaceModels();
      if (!ok) {
        setScanStatus(cameraId, {
          state: 'unavailable',
          message: getFaceLoadError() || 'Face engine not ready',
          consecutiveErrors: consecutiveErrors + 1,
          intervalSec: config.faceScanIntervalSec,
        });
        emitLiveClear(cameraId, 'unavailable');
        await sleep(Math.min(30_000, baseMs * 4));
        continue;
      }
    }

    if (cameraScanInFlight.has(cameraId)) {
      await sleep(400);
      continue;
    }

    cameraScanInFlight.add(cameraId);
    setScanStatus(cameraId, {
      state: 'scanning',
      consecutiveErrors,
      intervalSec: config.faceScanIntervalSec,
    });

    try {
      const known = await getKnownFaces();
      await scanCameraOnce(cameraId, known);
      consecutiveErrors = 0;
      setScanStatus(cameraId, {
        state: 'ok',
        message: undefined,
        lastOkAt: new Date().toISOString(),
        consecutiveErrors: 0,
        intervalSec: config.faceScanIntervalSec,
      });
    } catch (e) {
      consecutiveErrors += 1;
      const msg = friendlyError(e);
      console.error(`[face] live ${cameraName}:`, msg);
      setScanStatus(cameraId, {
        state: 'error',
        message: msg,
        lastErrorAt: new Date().toISOString(),
        consecutiveErrors,
        intervalSec: config.faceScanIntervalSec,
      });
      emitLiveClear(cameraId, msg);
    } finally {
      cameraScanInFlight.delete(cameraId);
    }

    const backoff = Math.min(
      config.faceScanMaxBackoffSec * 1000,
      consecutiveErrors > 0 ? baseMs * Math.pow(1.8, consecutiveErrors - 1) : 0
    );
    await sleep(baseMs + backoff);
  }

  cameraLoopRunning.delete(cameraId);
}

let staleSessionTimer: ReturnType<typeof setInterval> | undefined;

async function syncCameraLoops() {
  if (!config.faceScanEnabled) return;

  const cameras = await prisma.camera.findMany({
    where: { enabled: true, faceRecognitionEnabled: true },
    select: { id: true, name: true },
  });

  const activeIds = new Set(cameras.map((c) => c.id));

  for (const cam of cameras) {
    if (!cameraLoopRunning.has(cam.id)) {
      void runCameraLiveLoop(cam.id, cam.name);
    }
  }

  for (const id of cameraLoopRunning) {
    if (!activeIds.has(id)) {
      loopAbort.set(id, true);
    }
  }
}

async function handleCrossCameraTransfer(ev: {
  globalTrackId: string;
  globalTrackNum: number;
  fromCameraId: string;
  toCameraId: string;
  employeeId?: string;
  fullName?: string;
}) {
  const [fromCam, toCam] = await Promise.all([
    prisma.camera.findUnique({ where: { id: ev.fromCameraId }, select: { name: true } }),
    prisma.camera.findUnique({ where: { id: ev.toCameraId }, select: { name: true } }),
  ]);
  const label = ev.fullName ?? `شخص #${ev.globalTrackNum}`;
  const payload = {
    globalTrackId: ev.globalTrackId,
    globalTrackNum: ev.globalTrackNum,
    employeeId: ev.employeeId,
    employeeName: label,
    fromCameraId: ev.fromCameraId,
    fromCameraName: fromCam?.name ?? ev.fromCameraId,
    toCameraId: ev.toCameraId,
    toCameraName: toCam?.name ?? ev.toCameraId,
    at: new Date().toISOString(),
  };
  console.log(
    `[face] Cross-camera: ${label} ${payload.fromCameraName} → ${payload.toCameraName}`
  );
  emitToAll('face:camera_transfer', payload);
  void dispatchEvent('face_camera_transfer', payload);
}

export function startFaceScanner() {
  void loadFaceModels().catch((e) => console.error('[face] model load failed:', e));
  void initGlobalFaceTracksFromDb().catch((e) =>
    console.error('[face] load global fingerprints:', e)
  );
  setCrossCameraHandler(handleCrossCameraTransfer);

  void syncCameraLoops();
  setInterval(() => {
    void syncCameraLoops().catch((e) => console.error('[face] sync loops:', e));
  }, 15_000);

  staleSessionTimer = setInterval(() => {
    void closeStaleSessions().catch((e) => console.error('[face] stale sessions:', e));
  }, 60_000);

  console.log(
    `[face] Live scanner per camera every ~${config.faceScanIntervalSec}s (parallel)`
  );
}

export function stopFaceScanner() {
  setCrossCameraHandler(null);
  for (const id of cameraLoopRunning) {
    loopAbort.set(id, true);
  }
  if (staleSessionTimer) clearInterval(staleSessionTimer);
}

/** Manual trigger (API) — one immediate scan per enabled camera. */
export async function runFaceScanCycle() {
  if (!isFaceRecognitionAvailable()) {
    const ok = await loadFaceModels();
    if (!ok) return;
  }
  const cameras = await prisma.camera.findMany({
    where: { enabled: true, faceRecognitionEnabled: true },
    select: { id: true },
  });
  const known = await getKnownFaces();
  await Promise.all(
    cameras.map(async (cam) => {
      if (cameraScanInFlight.has(cam.id)) return;
      try {
        await scanCameraOnce(cam.id, known);
      } catch (e) {
        console.error('[face] scan-now', cam.id, e);
      }
    })
  );
}
