import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Camera } from '../api/client';
import { camerasApi } from '../api/client';

export interface CameraEditValues {
  name: string;
  host: string;
  onvifPort: number;
  username: string;
  password: string;
  rtspOverride: string;
}

export function cameraToEditValues(c: Camera): CameraEditValues {
  return {
    name: c.name,
    host: c.host,
    onvifPort: c.onvifPort,
    username: c.username,
    password: '',
    rtspOverride: '',
  };
}

interface Props {
  camera: Camera;
  onSaved: () => void;
  onCancel: () => void;
}

export function CameraEditForm({ camera, onSaved, onCancel }: Props) {
  const { t } = useTranslation();
  const [form, setForm] = useState<CameraEditValues>(() => cameraToEditValues(camera));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        host: form.host.trim(),
        onvifPort: form.onvifPort,
        username: form.username,
        rtspOverride: form.rtspOverride || null,
      };
      if (form.password) body.password = form.password;
      await camerasApi.update(camera.id, body);
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="camera-edit-form">
      <div className="form-group">
        <label>{t('cameraName')}</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="form-group">
        <label>Host</label>
        <input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} dir="ltr" />
      </div>
      <div className="form-group">
        <label>ONVIF Port</label>
        <input
          type="number"
          value={form.onvifPort}
          onChange={(e) => setForm({ ...form, onvifPort: parseInt(e.target.value, 10) || 80 })}
        />
      </div>
      <div className="form-group">
        <label>{t('username')}</label>
        <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
      </div>
      <div className="form-group">
        <label>{t('password')}</label>
        <input
          type="password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          placeholder={t('passwordLeaveBlank')}
        />
      </div>
      <div className="form-group">
        <label>RTSP Override</label>
        <input
          value={form.rtspOverride}
          onChange={(e) => setForm({ ...form, rtspOverride: e.target.value })}
          placeholder="rtsp://..."
          dir="ltr"
        />
      </div>
      {error && <p className="test-result--fail-inline">{error}</p>}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" className="btn" onClick={save} disabled={saving || !form.name.trim() || !form.host.trim()}>
          {saving ? t('saving') : t('save')}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          {t('cancel')}
        </button>
      </div>
    </div>
  );
}
