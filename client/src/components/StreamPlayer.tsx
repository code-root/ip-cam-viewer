import { useEffect, useRef, useState } from 'react';
import { streamsApi } from '../api/client';
import type { Camera } from '../api/client';
import { Go2rtcStream } from '../lib/go2rtcStream';
import { STREAM_DEFAULT_QUALITY } from '../lib/streamPrefs';
import './StreamPlayer.css';

interface Props {
  camera: Camera;
  quality?: 'main' | 'sub';
  muted?: boolean;
  transform?: { rotate?: number; flipH?: boolean; flipV?: boolean };
  privacyMasks?: Array<{ x: number; y: number; w: number; h: number }>;
  onStatus?: (online: boolean) => void;
  /** Bump to stop and restart the stream (reconnect). */
  reloadKey?: number;
}

export function StreamPlayer({
  camera,
  quality = STREAM_DEFAULT_QUALITY,
  muted = true,
  transform,
  privacyMasks,
  onStatus,
  reloadKey = 0,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const freezeRef = useRef<HTMLImageElement>(null);
  const playerRef = useRef<Go2rtcStream | null>(null);
  const sessionRef = useRef(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const session = ++sessionRef.current;
    let cancelled = false;
    let stallTimer: ReturnType<typeof setInterval> | undefined;

    async function start() {
      try {
        setError(null);
        const started = await streamsApi.start(camera.id, quality);
        if (cancelled || session !== sessionRef.current) return;

        const video = videoRef.current;
        const freeze = freezeRef.current;
        if (!video || !freeze) return;

        const v = video as HTMLVideoElement & { latencyHint?: string };
        if ('latencyHint' in v) v.latencyHint = 'realtime';

        playerRef.current?.stop();
        playerRef.current = new Go2rtcStream(video, started.streamName, {
          onOnline: () => {
            if (session !== sessionRef.current) return;
            onStatus?.(true);
            setError(null);
          },
          onOffline: () => {
            if (session !== sessionRef.current) return;
            Go2rtcStream.captureToImage(video, freeze);
            freeze.style.opacity = '1';
            video.style.opacity = '0';
            onStatus?.(false);
          },
        });
        playerRef.current.start();

        // Periodically cache last good frame while live
        stallTimer = setInterval(() => {
          if (video.videoWidth > 0 && !video.paused && video.readyState >= 2) {
            Go2rtcStream.captureToImage(video, freeze);
          }
        }, 800);

        const onPlaying = () => {
          freeze.style.opacity = '0';
          video.style.opacity = '1';
        };
        video.addEventListener('playing', onPlaying);

        video.addEventListener('stalled', () => {
          Go2rtcStream.captureToImage(video, freeze);
          freeze.style.opacity = '1';
        });

        video.addEventListener('waiting', () => {
          if (video.videoWidth > 0) {
            Go2rtcStream.captureToImage(video, freeze);
            freeze.style.opacity = '1';
          }
        });
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          onStatus?.(false);
        }
      }
    }

    start();

    return () => {
      cancelled = true;
      if (stallTimer) clearInterval(stallTimer);
      playerRef.current?.stop();
      playerRef.current = null;
      const stopSession = session;
      setTimeout(() => {
        if (sessionRef.current === stopSession) {
          streamsApi.stop(camera.id).catch(() => {});
        }
      }, 100);
    };
  }, [camera.id, quality, onStatus, reloadKey]);

  const tf = transform || {};
  const style: React.CSSProperties = {
    transform: [
      tf.rotate ? `rotate(${tf.rotate}deg)` : '',
      tf.flipH ? 'scaleX(-1)' : '',
      tf.flipV ? 'scaleY(-1)' : '',
    ]
      .filter(Boolean)
      .join(' ') || undefined,
  };

  return (
    <div className="stream-player" ref={containerRef}>
      <img ref={freezeRef} className="stream-freeze" alt="" style={style} />
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        style={{ ...style, opacity: 0 }}
      />
      {privacyMasks?.map((m, i) => (
        <div
          key={i}
          className="privacy-mask"
          style={{
            left: `${m.x}%`,
            top: `${m.y}%`,
            width: `${m.w}%`,
            height: `${m.h}%`,
          }}
        />
      ))}
      {error && <div className="stream-error">{error}</div>}
    </div>
  );
}
