import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiRequest, AUTH_API, tokenStore } from "./api.js";
import { cacheUser, clearCache, getCachedUser } from "../lib/offlineCache.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // A user remembered from the last visit lets the app open instantly (and offline); the server confirms in the background.
  const [user, setUser] = useState(() => getCachedUser());
  const [loading, setLoading] = useState(() => !getCachedUser());
  const [connectionError, setConnectionError] = useState(false);
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(async () => {
    // A sleeping free-tier server can need ~50 s to wake up, so allow a generous timeout.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 70_000);
    try {
      const data = await apiRequest(AUTH_API, { signal: controller.signal });
      setConnectionError(false);
      setOffline(false);
      if (data.user) cacheUser(data.user);
      setUser(data.user || null);
      return data.user || null;
    } catch (error) {
      if (error.status === 401) {
        tokenStore.clear();
        clearCache();
        setConnectionError(false);
        setUser(null);
        return null;
      }
      const remembered = getCachedUser();
      if (remembered) {
        // No connection (or the server is asleep): stay signed in and show the saved chats.
        setUser(remembered);
        setOffline(true);
        setConnectionError(false);
        return remembered;
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

  // Connection came back: confirm the session again.
  useEffect(() => {
    const onOnline = () => { refresh().catch(() => {}); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [refresh]);

  // Any API call that comes back 401 (session expired or revoked) signs the user out locally.
  useEffect(() => {
    const onUnauthorized = () => { tokenStore.clear(); clearCache(); setUser(null); };
    window.addEventListener("workbench-unauthorized", onUnauthorized);
    return () => window.removeEventListener("workbench-unauthorized", onUnauthorized);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest(AUTH_API, { method: "POST", body: { action: "logout" } });
    } finally {
      tokenStore.clear();
      clearCache();
      setUser(null);
    }
  }, []);

  const setAuthenticatedUser = useCallback((next) => {
    if (!next) { tokenStore.clear(); clearCache(); } else cacheUser(next);
    setUser(next);
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    connectionError,
    offline,
    setOffline,
    retry,
    refresh,
    setAuthenticatedUser,
    logout,
  }), [user, loading, connectionError, offline, retry, refresh, setAuthenticatedUser, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}
