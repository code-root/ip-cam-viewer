import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { authApi } from '../api/client';
import { io, Socket } from 'socket.io-client';

interface User {
  id: string;
  username: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string, totpCode?: string) => Promise<void>;
  logout: () => void;
  socket: Socket | null;
  idleTimeoutMinutes: number;
  resetIdle: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = useState(30);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const logout = useCallback(() => {
    localStorage.clear();
    socket?.disconnect();
    setSocket(null);
    setUser(null);
    window.location.href = '/login';
  }, [socket]);

  const resetIdle = useCallback(() => {
    if (warnTimer.current) clearTimeout(warnTimer.current);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (!user) return;

    const ms = idleTimeoutMinutes * 60 * 1000;
    warnTimer.current = setTimeout(() => {
      alert('Session expiring soon due to inactivity');
    }, ms - 60000);
    idleTimer.current = setTimeout(logout, ms);
  }, [user, idleTimeoutMinutes, logout]);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      setLoading(false);
      return;
    }
    authApi
      .me()
      .then((data) => {
        setUser(data.user);
        setIdleTimeoutMinutes(data.idleTimeoutMinutes);
        const s = io(window.location.origin, { auth: { token } });
        setSocket(s);
      })
      .catch(() => localStorage.clear())
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    const handler = () => resetIdle();
    events.forEach((e) => window.addEventListener(e, handler));
    resetIdle();
    return () => events.forEach((e) => window.removeEventListener(e, handler));
  }, [user, resetIdle]);

  const login = async (username: string, password: string, totpCode?: string) => {
    const data = await authApi.login({ username, password, totpCode });
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    setUser(data.user);
    setIdleTimeoutMinutes(data.idleTimeoutMinutes);
    const s = io(window.location.origin, { auth: { token: data.accessToken } });
    setSocket(s);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, socket, idleTimeoutMinutes, resetIdle }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside provider');
  return ctx;
}
