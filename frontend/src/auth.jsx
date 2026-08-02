import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api, { TOKEN_KEY, login as loginApi } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
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
    localStorage.setItem(TOKEN_KEY, token);
    setUser(user);
    return user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, ready, login, logout, isAdmin: user?.role === 'admin' }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
