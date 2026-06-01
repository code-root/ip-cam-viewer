import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';

export function Admin() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: users } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api<{ users: Array<{ id: string; username: string; role: string }> }>('/admin/users'),
  });
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'viewer' });

  const createUser = useMutation({
    mutationFn: () => api('/admin/users', { method: 'POST', body: JSON.stringify(newUser) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      setNewUser({ username: '', password: '', role: 'viewer' });
    },
  });

  const setup2FA = async () => {
    const r = await api<{ qrCode: string }>('/auth/2fa/setup', { method: 'POST' });
    window.open(r.qrCode, '_blank');
    const code = prompt('Enter 6-digit code from app');
    if (code) await api('/auth/2fa/verify', { method: 'POST', body: JSON.stringify({ code }) });
    alert('2FA enabled');
  };

  const backup = () => api('/system/backup', { method: 'POST' }).then((r) => alert(JSON.stringify(r)));
  const exportCfg = () => window.open('/api/system/export', '_blank');

  return (
    <div>
      <h2>{t('admin')}</h2>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3>{t('users')}</h3>
        {users?.users.map((u) => (
          <div key={u.id} style={{ padding: '0.35rem 0' }}>
            {u.username} — <span className="badge">{u.role}</span>
          </div>
        ))}
        <div style={{ marginTop: '1rem' }}>
          <input placeholder={t('username')} value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} />
          <input type="password" placeholder={t('password')} value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} style={{ margin: '0 0.5rem' }} />
          <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
            <option value="viewer">viewer</option>
            <option value="operator">operator</option>
            <option value="admin">admin</option>
          </select>
          <button type="button" className="btn" onClick={() => createUser.mutate()}>+</button>
        </div>
      </div>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3>2FA</h3>
        <button type="button" className="btn btn-ghost" onClick={setup2FA}>Setup 2FA</button>
      </div>
      <div className="card">
        <h3>{t('backup')}</h3>
        <button type="button" className="btn btn-ghost" onClick={backup}>{t('backup')}</button>
        <button type="button" className="btn btn-ghost" onClick={exportCfg}>{t('export')}</button>
      </div>
      <NotificationsSection />
    </div>
  );
}

function NotificationsSection() {
  const { t } = useTranslation();
  const [form, setForm] = useState({ name: 'Webhook', type: 'webhook', url: '' });

  const create = async () => {
    await api('/notifications/channels', {
      method: 'POST',
      body: JSON.stringify({ name: form.name, type: form.type, config: { url: form.url }, events: ['motion', 'offline'] }),
    });
    alert('Created');
  };

  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <h3>{t('notifications')}</h3>
      <input placeholder="Webhook URL" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} style={{ width: '100%', marginBottom: '0.5rem' }} />
      <button type="button" className="btn btn-ghost" onClick={create}>{t('save')}</button>
    </div>
  );
}
