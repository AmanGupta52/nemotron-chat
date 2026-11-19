import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiRequest, AUTH_API, tokenStore } from "./api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState(false);

  const refresh = useCallback(async () => {
    // A sleeping free-tier server can need ~50 s to wake up, so allow a generous timeout.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 70_000);
    try {
      const data = await apiRequest(AUTH_API, { signal: controller.signal });
      setConnectionError(false);
      setUser(data.user || null);
      return data.user || null;
    } catch (error) {
      if (error.status === 401) {
        tokenStore.clear();
        setConnectionError(false);
        setUser(null);
        return null;
      }
      setConnectionError(true);
      throw error;
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }, []);

  const retry = useCallback(() => {
    setLoading(true);
    refresh().catch(() => setUser(null));
  }, [refresh]);

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
    connectionError,
    retry,
    refresh,
    setAuthenticatedUser,
    logout,
  }), [user, loading, connectionError, retry, refresh, setAuthenticatedUser, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}
