import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { config } from '../config.js';
import { faceSetupCommand } from '../lib/platform.js';
import { getPythonCandidates, resolvePythonBin } from './python.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_SCRIPT = path.resolve(__dirname, '../../scripts/detect_faces.py');

const PROBE_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBEQACEQADAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//Z',
  'base64'
);

let backendReady = false;
let loadError: string | null = null;

export function isFaceRecognitionAvailable(): boolean {
  return backendReady;
}

export function getFaceLoadError(): string | null {
  return loadError;
}

export interface DetectedPersonBox {
  bbox: { x: number; y: number; width: number; height: number };
  score: number;
}

export interface DetectedSceneObject {
  class: string;
  classId?: number;
  bbox: { x: number; y: number; width: number; height: number };
  score: number;
}

async function runPythonDetect(imagePath: string): Promise<{
  faces: Array<{
    encoding: number[];
    score?: number;
    bbox: { x: number; y: number; width: number; height: number };
  }>;
  persons?: Array<{
    score?: number;
    bbox: { x: number; y: number; width: number; height: number };
  }>;
  objects?: Array<{
    class: string;
    classId?: number;
    score?: number;
    bbox: { x: number; y: number; width: number; height: number };
  }>;
  imageWidth?: number;
  imageHeight?: number;
}> {
  const pythonBin = await resolvePythonBin();
  if (!pythonBin) {
    const tried = getPythonCandidates().join(', ');
    throw new Error(
      `face_recognition not found. Set PYTHON_BIN in .env or run: ${faceSetupCommand} (tried: ${tried})`
    );
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(pythonBin, [PYTHON_SCRIPT, imagePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FACE_MODELS_DIR: config.faceModelsDir,
      },
    });
    let out = '';
    let err = '';
    const timeoutMs = config.faceDetectTimeoutSec * 1000;
    const killTimer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Face detection timed out (${config.faceDetectTimeoutSec}s)`));
    }, timeoutMs);
    proc.stdout.on('data', (d) => {
      out += d.toString();
    });
    proc.stderr.on('data', (d) => {
      err += d.toString();
    });
    proc.on('close', (code) => {
      clearTimeout(killTimer);
      try {
        const parsed = JSON.parse(out || '{}');
        if (parsed.error) return reject(new Error(parsed.error));
        if (code !== 0) return reject(new Error(err || `python exit ${code}`));
        resolve(parsed);
      } catch (e) {
        reject(new Error(err || String(e)));
      }
    });
  });
}

async function checkPythonFaceBackend(): Promise<boolean> {
  const pythonBin = await resolvePythonBin();
  if (!pythonBin) {
    loadError = `face_recognition not installed. Run: ${faceSetupCommand} (tried: ${getPythonCandidates().join(', ')})`;
    return false;
  }

  try {
    const tmp = path.join(config.facesPath, '_probe.jpg');
    await fs.mkdir(path.dirname(tmp), { recursive: true });
    await fs.writeFile(tmp, PROBE_JPEG);
    await runPythonDetect(tmp);
    await fs.unlink(tmp).catch(() => {});
  } catch (e) {
    console.warn('[face] Probe detect failed (import OK):', e);
  }
  return true;
}

export async function loadFaceModels(): Promise<boolean> {
  if (backendReady) return true;

  if (await checkPythonFaceBackend()) {
    backendReady = true;
    loadError = null;
    console.log('[face] Detection ready (YOLOv8 + MediaPipe + face_recognition)');
    return true;
  }

  backendReady = false;
  console.warn('[face] Face recognition unavailable:', loadError);
  console.warn(`[face] Setup: ${faceSetupCommand}`);
  return false;
}

async function withTempImage(buffer: Buffer, fn: (p: string) => Promise<void>) {
  const tmp = path.join(config.facesPath, `_tmp_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
  await fs.mkdir(path.dirname(tmp), { recursive: true });
  await fs.writeFile(tmp, buffer);
  try {
    await fn(tmp);
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
}

export interface FaceDescriptorResult {
  descriptor: Float32Array;
  bbox: { x: number; y: number; width: number; height: number };
}

interface DetectedFace {
  descriptor: Float32Array;
  bbox: { x: number; y: number; width: number; height: number };
  score: number;
}

export interface DetectFrameMeta {
  imageWidth: number;
  imageHeight: number;
}

async function detectFacesInBuffer(
  imageBuffer: Buffer
): Promise<{
  faces: DetectedFace[];
  persons: DetectedPersonBox[];
  objects: DetectedSceneObject[];
  meta: DetectFrameMeta;
}> {
  const faces: DetectedFace[] = [];
  const persons: DetectedPersonBox[] = [];
  const objects: DetectedSceneObject[] = [];
  let meta: DetectFrameMeta = { imageWidth: 1920, imageHeight: 1080 };
  await withTempImage(imageBuffer, async (tmp) => {
    const raw = await runPythonDetect(tmp);
    meta = {
      imageWidth: raw.imageWidth ?? 1920,
      imageHeight: raw.imageHeight ?? 1080,
    };
    const minScore = config.faceMinDetectionScore;
    for (const f of raw.faces) {
      const score = f.score ?? 0;
      if (score < minScore) continue;
      if (!Array.isArray(f.encoding) || f.encoding.length !== 128) continue;
      faces.push({
        descriptor: new Float32Array(f.encoding),
        bbox: f.bbox,
        score,
      });
    }
    const minPerson = config.faceMinPersonScore;
    for (const p of raw.persons ?? []) {
      const score = p.score ?? 0;
      if (score < minPerson) continue;
      persons.push({ bbox: p.bbox, score });
    }
    const minObject = config.faceObjectMinScore;
    for (const o of raw.objects ?? []) {
      const score = o.score ?? 0;
      if (score < minObject) continue;
      if (!o.class || !o.bbox) continue;
      objects.push({
        class: o.class,
        classId: o.classId,
        bbox: o.bbox,
        score,
      });
    }
  });
  return { faces, persons, objects, meta };
}

export async function extractFaceFromBuffer(imageBuffer: Buffer): Promise<FaceDescriptorResult> {
  if (!(await loadFaceModels())) throw new Error(loadError || 'Face recognition not available');

  const { faces } = await detectFacesInBuffer(imageBuffer);
  if (!faces.length) throw new Error('NO_FACE_DETECTED');

  const best = faces.reduce((a, b) => (a.score >= b.score ? a : b));
  return { descriptor: best.descriptor, bbox: best.bbox };
}

export function descriptorToJson(descriptor: Float32Array): string {
  return JSON.stringify(Array.from(descriptor));
}

export function descriptorFromJson(json: string): Float32Array {
  return new Float32Array(JSON.parse(json));
}

export interface KnownFace {
  employeeId: string;
  profileId: string;
  fullName: string;
  descriptor: Float32Array;
}

export function euclideanDistance(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || !a.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export function matchConfidence(distance: number, threshold = config.faceMatchThreshold): number {
  if (distance >= threshold) return 0;
  return Math.min(1, Math.max(0, 1 - distance / threshold));
}

export function matchFace(
  probe: Float32Array,
  known: KnownFace[],
  threshold = config.faceMatchThreshold
): { employeeId: string; profileId: string; fullName: string; distance: number } | null {
  return matchFaceWithMargin(probe, known, threshold, 0);
}

/** Require clear winner over second-best match (reduces false IDs). */
export function matchFaceWithMargin(
  probe: Float32Array,
  known: KnownFace[],
  threshold: number,
  margin = config.faceMatchMargin
): { employeeId: string; profileId: string; fullName: string; distance: number } | null {
  const ranked: Array<{ employeeId: string; profileId: string; fullName: string; distance: number }> = [];

  for (const k of known) {
    const distance = euclideanDistance(probe, k.descriptor);
    if (distance < threshold) {
      ranked.push({
        employeeId: k.employeeId,
        profileId: k.profileId,
        fullName: k.fullName,
        distance,
      });
    }
  }
  if (!ranked.length) return null;
  ranked.sort((a, b) => a.distance - b.distance);
  const best = ranked[0];
  if (ranked.length > 1 && ranked[1].distance - best.distance < margin) {
    return null;
  }
  return best;
}

/** Strict match for live overlay labels. */
export function matchFaceForLive(
  probe: Float32Array,
  known: KnownFace[]
): { employeeId: string; profileId: string; fullName: string; distance: number } | null {
  return matchFaceWithMargin(probe, known, config.faceMatchThreshold, config.faceMatchMargin);
}

/** Match with standard threshold, then relaxed CCTV threshold (attendance logs). */
export function matchFaceForCamera(
  probe: Float32Array,
  known: KnownFace[]
): { employeeId: string; profileId: string; fullName: string; distance: number } | null {
  return (
    matchFaceWithMargin(probe, known, config.faceMatchThreshold, config.faceMatchMargin) ||
    matchFaceWithMargin(probe, known, config.faceMatchThresholdCctv, config.faceMatchMargin)
  );
}

export async function detectAndMatchAll(
  imageBuffer: Buffer,
  known: KnownFace[]
): Promise<{
  detections: Array<{
    match: {
      employeeId: string;
      profileId: string;
      fullName: string;
      distance: number;
      confidence: number;
    } | null;
    liveMatch: { employeeId: string; fullName: string; distance: number; confidence: number } | null;
    bbox: { x: number; y: number; width: number; height: number };
    descriptor: Float32Array;
    detectionScore: number;
    faceIndex: number;
  }>;
  persons: DetectedPersonBox[];
  objects: DetectedSceneObject[];
  meta: DetectFrameMeta;
  error?: string;
}> {
  if (!(await loadFaceModels())) {
    return {
      detections: [],
      persons: [],
      objects: [],
      meta: { imageWidth: 1920, imageHeight: 1080 },
      error: getFaceLoadError() || 'Face recognition not available',
    };
  }

  try {
    const { faces, persons, objects, meta } = await detectFacesInBuffer(imageBuffer);
    const { assignUniqueFaceMatches } = await import('./face-tracker.js');
    const unique = assignUniqueFaceMatches(
      faces.map((f) => f.descriptor),
      known
    );

    const detections = faces.map((f, faceIdx) => {
      const slot = unique.get(faceIdx) ?? null;
      const cameraConf = slot ? matchConfidence(slot.distance, config.faceMatchThresholdCctv) : 0;
      const liveConf = slot ? matchConfidence(slot.distance, config.faceMatchThreshold) : 0;
      const liveMatch =
        slot && liveConf >= config.faceMinLiveConfidence
          ? {
              employeeId: slot.employeeId,
              fullName: slot.fullName,
              distance: slot.distance,
              confidence: liveConf,
            }
          : null;
      return {
        match: slot
          ? {
              employeeId: slot.employeeId,
              fullName: slot.fullName,
              distance: slot.distance,
              confidence: cameraConf,
              profileId: slot.profileId,
            }
          : null,
        liveMatch,
        bbox: f.bbox,
        descriptor: f.descriptor,
        detectionScore: f.score,
        faceIndex: faceIdx,
      };
    });
    return { detections, persons, objects, meta };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[face] detectAndMatchAll failed:', msg);
    return {
      detections: [],
      persons: [],
      objects: [],
      meta: { imageWidth: 1920, imageHeight: 1080 },
      error: msg,
    };
  }
}

export async function cropFaceSnapshot(
  imageBuffer: Buffer,
  bbox: { x: number; y: number; width: number; height: number },
  destPath: string
): Promise<void> {
  const jpeg = await import('jpeg-js');
  const pngjs = await import('pngjs');
  let width: number;
  let height: number;
  let data: Uint8Array;

  if (imageBuffer[0] === 0xff && imageBuffer[1] === 0xd8) {
    const decoded = jpeg.decode(imageBuffer, { useTArray: true });
    width = decoded.width;
    height = decoded.height;
    data = decoded.data;
  } else {
    const png = pngjs.PNG.sync.read(imageBuffer);
    width = png.width;
    height = png.height;
    data = png.data;
  }

  const pad = 20;
  const x = Math.max(0, Math.floor(bbox.x - pad));
  const y = Math.max(0, Math.floor(bbox.y - pad));
  const cw = Math.min(width - x, Math.floor(bbox.width + pad * 2));
  const ch = Math.min(height - y, Math.floor(bbox.height + pad * 2));

  const cropData = new Uint8Array(cw * ch * 4);
  for (let row = 0; row < ch; row++) {
    for (let col = 0; col < cw; col++) {
      const src = ((y + row) * width + (x + col)) * 4;
      const dst = (row * cw + col) * 4;
      cropData[dst] = data[src];
      cropData[dst + 1] = data[src + 1];
      cropData[dst + 2] = data[src + 2];
      cropData[dst + 3] = 255;
    }
  }

  const encoded = jpeg.encode({ data: cropData, width: cw, height: ch }, 90);
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, encoded.data);
}
