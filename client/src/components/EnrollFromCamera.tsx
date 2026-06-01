import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Camera } from '../api/client';

interface Props {
  employeeId: string;
  cameras: Camera[];
  onDone: () => void;
  onError: (msg: string) => void;
}

export function EnrollFromCamera({ employeeId, cameras, onDone, onError }: Props) {
  const { t } = useTranslation();
  const [cameraId, setCameraId] = useState(() => {
    const td = cameras.find((c) => c.name === 'TD-IPC');
    return td?.id || cameras[0]?.id || '';
  });
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!cameraId) {
      onError(t('enrollNoCamera'));
      return;
    }
    setLoading(true);
    onError('');
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`/api/employees/${employeeId}/enroll-from-camera/${cameraId}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      const text = await res.text();
      let body: { error?: string; message?: string } = {};
      try {
        if (text.trim()) body = JSON.parse(text);
      } catch { /* ignore */ }

      if (!res.ok) {
        if (res.status === 403) throw new Error(t('enrollForbidden'));
        if (body.error === 'NO_FACE_DETECTED' || String(body.message).includes('NO_FACE')) {
          throw new Error(t('enrollNoFaceCamera'));
        }
        if (body.error === 'FRAME_CAPTURE_FAILED') throw new Error(t('enrollFrameFailed'));
        throw new Error(body.message || body.error || `HTTP ${res.status}`);
      }
      onDone();
    } catch (e) {
      onError(String(e));
    } finally {
      setLoading(false);
    }
  };

  if (!cameras.length) return null;

  return (
    <span className="enroll-from-camera" style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <select
        value={cameraId}
        onChange={(e) => setCameraId(e.target.value)}
        disabled={loading}
        className="enroll-from-camera__select"
        title={t('enrollFromCameraHint')}
      >
        {cameras.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button type="button" className="btn btn-ghost btn-sm" onClick={run} disabled={loading || !cameraId}>
        {loading ? t('enrollFromCameraBusy') : t('enrollFromCamera')}
      </button>
    </span>
  );
}
