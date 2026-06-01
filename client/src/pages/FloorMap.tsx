import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api, camerasApi } from '../api/client';

export function FloorMap() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: plans } = useQuery({
    queryKey: ['floor-plans'],
    queryFn: () => api<{ floorPlans: Array<{ id: string; name: string; imagePath: string; cameras: Array<{ id: string; name: string; pinX?: number; pinY?: number }> }> }>('/floor-plans'),
  });
  const { data: cams } = useQuery({ queryKey: ['cameras'], queryFn: camerasApi.list });

  const plan = plans?.floorPlans[0];

  return (
    <div>
      <h2>{t('floorMap')}</h2>
      <div className="card" style={{ position: 'relative', minHeight: 400 }}>
        {plan ? (
          <div style={{ position: 'relative', width: '100%', maxWidth: 900 }}>
            <div style={{ background: 'var(--surface2)', height: 400, borderRadius: 8, position: 'relative' }}>
              {(plan.cameras.length ? plan.cameras : cams?.cameras || []).map((c, i) => {
                const x = ('pinX' in c && c.pinX != null) ? c.pinX : 20 + (i % 4) * 20;
                const y = ('pinY' in c && c.pinY != null) ? c.pinY : 20 + Math.floor(i / 4) * 25;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className="btn"
                    style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, transform: 'translate(-50%,-50%)', padding: '0.35rem 0.6rem', fontSize: '0.75rem' }}
                    onClick={() => navigate(`/?focus=${c.id}`)}
                  >
                    📹 {c.name}
                  </button>
                );
              })}
            </div>
            <p style={{ marginTop: '0.5rem', color: 'var(--muted)' }}>{plan.name}</p>
          </div>
        ) : (
          <p style={{ color: 'var(--muted)' }}>Upload a floor plan from API (POST /api/floor-plans with image). Pins use camera positions.</p>
        )}
        <ul style={{ marginTop: '1rem', listStyle: 'none' }}>
          {cams?.cameras.map((c) => (
            <li key={c.id}>
              <button type="button" className="btn btn-ghost" onClick={() => navigate(`/?focus=${c.id}`)}>{c.name}</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
