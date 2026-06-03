import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { initSmoothTrack, stepSmoothDisplay, updateSmoothTarget, type Bbox } from '../lib/smoothBbox';
import './FaceLiveOverlay.css';

export interface LiveDetection {
  id: string;
  kind: 'face' | 'person' | 'object';
  objectClass?: string;
  employeeName: string;
  trackId?: string;
  globalTrackId?: string;
  isUnknown: boolean;
  confidence: number;
  bbox: Bbox;
  frameWidth: number;
  frameHeight: number;
  at: number;
}

type ScanState = 'idle' | 'scanning' | 'ok' | 'error' | 'unavailable';

type SmoothItem = LiveDetection & { smoothKey: string };

interface Props {
  cameraId: string;
}

function cellKey(bbox: Bbox, fw: number, fh: number): string {
  const cx = Math.round(((bbox.x + bbox.width / 2) / fw) * 16);
  const cy = Math.round(((bbox.y + bbox.height / 2) / fh) * 16);
  return `${cx}_${cy}`;
}

function mapBboxToOverlay(
  bbox: Bbox,
  frameW: number,
  frameH: number,
  videoW: number,
  videoH: number,
  containerW: number,
  containerH: number
): { left: number; top: number; width: number; height: number } | null {
  if (!containerW || !containerH || !frameW || !frameH) return null;
  const vw = videoW > 0 ? videoW : frameW;
  const vh = videoH > 0 ? videoH : frameH;
  const bx = bbox.x * (vw / frameW);
  const by = bbox.y * (vh / frameH);
  const bw = bbox.width * (vw / frameW);
  const bh = bbox.height * (vh / frameH);
  const scale = Math.min(containerW / vw, containerH / vh);
  const displayW = vw * scale;
  const displayH = vh * scale;
  const offsetX = (containerW - displayW) / 2;
  const offsetY = (containerH - displayH) / 2;
  return {
    left: ((offsetX + bx * scale) / containerW) * 100,
    top: ((offsetY + by * scale) / containerH) * 100,
    width: (bw * scale / containerW) * 100,
    height: (bh * scale / containerH) * 100,
  };
}

