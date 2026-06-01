/** Defaults tuned for lowest latency (real-time viewing). */

export const STREAM_DEFAULT_QUALITY = 'sub' as const;

export const PTZ_SPEED_KEY = 'ptzSpeed';
export const PTZ_SPEED_DEFAULT = 1;

export function getPtzSpeed(): number {
  const raw = localStorage.getItem(PTZ_SPEED_KEY);
  const v = raw ? parseFloat(raw) : PTZ_SPEED_DEFAULT;
  if (!Number.isFinite(v)) return PTZ_SPEED_DEFAULT;
  return Math.min(1, Math.max(0.1, v));
}

export function setPtzSpeed(speed: number) {
  localStorage.setItem(PTZ_SPEED_KEY, String(Math.min(1, Math.max(0.1, speed))));
}
