import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { camerasApi } from '../api/client';
import { CameraCell } from '../components/CameraCell';

export function Compare() {
  const { t } = useTranslation();
  const { data } = useQuery({ queryKey: ['cameras'], queryFn: camerasApi.list });
  const cameras = data?.cameras || [];
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) => {
    setSelected((s) => {
      if (s.includes(id)) return s.filter((x) => x !== id);
      if (s.length >= 4) return s;
      return [...s, id];
    });
  };

  const compared = cameras.filter((c) => selected.includes(c.id));

  return (
    <div>
      <h2>{t('compare')}</h2>
      <div className="toolbar">
        {cameras.map((c) => (
          <button key={c.id} type="button" className={`btn ${selected.includes(c.id) ? '' : 'btn-ghost'}`} onClick={() => toggle(c.id)}>
            {c.name}
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(compared.length, 2) || 1}, 1fr)`, gap: '0.75rem', height: '70vh' }}>
        {compared.map((c) => (
          <CameraCell key={c.id} camera={c} quality="main" />
        ))}
      </div>
      <p style={{ marginTop: '0.5rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
        {new Date().toLocaleString()}
      </p>
    </div>
  );
}
