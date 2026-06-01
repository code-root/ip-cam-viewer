import { BrowserRouter, Routes, Route, Navigate, NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Settings } from './pages/Settings';
import { Playback } from './pages/Playback';
import { Admin } from './pages/Admin';
import { Wall } from './pages/Wall';
import { Compare } from './pages/Compare';
import { FloorMap } from './pages/FloorMap';
import { Employees } from './pages/Employees';
import { EmployeeDetail } from './pages/EmployeeDetail';
import { Attendance } from './pages/Attendance';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: '2rem' }}>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function Layout() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <h2 style={{ marginBottom: '1rem', fontSize: '1rem' }}>{t('appTitle')}</h2>
        <NavLink to="/" end>{t('dashboard')}</NavLink>
        <NavLink to="/playback">{t('playback')}</NavLink>
        <NavLink to="/settings">{t('settings')}</NavLink>
        <NavLink to="/compare">{t('compare')}</NavLink>
        <NavLink to="/floor-map">{t('floorMap')}</NavLink>
        <NavLink to="/employees">{t('employees')}</NavLink>
        <NavLink to="/attendance">{t('attendance')}</NavLink>
        <NavLink to="/wall">{t('wall')}</NavLink>
        {user?.role === 'admin' && <NavLink to="/admin">{t('admin')}</NavLink>}
        <div style={{ flex: 1 }} />
        <button type="button" className="link" onClick={() => i18n.changeLanguage(i18n.language === 'ar' ? 'en' : 'ar')}>
          {i18n.language === 'ar' ? 'EN' : 'AR'}
        </button>
        <button type="button" className="link" onClick={logout}>{t('logout')}</button>
        <small style={{ color: 'var(--muted)' }}>{user?.username} ({user?.role})</small>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}

function WallLayout() {
  return <Outlet />;
}

export default function App() {
  const theme = localStorage.getItem('theme');
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/wall" element={<PrivateRoute><WallLayout /></PrivateRoute>}>
            <Route index element={<Wall />} />
          </Route>
          <Route
            element={
              <PrivateRoute>
                <Layout />
              </PrivateRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="playback" element={<Playback />} />
            <Route path="settings" element={<Settings />} />
            <Route path="admin" element={<Admin />} />
            <Route path="compare" element={<Compare />} />
            <Route path="floor-map" element={<FloorMap />} />
            <Route path="employees" element={<Employees />} />
            <Route path="employees/:id" element={<EmployeeDetail />} />
            <Route path="attendance" element={<Attendance />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
