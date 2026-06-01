import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';

interface MovementLog {
  id: string;
  enteredAt: string;
  exitedAt?: string;
  lastSeenAt: string;
  confidence: number;
  entrySnapshot?: string;
  camera: { name: string };
}

export function EmployeeDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));

  const { data } = useQuery({
    queryKey: ['employee', id],
    queryFn: () =>
      api<{
        employee: {
          id: string;
          employeeCode: string;
          fullName: string;
          department?: string;
          faceProfiles: Array<{ id: string; photoPath: string; label: string }>;
          movementLogs: MovementLog[];
        };
      }>(`/employees/${id}`),
    enabled: !!id,
  });

  const { data: timeline } = useQuery({
    queryKey: ['timeline', id, day],
    queryFn: () =>
      api<{ logs: MovementLog[]; events: Array<{ detectedAt: string; camera: { name: string }; confidence: number }> }>(
        `/employees/${id}/timeline?day=${day}`
      ),
    enabled: !!id,
  });

  const emp = data?.employee;

  if (!emp) return <p>Loading...</p>;

  const formatDuration = (start: string, end?: string) => {
    const a = new Date(start);
    const b = end ? new Date(end) : new Date();
    const mins = Math.round((b.getTime() - a.getTime()) / 60000);
    return mins < 1 ? '< 1 min' : `${mins} min`;
  };

  return (
    <div>
      <Link to="/employees">← {t('employees')}</Link>
      <h2 style={{ marginTop: '0.5rem' }}>
        {emp.fullName} <small style={{ color: 'var(--muted)' }}>({emp.employeeCode})</small>
      </h2>
      <p style={{ color: 'var(--muted)' }}>{emp.department}</p>

      <div className="card" style={{ margin: '1rem 0' }}>
        <h3>{t('enrolledFaces')}</h3>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          {emp.faceProfiles.map((p) => (
            <div key={p.id} style={{ textAlign: 'center' }}>
              <img
                src={`/api/employees/${emp.id}/photos/${p.photoPath.split('/').pop()}`}
                alt={p.label}
                style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 8 }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <div style={{ fontSize: '0.8rem' }}>{p.label}</div>
            </div>
          ))}
          {emp.faceProfiles.length === 0 && <p style={{ color: 'var(--muted)' }}>{t('noFacesEnrolled')}</p>}
        </div>
      </div>

      <div className="toolbar">
        <label>
          {t('day')}:{' '}
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </label>
      </div>

      <div className="card">
        <h3>{t('movementLog')}</h3>
        {!timeline?.logs?.length ? (
          <p style={{ color: 'var(--muted)' }}>{t('noMovements')}</p>
        ) : (
          <ul style={{ listStyle: 'none' }}>
            {timeline.logs.map((log) => (
              <li key={log.id} style={{ padding: '0.75rem 0', borderBottom: '1px solid var(--border)' }}>
                <strong>{log.camera.name}</strong>
                <br />
                <span style={{ fontSize: '0.9rem' }}>
                  {new Date(log.enteredAt).toLocaleTimeString()} →{' '}
                  {log.exitedAt ? new Date(log.exitedAt).toLocaleTimeString() : t('stillPresent')}
                </span>
                <span style={{ marginRight: '0.75rem', color: 'var(--muted)' }}>
                  ({formatDuration(log.enteredAt, log.exitedAt)})
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {timeline?.events && timeline.events.length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h3>{t('detectionEvents')}</h3>
          <ul style={{ listStyle: 'none', maxHeight: 300, overflow: 'auto' }}>
            {timeline.events.map((ev, i) => (
              <li key={i} style={{ fontSize: '0.85rem', padding: '0.25rem 0' }}>
                {new Date(ev.detectedAt).toLocaleTimeString()} — {ev.camera.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
