import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, camerasApi } from '../api/client';
import { EnrollFromCamera } from '../components/EnrollFromCamera';
import { useAuth } from '../context/AuthContext';

interface Employee {
  id: string;
  employeeCode: string;
  fullName: string;
  department?: string;
  notes?: string | null;
  isActive: boolean;
  faceProfiles: Array<{ id: string; label: string }>;
  _count: { movementLogs: number };
}

export function Employees() {
  const { t } = useTranslation();
  const { user, socket } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    if (!socket) return;
    const onAuto = () => void qc.invalidateQueries({ queryKey: ['employees'] });
    socket.on('employee:auto_created', onAuto);
    return () => { socket.off('employee:auto_created', onAuto); };
  }, [socket, qc]);
  const canManage = user?.role === 'admin' || user?.role === 'operator';

  const { data: status } = useQuery({
    queryKey: ['face-status'],
    queryFn: () => api<{ available: boolean; error?: string }>('/employees/status'),
    retry: 1,
  });

  const {
    data,
    error: listError,
    isError: listIsError,
  } = useQuery({
    queryKey: ['employees'],
    queryFn: () => api<{ employees: Employee[] }>('/employees'),
    retry: 1,
  });

  const { data: camerasData } = useQuery({
    queryKey: ['cameras'],
    queryFn: camerasApi.list,
    enabled: canManage,
  });

  const [form, setForm] = useState({ employeeCode: '', fullName: '', department: '', jobTitle: '' });
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [enrollSuccess, setEnrollSuccess] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api('/employees', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      setForm({ employeeCode: '', fullName: '', department: '', jobTitle: '' });
    },
  });

  const enroll = async (employeeId: string, file: File) => {
    setEnrollError(null);
    const fd = new FormData();
    fd.append('photo', file);
    const token = localStorage.getItem('accessToken');
    const res = await fetch(`/api/employees/${employeeId}/enroll-face`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = 'Enroll failed';
      try {
        if (text.trim()) msg = JSON.parse(text).error || msg;
      } catch { /* ignore */ }
      if (msg.includes('NO_FACE_DETECTED')) throw new Error(t('enrollNoFace'));
      if (msg.includes('FACE_DETECT_FAILED')) throw new Error(t('enrollNoFace'));
      throw new Error(msg.replace(/^Error:\s*/gi, ''));
    }
    qc.invalidateQueries({ queryKey: ['employees'] });
  };

  return (
    <div>
      <h2>{t('employees')}</h2>
      <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
        {status?.available ? t('faceReady') : t('faceNotReady')}
        {status?.error && ` — ${status.error}`}
      </p>
      {status?.available ? (
        <p className="form-hint" style={{ marginBottom: '1rem' }}>
          {t('autoEnrolledHint')} — {t('enrollFromCameraHint')}
        </p>
      ) : status?.error ? (
        <p className="test-result--fail-inline" style={{ marginBottom: '1rem' }} dir="ltr">
          {status.error}
        </p>
      ) : null}

      {listIsError && (
        <div className="test-result test-result--fail" style={{ marginBottom: '1rem' }} role="alert">
          <strong>{String(listError)}</strong>
        </div>
      )}

      {enrollSuccess && (
        <div className="test-result test-result--ok" style={{ marginBottom: '1rem' }} role="status">
          <strong>{enrollSuccess}</strong>
        </div>
      )}

      {enrollError && (
        <div className="test-result test-result--fail" style={{ marginBottom: '1rem' }} role="alert">
          <strong>{enrollError}</strong>
        </div>
      )}

      {canManage && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h3>{t('addEmployee')}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem' }}>
            <input placeholder={t('employeeCode')} value={form.employeeCode} onChange={(e) => setForm({ ...form, employeeCode: e.target.value })} />
            <input placeholder={t('fullName')} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            <input placeholder={t('department')} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
            <button type="button" className="btn" onClick={() => create.mutate()}>{t('save')}</button>
          </div>
        </div>
      )}

      <div className="card">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'right', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '0.5rem' }}>{t('employeeCode')}</th>
              <th>{t('fullName')}</th>
              <th>{t('department')}</th>
              <th>{t('faces')}</th>
              <th>{t('movements')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data?.employees.map((emp) => (
              <tr key={emp.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '0.5rem' }}>{emp.employeeCode}</td>
                <td>
                  {emp.fullName}
                  {emp.notes === 'auto-enrolled' && (
                    <span className="badge badge-new" style={{ marginInlineStart: '0.35rem' }}>{t('autoEnrolledBadge')}</span>
                  )}
                </td>
                <td>{emp.department || '—'}</td>
                <td>{emp.faceProfiles.length}</td>
                <td>{emp._count.movementLogs}</td>
                <td>
                  <Link to={`/employees/${emp.id}`} className="btn btn-ghost" style={{ display: 'inline-block', marginLeft: '0.35rem' }}>
                    {t('details')}
                  </Link>
                  {canManage && (
                    <>
                      <label className="btn btn-ghost" style={{ cursor: 'pointer', marginRight: '0.35rem' }}>
                        {t('enrollFace')}
                        <input
                          type="file"
                          accept="image/*"
                          hidden
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) enroll(emp.id, file).catch((err) => setEnrollError(String(err)));
                            e.target.value = '';
                          }}
                        />
                      </label>
                      {camerasData?.cameras && camerasData.cameras.length > 0 && (
                        <EnrollFromCamera
                          employeeId={emp.id}
                          cameras={camerasData.cameras}
                          onDone={() => {
                            setEnrollError(null);
                            setEnrollSuccess(t('enrollFromCameraOk'));
                            void qc.invalidateQueries({ queryKey: ['employees'] });
                          }}
                          onError={(msg) => {
                            setEnrollSuccess(null);
                            setEnrollError(msg);
                          }}
                        />
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
