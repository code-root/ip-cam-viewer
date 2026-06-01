import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Go2rtcStream } from '../lib/go2rtcStream';
import './StreamPlayer.css';
import './TestStreamPreview.css';

interface Props {
  streamName: string | null;
  label?: string;
  reloadKey?: number;
}

export function TestStreamPreview({ streamName, label, reloadKey = 0 }: Props) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const freezeRef = useRef<HTMLImageElement>(null);
  const playerRef = useRef<Go2rtcStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!streamName) return;

    const video = videoRef.current;
    const freeze = freezeRef.current;
    if (!video || !freeze) return;

    setError(null);
    playerRef.current?.stop();
    playerRef.current = new Go2rtcStream(video, streamName, {
      onOnline: () => setError(null),
      onOffline: () => {
        Go2rtcStream.captureToImage(video, freeze);
        freeze.style.opacity = '1';
        video.style.opacity = '0';
      },
    });
    playerRef.current.start();

    const onPlaying = () => {
      freeze.style.opacity = '0';
      video.style.opacity = '1';
    };
    video.addEventListener('playing', onPlaying);

    return () => {
      video.removeEventListener('playing', onPlaying);
      playerRef.current?.stop();
      playerRef.current = null;
    };
  }, [streamName, reloadKey]);

  if (!streamName) return null;

  return (
    <div className="test-preview-panel">
      <h4 className="test-preview-title">{label || t('testPreview')}</h4>
      <div className="test-preview-box stream-player">
        <img ref={freezeRef} className="stream-freeze" alt="" />
        <video ref={videoRef} autoPlay playsInline muted style={{ opacity: 0 }} />
        {error && <div className="stream-error">{error}</div>}
      </div>
    </div>
  );
}