export function FaceLiveOverlay({ cameraId }: Props) {
  const { t } = useTranslation();
  const { socket } = useAuth();
  const rootRef = useRef<HTMLDivElement>(null);
  const smoothRef = useRef(
    new Map<string, { meta: Omit<LiveDetection, 'bbox'>; motion: ReturnType<typeof initSmoothTrack> }>()
  );
  const [displayItems, setDisplayItems] = useState<SmoothItem[]>([]);
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [layout, setLayout] = useState({ cw: 0, ch: 0, vw: 0, vh: 0 });
  const layoutRef = useRef(layout);

  const measure = useCallback(() => {
    const host = rootRef.current?.parentElement;
    const video = host?.querySelector('video');
    if (!host) return;
    const next = {
      cw: host.clientWidth,
      ch: host.clientHeight,
      vw: video?.videoWidth ?? 0,
      vh: video?.videoHeight ?? 0,
    };
    layoutRef.current = next;
    setLayout(next);
  }, []);

  useEffect(() => {
    const host = rootRef.current?.parentElement;
    if (!host) return;
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    const video = host.querySelector('video');
    video?.addEventListener('loadedmetadata', measure);
    video?.addEventListener('resize', measure);
    measure();
    return () => {
      ro.disconnect();
      video?.removeEventListener('loadedmetadata', measure);
      video?.removeEventListener('resize', measure);
    };
  }, [measure]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const host = rootRef.current?.parentElement;
      const video = host?.querySelector('video');
      if (video && !video.paused && video.readyState >= 2) {
        measure();
      }

      const now = performance.now();
      const nextDisplay: SmoothItem[] = [];
      const staleBefore = now - 3500;

      for (const [key, entry] of smoothRef.current) {
        if (entry.motion.targetAt < staleBefore) {
          smoothRef.current.delete(key);
          continue;
        }
        const bbox = stepSmoothDisplay(
          entry.motion,
          now,
          entry.meta.frameWidth,
          entry.meta.frameHeight
        );
        nextDisplay.push({ ...entry.meta, smoothKey: key, bbox });
      }
      setDisplayItems(nextDisplay);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [measure]);

  useEffect(() => {
    if (!socket) return;

    const onFrame = (payload: {
      cameraId: string;
      frameWidth?: number;
      frameHeight?: number;
      items?: Array<{
        detectionType: 'face' | 'person' | 'object';
        objectClass?: string;
        bbox: Bbox;
        confidence: number;
        employeeId?: string;
        employeeName?: string;
        trackId?: string;
        trackLabel?: string;
        globalTrackId?: string;
        globalTrackLabel?: string;
        isUnknown?: boolean;
      }>;
    }) => {
      if (payload.cameraId !== cameraId || !payload.items) return;
      const fw = payload.frameWidth && payload.frameWidth > 0 ? payload.frameWidth : 1920;
      const fh = payload.frameHeight && payload.frameHeight > 0 ? payload.frameHeight : 1080;
      const now = performance.now();
      const seen = new Set<string>();

      for (const it of payload.items) {
        const kind =
          it.detectionType === 'object'
            ? 'object'
            : it.detectionType === 'person'
              ? 'person'
              : 'face';
        const isUnknown = Boolean(it.isUnknown);
        if (kind === 'face' && !isUnknown && !it.employeeName && !it.globalTrackLabel && !it.trackLabel)
          continue;
        const label =
          kind === 'object'
            ? t(`object.${it.objectClass}`, {
                defaultValue: it.objectClass || t('objectUnknown'),
              })
            : it.employeeName ||
              it.globalTrackLabel ||
              it.trackLabel ||
              (kind === 'person' ? t('personDetected') : t('faceUnknown'));
        const stableKey =
          kind === 'object'
            ? `o:${it.objectClass}:${cellKey(it.bbox, fw, fh)}`
            : it.trackId
              ? `t:${it.trackId}`
              : it.globalTrackId
                ? `g:${it.globalTrackId}`
                : kind === 'person'
                  ? `p:${cellKey(it.bbox, fw, fh)}`
                  : isUnknown
                    ? `u:${cellKey(it.bbox, fw, fh)}`
                    : `n:${it.employeeName}`;
        seen.add(stableKey);

        const meta: Omit<LiveDetection, 'bbox'> = {
          id: stableKey,
          kind,
          objectClass: it.objectClass,
          employeeName: label,
          trackId: it.trackId,
          globalTrackId: it.globalTrackId,
          isUnknown: kind === 'face' && isUnknown,
          confidence: it.confidence,
          frameWidth: fw,
          frameHeight: fh,
          at: Date.now(),
        };

        const existing = smoothRef.current.get(stableKey);
        if (existing) {
          updateSmoothTarget(existing.motion, it.bbox, now);
          existing.meta = meta;
        } else {
          smoothRef.current.set(stableKey, {
            meta,
            motion: initSmoothTrack(it.bbox, now),
          });
        }
      }

      for (const key of smoothRef.current.keys()) {
        if (!seen.has(key)) smoothRef.current.delete(key);
      }
      measure();
    };

    const onClear = (payload: { cameraId: string }) => {
      if (payload.cameraId !== cameraId) return;
      smoothRef.current.clear();
      setDisplayItems([]);
    };

    const onStatus = (payload: {
      cameraId: string;
      state: ScanState;
      message?: string;
    }) => {
      if (payload.cameraId !== cameraId) return;
      setScanState(payload.state);
      setScanMessage(payload.message ?? null);
    };

    socket.on('face:live:frame', onFrame);
    socket.on('face:live:clear', onClear);
    socket.on('face:scan:status', onStatus);
    return () => {
      socket.off('face:live:frame', onFrame);
      socket.off('face:live:clear', onClear);
      socket.off('face:scan:status', onStatus);
    };
  }, [socket, cameraId, t, measure]);

  const statusLabel =
    scanState === 'scanning'
      ? t('faceScanning')
      : scanState === 'error'
        ? scanMessage || t('faceScanError')
        : scanState === 'unavailable'
          ? scanMessage || t('faceScanUnavailable')
          : null;

  return (
    <div ref={rootRef} className="face-live-overlay" aria-live="polite">
      {statusLabel && (
        <div
          className={`face-live-status face-live-status--${scanState}`}
          title={scanMessage ?? undefined}
        >
          {scanState === 'scanning' && <span className="face-live-status__pulse" />}
          {statusLabel}
        </div>
      )}
      {displayItems.map((f) => {
        const pos = mapBboxToOverlay(
          f.bbox,
          f.frameWidth,
          f.frameHeight,
          layout.vw,
          layout.vh,
          layout.cw,
          layout.ch
        );
        if (!pos) return null;
        const boxClass =
          f.kind === 'object'
            ? `face-live-box face-live-box--object face-live-box--${f.objectClass || 'thing'}`
            : f.kind === 'person'
              ? 'face-live-box face-live-box--person'
              : f.isUnknown
                ? 'face-live-box face-live-box--unknown'
                : 'face-live-box';
        const labelClass =
          f.kind === 'object'
            ? `face-live-label face-live-label--object face-live-label--${f.objectClass || 'thing'}`
            : f.kind === 'person'
              ? 'face-live-label face-live-label--person'
              : f.isUnknown
                ? 'face-live-label face-live-label--unknown'
                : 'face-live-label';
        return (
          <div
            key={f.smoothKey}
            className={boxClass}
            style={{
              left: `${pos.left}%`,
              top: `${pos.top}%`,
              width: `${pos.width}%`,
              height: `${pos.height}%`,
            }}
          >
            <span className={labelClass}>{f.employeeName}</span>
          </div>
        );
      })}
    </div>
  );
}
