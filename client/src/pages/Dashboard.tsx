import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { camerasApi } from '../api/client';
import { CameraGrid } from '../components/CameraGrid';
import { PtzPanel } from '../components/PtzPanel';
import { useAuth } from '../context/AuthContext';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useUrlQuery } from '../hooks/useUrlQuery';
import { camerasApi as camApi } from '../api/client';
import { STREAM_DEFAULT_QUALITY, getPtzSpeed } from '../lib/streamPrefs';

const GRID_SIZES = [1, 4, 6, 9, 16] as const;

function parseGrid(v: string | null): number {
  const n = parseInt(v || '', 10);
  return GRID_SIZES.includes(n as (typeof GRID_SIZES)[number]) ? n : 4;
}

export function Dashboard() {
  const { t } = useTranslation();
  const { user, socket } = useAuth();
  const qc = useQueryClient();
  const url = useUrlQuery();

  const [gridSize, setGridSize] = useState(() => parseGrid(url.get('grid')));
  const [focusedId, setFocusedId] = useState<string | null>(() => url.get('camera'));
  const [quality, setQuality] = useState<'main' | 'sub'>(() => {
    const q = url.get('quality');
    if (q === 'main') return 'main';
    return STREAM_DEFAULT_QUALITY;
  });
  const [tourActive, setTourActive] = useState(false);
  const [tourIndex, setTourIndex] = useState(0);
  const [pipCamera, setPipCamera] = useState<string | null>(null);

  const { data, refetch } = useQuery({ queryKey: ['cameras'], queryFn: camerasApi.list });

  const cameras = data?.cameras || [];
  const canPtz = user?.role !== 'viewer';

  const syncUrl = useCallback(
    (patch: { camera?: string | null; grid?: number; quality?: 'main' | 'sub' }) => {
      url.set({
        camera: patch.camera !== undefined ? patch.camera : focusedId,
        grid: patch.grid !== undefined ? String(patch.grid) : String(gridSize),
        quality: patch.quality !== undefined ? patch.quality : quality,
      });
    },
    [url, focusedId, gridSize, quality]
  );

  const focusCamera = useCallback(
    (id: string | null) => {
      setFocusedId(id);
      syncUrl({ camera: id });
    },
    [syncUrl]
  );

  const changeGrid = useCallback(
    (n: number) => {
      setGridSize(n);
      setFocusedId(null);
      syncUrl({ grid: n, camera: null });
    },
    [syncUrl]
  );

  // Drop invalid camera id from URL after list loads
  useEffect(() => {
    if (!focusedId || cameras.length === 0) return;
    if (!cameras.some((c) => c.id === focusedId)) {
      focusCamera(null);
    }
  }, [cameras, focusedId, focusCamera]);

  useEffect(() => {
    if (!socket) return;
    socket.on('motion', (payload: { cameraId: string }) => {
      console.log('Motion:', payload);
    });
    return () => {
      socket.off('motion');
    };
  }, [socket]);

  useEffect(() => {
    if (!tourActive || cameras.length === 0) return;
    const iv = setInterval(() => {
      setTourIndex((i) => {
        const next = (i + 1) % Math.min(cameras.length, gridSize);
        const id = cameras[next]?.id || null;
        focusCamera(id);
        return next;
      });
    }, 5000);
    return () => clearInterval(iv);
  }, [tourActive, cameras, gridSize, focusCamera]);

  const focusedCamera = cameras.find((c) => c.id === focusedId);

  useKeyboardShortcuts({
    onGrid: (n) => changeGrid(n === 1 ? 1 : n <= 4 ? 4 : n <= 6 ? 6 : n <= 9 ? 9 : 16),
    onFullscreen: () => document.querySelector('.camera-cell')?.requestFullscreen?.(),
    onSnapshot: () => focusedId && camApi.snapshotUrl(focusedId),
    onPtz: (dir) => focusedId && canPtz && camApi.ptz(focusedId, { action: 'move', ...dir, speed: getPtzSpeed() }),
  });

  return (
    <div>
      <div className="toolbar">
        <span>{t('dashboard')}</span>
        {GRID_SIZES.map((n) => (
          <button
            key={n}
            type="button"
            className={`btn ${gridSize === n ? '' : 'btn-ghost'}`}
            onClick={() => changeGrid(n)}
          >
            {n}
          </button>
        ))}
        <select
          value={quality}
          onChange={(e) => {
            const q = e.target.value as 'main' | 'sub';
            setQuality(q);
            syncUrl({ quality: q });
          }}
          title={t('streamQualityHint')}
        >
          <option value="sub">{t('sub')} — {t('streamLive')}</option>
          <option value="main">{t('main')}</option>
        </select>
        <button type="button" className={`btn ${tourActive ? 'btn-danger' : 'btn-ghost'}`} onClick={() => setTourActive(!tourActive)}>
          {t('tour')}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setPipCamera(focusedId || cameras[0]?.id || null)}>
          {t('pip')}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => refetch()}>
          ↻
        </button>
      </div>

      {cameras.length === 0 ? (
        <p>{t('noCameras')}</p>
      ) : (
        <div style={{ display: 'flex', gap: '1rem' }}>
          <div style={{ flex: 1 }}>
            <CameraGrid
              cameras={cameras}
              gridSize={gridSize}
              focusedId={focusedId}
              onFocus={focusCamera}
              onCameraDeleted={(id) => {
                if (focusedId === id) focusCamera(null);
                void qc.invalidateQueries({ queryKey: ['cameras'] });
              }}
              onCameraRenamed={() => void qc.invalidateQueries({ queryKey: ['cameras'] })}
              quality={quality}
            />
          </div>
          {focusedCamera && canPtz && focusedCamera.supportsPtz && (
            <PtzPanel cameraId={focusedCamera.id} />
          )}
        </div>
      )}

      {pipCamera && (
        <div style={{ position: 'fixed', bottom: 16, left: 16, width: 320, zIndex: 100, boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
          <button type="button" className="btn btn-ghost" style={{ position: 'absolute', top: 4, right: 4, zIndex: 101 }} onClick={() => setPipCamera(null)}>✕</button>
          <CameraGrid cameras={cameras.filter((c) => c.id === pipCamera)} gridSize={1} quality="main" />
        </div>
      )}
    </div>
  );
}
