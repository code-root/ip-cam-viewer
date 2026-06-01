import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

interface ReportRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  department?: string;
  firstSeen?: string;
  lastSeen?: string;
  visitCount: number;
  cameras: string[];
}

export function Attendance() {
  const { t } = useTranslation();
  const { socket } = useAuth();
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [liveEvents, setLiveEvents] = useState<Array<{ employeeName?: string; cameraId: string; at: string }>>([]);

  const { data, refetch } = useQuery({
    queryKey: ['attendance', day],
    queryFn: () => api<{ day: string; report: ReportRow[] }>(`/employees/attendance/report?day=${day}`),
  });

  const { data: recent } = useQuery({
    queryKey: ['detections-recent'],
    queryFn: () =>
      api<{
        events: Array<{
          id: string;
          detectedAt: string;
          isUnknown: boolean;
          employee?: { fullName: string };
          camera: { name: string };
        }>;
      }>('/employees/detections/recent'),
    refetchInterval: 15000,
  });

  useEffect(() => {
    if (!socket) return;
    const handler = (payload: { employeeName?: string; cameraId: string; at: string }) => {
      setLiveEvents((prev) => [payload, ...prev].slice(0, 20));
      refetch();
    };
    socket.on('face:detected', handler);
    socket.on('employee:auto_created', handler);
    return () => {
      socket.off('face:detected', handler);
      socket.off('employee:auto_created', handler);
    };
  }, [socket, refetch]);

  return (
    <div>
      <h2>{t('attendance')}</h2>
      <div className="toolbar">
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        <button type="button" className="btn btn-ghost" onClick={() => refetch()}>↻</button>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3>{t('dailyReport')}</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'right' }}>
              <th style={{ padding: '0.5rem' }}>{t('employeeCode')}</th>
              <th>{t('fullName')}</th>
              <th>{t('department')}</th>
              <th>{t('firstSeen')}</th>
              <th>{t('lastSeen')}</th>
              <th>{t('camerasVisited')}</th>
              <th>{t('visits')}</th>
            </tr>
          </thead>
          <tbody>
            {data?.report.map((row) => (
              <tr key={row.employeeId} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '0.5rem' }}>{row.employeeCode}</td>
                <td>
                  <Link to={`/employees/${row.employeeId}`}>{row.fullName}</Link>
                </td>
                <td>{row.department || '—'}</td>
                <td>{row.firstSeen ? new Date(row.firstSeen).toLocaleTimeString() : '—'}</td>
                <td>{row.lastSeen ? new Date(row.lastSeen).toLocaleTimeString() : '—'}</td>
                <td>{row.cameras.join(', ') || '—'}</td>
                <td>{row.visitCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data?.report?.length && <p style={{ padding: '1rem', color: 'var(--muted)' }}>{t('noMovements')}</p>}
      </div>

      <div className="card">
        <h3>{t('liveDetections')}</h3>
        <ul style={{ listStyle: 'none' }}>
          {liveEvents.map((e, i) => (
            <li key={i} style={{ padding: '0.35rem 0' }}>
              {new Date(e.at).toLocaleTimeString()} — {e.employeeName || t('unknown')} @ {e.cameraId}
            </li>
          ))}
          {recent?.events.slice(0, 15).map((ev) => (
            <li key={ev.id} style={{ padding: '0.35rem 0', fontSize: '0.9rem' }}>
              {new Date(ev.detectedAt).toLocaleString()} —{' '}
              {ev.isUnknown ? t('unknown') : ev.employee?.fullName} @ {ev.camera.name}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
