import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { recordingsApi } from '../api/client';

export function Playback() {
  const { t } = useTranslation();
  const { data } = useQuery({ queryKey: ['recordings'], queryFn: () => recordingsApi.list() });

  return (
    <div>
      <h2>{t('playback')}</h2>
      <div className="card">
        {!data?.recordings?.length ? (
          <p style={{ color: 'var(--muted)' }}>No recordings yet</p>
        ) : (
          <ul style={{ listStyle: 'none' }}>
            {data.recordings.map((r) => (
              <li key={r.id} style={{ padding: '0.75rem 0', borderBottom: '1px solid var(--border)' }}>
                <strong>{r.camera.name}</strong> — {new Date(r.startedAt).toLocaleString()}
                <br />
                <video controls style={{ width: '100%', maxWidth: 640, marginTop: '0.5rem' }} src={recordingsApi.streamUrl(r.id)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
