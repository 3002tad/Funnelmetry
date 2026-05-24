import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { clearSession, getStoredUser, getToken, setSession } from "../lib/auth.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getStoredUser);
  const [loading, setLoading] = useState(Boolean(getToken()));

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await api.login(email, password);
    setSession(data.token, data.user);
    setUser(data.user);
    return data.user;
  }, []);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api.me()
      .then((data) => {
        setUser(data.user);
        setSession(getToken(), data.user);
      })
      .catch(() => logout())
      .finally(() => setLoading(false));
  }, [logout]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isAuthenticated: Boolean(user) }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
