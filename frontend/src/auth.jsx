import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api, { login as loginApi, register as registerApi } from './api.js';
import { getToken, setToken, clearToken } from './ui.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setReady(true);
      return;
    }
    api
      .get('/auth/me')
      .then((r) => setUser(r.data.user || null))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  // A 401 response clears the token in api.js; sync the UI state here.
  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  const login = useCallback(async (username, password) => {
    const { token, user } = await loginApi(username, password);
    setToken(token);
    setUser(user);
    return user;
  }, []);

  // 注册即登录：后端核验验证码后直接返回 { token, user }。
  const register = useCallback(async (payload) => {
    const { token, user } = await registerApi(payload);
    setToken(token);
    setUser(user);
    return user;
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, ready, login, register, logout, isAdmin: user?.role === 'admin' }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
