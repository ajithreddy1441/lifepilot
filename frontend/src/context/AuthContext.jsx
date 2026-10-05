import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, setToken, getToken } from '../services/api';
import { connectEvents, disconnectEvents } from '../services/events';
import { sendConfigToWorker } from '../services/push';
import { registerThisDevice } from '../services/native/deviceRegistration';
import { setDisplayZone } from '../utils/format';
import { useTheme } from './ThemeContext';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [preferences, setPreferences] = useState(null);
  const [loading, setLoading] = useState(!!getToken());
  const { setTheme } = useTheme();

  const startSession = useCallback(
    async ({ user: u, token, preferences: p }) => {
      if (token) setToken(token);
      setUser(u);
      setPreferences(p);
      setDisplayZone(u.timezone);
      if (u.theme && !localStorage.getItem('lp_theme')) setTheme(u.theme);
      connectEvents();
      sendConfigToWorker();
      registerThisDevice().catch((err) => console.warn('Device registration failed', err));
    },
    [setTheme],
  );

  useEffect(() => {
    if (!getToken()) return;
    api
      .get('/auth/me')
      .then(startSession)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, [startSession]);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    setToken(null);
    disconnectEvents();
    setUser(null);
    setPreferences(null);
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      setToken(null);
      disconnectEvents();
      setUser(null);
    };
    window.addEventListener('lp:unauthorized', onUnauthorized);
    return () => window.removeEventListener('lp:unauthorized', onUnauthorized);
  }, []);

  const login = async (email, password) => startSession(await api.post('/auth/login', { email, password }));
  const register = async (data) =>
    startSession(await api.post('/auth/register', { ...data, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }));

  const updateUser = (u) => {
    setUser(u);
    setDisplayZone(u.timezone);
  };

  return (
    <AuthContext.Provider value={{ user, preferences, setPreferences, loading, login, register, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
