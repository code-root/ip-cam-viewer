import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Camera } from '../api/client';
import { camerasApi, recordingsApi } from '../api/client';
import { StreamPlayer } from './StreamPlayer';
import { DigitalZoomPan } from './DigitalZoomPan';
import { CameraQuickActions } from './CameraQuickActions';
import { CameraStreamStatus } from './CameraStreamStatus';
import { FaceLiveOverlay } from './FaceLiveOverlay';
import { STREAM_DEFAULT_QUALITY } from '../lib/streamPrefs';
import { useAuth } from '../context/AuthContext';
import './CameraCell.css';
import './CameraQuickActions.css';

interface Props {
  camera: Camera;
  quality?: 'main' | 'sub';
  focused?: boolean;
  onFocus?: () => void;
  onDeleted?: () => void;
  onRenamed?: () => void;
  showControls?: boolean;
  muted?: boolean;
}

export function CameraCell({
  camera,
  quality = STREAM_DEFAULT_QUALITY,
  focused,
  onFocus,
  onDeleted,
  onRenamed,
  showControls = true,
  muted = true,
}: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canManage = user?.role === 'admin';
  const containerRef = useRef<HTMLDivElement>(null);
  const [online, setOnline] = useState(true);
  const [recording, setRecording] = useState(false);
  const [localMuted, setLocalMuted] = useState(muted);
  const [reloadKey, setReloadKey] = useState(0);

  const transform = JSON.parse(camera.videoTransform || '{}');
  const masks = JSON.parse(camera.privacyMasks || '[]');

  const snapshot = async () => {
    const token = localStorage.getItem('accessToken');
    const a = document.createElement('a');
    a.href = `/api/cameras/${camera.id}/snapshot`;
    a.download = `${camera.name}.jpg`;
    const res = await fetch(a.href, { headers: { Authorization: `Bearer ${token}` } });
    const blob = await res.blob();
    a.href = URL.createObjectURL(blob);
    a.click();
  };

  const toggleRecord = async () => {
    if (recording) {
      await recordingsApi.stop(camera.id);
      setRecording(false);
    } else {
      await recordingsApi.start(camera.id);
      setRecording(true);
    }
  };

  const fullscreen = () => {
    containerRef.current?.requestFullscreen?.();
  };

  return (
    <div ref={containerRef} className={`camera-cell ${focused ? 'focused' : ''}`} onDoubleClick={onFocus}>
      <div className="camera-cell-header">
        <span>{camera.name}</span>
        <span className="camera-cell-header__actions">
          <CameraStreamStatus online={online} />
          <CameraQuickActions
            cameraId={camera.id}
            cameraName={camera.name}
            canManage={canManage}
            onReconnect={() => setReloadKey((k) => k + 1)}
            onDeleted={onDeleted}
            onRenamed={onRenamed}
          />
        </span>
      </div>
      <div className="camera-cell-video">
        <FaceLiveOverlay cameraId={camera.id} />
        <DigitalZoomPan>
          <StreamPlayer
            camera={camera}
            quality={quality}
            muted={localMuted}
            transform={transform}
            privacyMasks={masks}
            onStatus={setOnline}
            reloadKey={reloadKey}
          />
        </DigitalZoomPan>
      </div>
      {showControls && (
        <div className="camera-cell-controls">
          <button type="button" className="btn btn-ghost" onClick={snapshot} title={t('snapshot')}>
            📷
          </button>
          <button type="button" className={`btn ${recording ? 'btn-danger' : 'btn-ghost'}`} onClick={toggleRecord}>
            {recording ? '⏹' : '⏺'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setLocalMuted(!localMuted)}>
            {localMuted ? '🔇' : '🔊'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={fullscreen}>
            ⛶
          </button>
          {onFocus && (
            <button type="button" className="btn btn-ghost" onClick={onFocus}>
              ⊞
            </button>
          )}
        </div>
      )}
    </div>
  );
}
