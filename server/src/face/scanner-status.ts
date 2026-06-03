import { emitToAll } from '../ws/hub.js';

export type ScanState = 'idle' | 'scanning' | 'ok' | 'error' | 'unavailable';

export interface CameraScanStatus {
  cameraId: string;
  state: ScanState;
  message?: string;
  lastOkAt?: string;
  lastErrorAt?: string;
  consecutiveErrors: number;
  intervalSec: number;
}

const statusByCamera = new Map<string, CameraScanStatus>();

function emitStatus(cameraId: string) {
  const s = statusByCamera.get(cameraId);
  if (!s) return;
  emitToAll('face:scan:status', { ...s });
}

export function setScanStatus(
  cameraId: string,
  patch: Partial<CameraScanStatus> & { state: ScanState }
) {
  const prev = statusByCamera.get(cameraId);
  const next: CameraScanStatus = {
    cameraId,
    state: patch.state,
    message: patch.message,
    lastOkAt: patch.lastOkAt ?? prev?.lastOkAt,
    lastErrorAt: patch.lastErrorAt ?? prev?.lastErrorAt,
    consecutiveErrors: patch.consecutiveErrors ?? prev?.consecutiveErrors ?? 0,
    intervalSec: patch.intervalSec ?? prev?.intervalSec ?? 3,
  };
  statusByCamera.set(cameraId, next);
  emitStatus(cameraId);
}

export function getAllScanStatuses(): CameraScanStatus[] {
  return [...statusByCamera.values()];
}

export function emitLiveFrame(
  cameraId: string,
  frameWidth: number,
  frameHeight: number,
  items: Array<{
    detectionType: 'face' | 'person' | 'object';
    objectClass?: string;
    bbox: { x: number; y: number; width: number; height: number };
    confidence: number;
    employeeId?: string;
    employeeName?: string;
    trackId?: string;
    trackLabel?: string;
    globalTrackId?: string;
    globalTrackLabel?: string;
    isUnknown?: boolean;
  }>
) {
  emitToAll('face:live:frame', {
    cameraId,
    frameWidth,
    frameHeight,
    items,
    at: new Date().toISOString(),
  });
}

export function emitLiveClear(cameraId: string, reason?: string) {
  emitToAll('face:live:clear', { cameraId, reason, at: new Date().toISOString() });
}
