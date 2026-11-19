import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiRequest, AUTH_API, tokenStore } from "./api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await apiRequest(AUTH_API);
      setUser(data.user || null);
      return data.user || null;
    } catch (error) {
      if (error.status === 401) {
        tokenStore.clear();
        setUser(null);
        return null;
      }
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh().catch(() => setUser(null)); }, [refresh]);

  // Any API call that comes back 401 (session expired or revoked) signs the user out locally.
  useEffect(() => {
    const onUnauthorized = () => { tokenStore.clear(); setUser(null); };
    window.addEventListener("workbench-unauthorized", onUnauthorized);
    return () => window.removeEventListener("workbench-unauthorized", onUnauthorized);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest(AUTH_API, { method: "POST", body: { action: "logout" } });
    } finally {
      tokenStore.clear();
      setUser(null);
    }
  }, []);

  const setAuthenticatedUser = useCallback((next) => {
    if (!next) tokenStore.clear();
    setUser(next);
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    refresh,
    setAuthenticatedUser,
    logout,
  }), [user, loading, refresh, setAuthenticatedUser, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}
