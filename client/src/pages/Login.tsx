import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';

export function Login() {
  const { t, i18n } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [totpCode, setTotpCode] = useState('');
  const [needs2FA, setNeeds2FA] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await login(username, password, totpCode || undefined);
      navigate('/');
    } catch (err) {
      const msg = String(err);
      if (msg.includes('2FA')) setNeeds2FA(true);
      setError(msg);
    }
  };

  return (
    <div className="login-page">
      <div className="card login-card">
        <h1>{t('appTitle')}</h1>
        <form onSubmit={submit}>
          <div className="form-group">
            <label>{t('username')}</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
          </div>
          <div className="form-group">
            <label>{t('password')}</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </div>
          {needs2FA && (
            <div className="form-group">
              <label>{t('totpCode')}</label>
              <input value={totpCode} onChange={(e) => setTotpCode(e.target.value)} />
            </div>
          )}
          {error && <p style={{ color: 'var(--danger)', marginBottom: '1rem' }}>{error}</p>}
          <button type="submit" className="btn" style={{ width: '100%' }}>
            {t('login')}
          </button>
        </form>
        <p style={{ marginTop: '1rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
          <button type="button" className="btn btn-ghost" onClick={() => i18n.changeLanguage(i18n.language === 'ar' ? 'en' : 'ar')}>
            {i18n.language === 'ar' ? 'English' : 'العربية'}
          </button>
        </p>
      </div>
    </div>
  );
}
