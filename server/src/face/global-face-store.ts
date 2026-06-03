import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';
import { descriptorFromJson, descriptorToJson } from './service.js';

export interface GlobalTrackSnapshot {
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

let persistChain: Promise<void> = Promise.resolve();

function withPersistLock(fn: () => Promise<void>): void {
  persistChain = persistChain.then(fn, fn);
}

/** Load saved fingerprints into memory (call once at scanner start). */
export async function loadGlobalFingerprintsInto(
  target: Map<string, GlobalTrackSnapshot>,
  setSeq: (n: number) => void
): Promise<void> {
  const persistSec = Math.max(
    config.faceGlobalTrackTtlSec,
    config.faceGlobalFingerprintPersistSec
  );
  const cutoff = new Date(Date.now() - persistSec * 1000);
  const rows = await prisma.globalFaceFingerprint.findMany({
    where: { lastSeenAt: { gte: cutoff } },
    include: { employee: { select: { id: true, fullName: true, isActive: true } } },
  });

  let maxNum = 0;
  for (const row of rows) {
    maxNum = Math.max(maxNum, row.globalTrackNum);
    let cameraIds: string[] = [];
    try {
      cameraIds = JSON.parse(row.camerasVisited) as string[];
    } catch {
      cameraIds = [];
    }
    target.set(row.globalTrackId, {
      globalTrackId: row.globalTrackId,
      globalTrackNum: row.globalTrackNum,
      descriptor: descriptorFromJson(row.descriptor),
      sampleCount: row.sampleCount,
      employeeId: row.employeeId ?? undefined,
      fullName: row.employee?.isActive ? row.employee.fullName : undefined,
      hits: row.sampleCount,
      cameraIds: new Set(cameraIds),
      lastCameraId: row.lastCameraId ?? cameraIds[cameraIds.length - 1] ?? '',
      lastAt: row.lastSeenAt.getTime(),
    });
  }
  if (maxNum > 0) setSeq(maxNum);
  if (rows.length) {
    console.log(`[face] Restored ${rows.length} cross-camera fingerprint(s) from database`);
  }
}

export function persistGlobalTrackSnapshot(track: GlobalTrackSnapshot): void {
  withPersistLock(async () => {
    const camerasVisited = JSON.stringify([...track.cameraIds]);
    await prisma.globalFaceFingerprint.upsert({
      where: { globalTrackId: track.globalTrackId },
      create: {
        globalTrackId: track.globalTrackId,
        globalTrackNum: track.globalTrackNum,
        descriptor: descriptorToJson(track.descriptor),
        employeeId: track.employeeId ?? null,
        camerasVisited,
        sampleCount: track.sampleCount,
        lastCameraId: track.lastCameraId || null,
        lastSeenAt: new Date(track.lastAt),
      },
      update: {
        descriptor: descriptorToJson(track.descriptor),
        employeeId: track.employeeId ?? null,
        camerasVisited,
        sampleCount: track.sampleCount,
        lastCameraId: track.lastCameraId || null,
        lastSeenAt: new Date(track.lastAt),
      },
    });
  });
}

export async function linkFingerprintToEmployee(
  globalTrackId: string,
  employeeId: string
): Promise<void> {
  await prisma.globalFaceFingerprint.updateMany({
    where: { globalTrackId },
    data: { employeeId },
  });
}
