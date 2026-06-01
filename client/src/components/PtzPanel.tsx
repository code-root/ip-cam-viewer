import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { camerasApi } from '../api/client';
import { getPtzSpeed, setPtzSpeed } from '../lib/streamPrefs';
import './PtzPanel.css';

interface Props {
  cameraId: string;
  disabled?: boolean;
}

export function PtzPanel({ cameraId, disabled }: Props) {
  const { t } = useTranslation();
  const [speed, setSpeedState] = useState(getPtzSpeed);
  const setSpeed = (v: number) => {
    setSpeedState(v);
    setPtzSpeed(v);
  };
  const [presets, setPresets] = useState<Array<{ token: string; name?: string }>>([]);

  const move = (x: number, y: number, zoom = 0) => {
    if (disabled) return;
    camerasApi.ptz(cameraId, { action: 'move', x, y, zoom, speed }).catch(console.error);
  };

  const stop = () => camerasApi.ptz(cameraId, { action: 'stop' }).catch(console.error);

  const loadPresets = () => {
    camerasApi
      .presets(cameraId)
      .then((r) => setPresets(Array.isArray(r.presets) ? r.presets : []))
      .catch(console.error);
  };

  return (
    <div className="ptz-panel card">
      <h4>{t('ptz')}</h4>
      <div className="ptz-grid">
        <button type="button" onMouseDown={() => move(0, 1)} onMouseUp={stop} disabled={disabled}>↑</button>
        <button type="button" onMouseDown={() => move(-1, 0)} onMouseUp={stop} disabled={disabled}>←</button>
        <button type="button" onMouseDown={() => move(0, 0, -1)} onMouseUp={stop} disabled={disabled}>−</button>
        <button type="button" onMouseDown={() => move(1, 0)} onMouseUp={stop} disabled={disabled}>→</button>
        <button type="button" onMouseDown={() => move(0, -1)} onMouseUp={stop} disabled={disabled}>↓</button>
        <button type="button" onMouseDown={() => move(0, 0, 1)} onMouseUp={stop} disabled={disabled}>+</button>
      </div>
      <label>
        {t('ptzSpeed')}
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.1}
          value={speed}
          onChange={(e) => setSpeed(parseFloat(e.target.value))}
        />
        <span className="ptz-speed-value">{speed.toFixed(1)}</span>
      </label>
      <div className="ptz-presets">
        <button type="button" className="btn btn-ghost" onClick={loadPresets} disabled={disabled}>
          {t('presets')}
        </button>
        {presets.map((p) => (
          <button
            key={p.token}
            type="button"
            className="btn btn-ghost"
            onClick={() => camerasApi.gotoPreset(cameraId, p.token)}
            disabled={disabled}
          >
            {p.name || p.token}
          </button>
        ))}
      </div>
    </div>
  );
}
