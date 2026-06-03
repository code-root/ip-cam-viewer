import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';
import { descriptorFromJson, descriptorToJson, type KnownFace } from './service.js';
import {
  fingerprintMatchesKnown,
  linkTrackToEmployee,
  serializeTrackDescriptor,
} from './face-tracker.js';
import { linkFingerprintToEmployee } from './global-face-store.js';
import { emitToAll } from '../ws/hub.js';

const AUTO_NOTES = 'auto-enrolled';
let enrollQueue: Promise<void> = Promise.resolve();

async function withEnrollLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = enrollQueue.then(fn, fn);
  enrollQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function nextDefaultFaceName(): Promise<string> {
  const prefix = config.faceAutoEnrollNamePrefix;
  const rows = await prisma.employee.findMany({
    where: { fullName: { startsWith: prefix } },
    select: { fullName: true },
  });
  let max = 0;
  for (const row of rows) {
    if (!row.fullName.startsWith(prefix)) continue;
    const n = parseInt(row.fullName.slice(prefix.length), 10);
    if (!Number.isNaN(n)) max = Math.max(max, n);
  }
  return `${prefix}${max + 1}`;
}

function nextAutoEmployeeCode(): string {
  return `AUTO-${Date.now().toString(36).toUpperCase()}`;
}

async function loadKnownFacesFromDb(): Promise<KnownFace[]> {
  const profiles = await prisma.faceProfile.findMany({
    include: { employee: { select: { id: true, fullName: true, isActive: true } } },
  });
  const known: KnownFace[] = [];
  for (const p of profiles) {
    if (!p.employee.isActive) continue;
    try {
      known.push({
        employeeId: p.employeeId,
        profileId: p.id,
        fullName: p.employee.fullName,
        descriptor: descriptorFromJson(p.descriptor),
      });
    } catch (e) {
      console.warn('[face] skipped invalid face profile during auto-enroll:', p.id, e);
    }
  }
  return known;
}

function mergeKnownFace(target: KnownFace[], entry: KnownFace) {
  if (target.some((k) => k.profileId === entry.profileId)) return;
  target.push({
    ...entry,
    descriptor: new Float32Array(entry.descriptor),
  });
}

/**
 * Create employee + face profile from a stable unknown track (one person = one fingerprint).
 */
export async function autoEnrollFromTrack(
  cameraId: string,
  trackId: string,
  globalTrackId: string,
  trackNum: number,
  descriptor: Float32Array,
  snapPath: string,
  known: KnownFace[],
  hits: number,
  minHits = config.faceTrackEnrollMinHits
): Promise<KnownFace | null> {
  if (!config.faceAutoEnrollUnknown) return null;
  if (hits < minHits) return null;

  return withEnrollLock(async () => {
    const dbKnown = await loadKnownFacesFromDb();
    const existing = fingerprintMatchesKnown(descriptor, [...known, ...dbKnown]);
    if (existing) {
      const entry = [...known, ...dbKnown].find((k) => k.profileId === existing.profileId) ?? {
        employeeId: existing.employeeId,
        profileId: existing.profileId,
        fullName: existing.fullName,
        descriptor: new Float32Array(descriptor),
      };
      mergeKnownFace(known, entry);
      linkTrackToEmployee(cameraId, trackId, existing.employeeId, existing.profileId, existing.fullName);
      await linkFingerprintToEmployee(globalTrackId, existing.employeeId).catch(() => {});
      return entry;
    }

    const fullName = await nextDefaultFaceName();
    const employeeCode = nextAutoEmployeeCode();

    const employee = await prisma.employee.create({
      data: {
        employeeCode,
        fullName,
        notes: `${AUTO_NOTES} track:${trackId}`,
      },
    });

    const photoDir = path.join(config.facesPath, employee.id);
    await fs.mkdir(photoDir, { recursive: true });
    const photoPath = path.join(photoDir, `track${trackNum}_${Date.now()}.jpg`);
    await fs.copyFile(snapPath, photoPath);

    const profile = await prisma.faceProfile.create({
      data: {
        employeeId: employee.id,
        descriptor: descriptorToJson(descriptor),
        photoPath,
        label: `track-${trackNum}`,
      },
    });

    const entry: KnownFace = {
      employeeId: employee.id,
      profileId: profile.id,
      fullName,
      descriptor: new Float32Array(descriptor),
    };
    mergeKnownFace(known, entry);
    linkTrackToEmployee(cameraId, trackId, employee.id, profile.id, fullName);
    await linkFingerprintToEmployee(globalTrackId, employee.id).catch(() => {});

    console.log(`[face] Track ${trackId} -> new employee ${fullName} (fingerprint saved)`);
    emitToAll('employee:auto_created', {
      employeeId: employee.id,
      employeeCode,
      fullName,
      trackId,
    });

    return entry;
  });
}

/** @deprecated Use autoEnrollFromTrack — kept for manual enroll paths. */
export async function autoEnrollUnknownFace(
  descriptor: Float32Array,
  snapPath: string,
  known: KnownFace[]
): Promise<KnownFace | null> {
  if (!config.faceAutoEnrollUnknown) return null;

  return withEnrollLock(async () => {
    const dbKnown = await loadKnownFacesFromDb();
    const existing = fingerprintMatchesKnown(descriptor, [...known, ...dbKnown]);
    if (existing) {
      const entry = [...known, ...dbKnown].find((k) => k.profileId === existing.profileId) ?? null;
      if (entry) mergeKnownFace(known, entry);
      return entry;
    }

    const fullName = await nextDefaultFaceName();
    const employeeCode = nextAutoEmployeeCode();

    const employee = await prisma.employee.create({
      data: {
        employeeCode,
        fullName,
        notes: AUTO_NOTES,
      },
    });

    const photoDir = path.join(config.facesPath, employee.id);
    await fs.mkdir(photoDir, { recursive: true });
    const photoPath = path.join(photoDir, `auto_${Date.now()}.jpg`);
    await fs.copyFile(snapPath, photoPath);

    const profile = await prisma.faceProfile.create({
      data: {
        employeeId: employee.id,
        descriptor: serializeTrackDescriptor(descriptor),
        photoPath,
        label: 'auto',
      },
    });

    const entry: KnownFace = {
      employeeId: employee.id,
      profileId: profile.id,
      fullName,
      descriptor: new Float32Array(descriptor),
    };
    mergeKnownFace(known, entry);

    emitToAll('employee:auto_created', { employeeId: employee.id, employeeCode, fullName });
    return entry;
  });
}
