// API client.
//
// Website (same origin as the API): relative URLs + HttpOnly session cookie.
// Mobile app / separately hosted site: set VITE_API_BASE_URL at build time. Requests then go to that
// origin and authenticate with a Bearer token kept in the app's private storage, because cookies are
// not sent between the app's origin (https://localhost) and the API origin.

export class ApiError extends Error {
  constructor(message, status, data = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export const IS_NATIVE = typeof window !== "undefined" && Boolean(window.Capacitor?.isNativePlatform?.());
export const API_BASE = String(import.meta.env?.VITE_API_BASE_URL || "").trim().replace(/\/+$/, "");
export const USE_BEARER = Boolean(API_BASE);

const TOKEN_KEY = "nemotron-workbench-token";
export const tokenStore = {
  get() { try { return window.localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } },
  set(token) { try { window.localStorage.setItem(TOKEN_KEY, token); } catch { /* storage unavailable */ } },
  clear() { try { window.localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ } },
};

export const NOT_CONFIGURED = "This app was built without an API address. Set the API_BASE_URL repository variable (or VITE_API_BASE_URL) and rebuild.";

// fetch() with the right base URL and credentials. Used directly for streaming and the model list.
export function apiFetch(path, { headers = {}, ...init } = {}) {
  if (IS_NATIVE && !API_BASE) return Promise.reject(new ApiError(NOT_CONFIGURED, 0));
  const auth = {};
  if (USE_BEARER) {
    auth["X-Auth-Mode"] = "bearer";
    const token = tokenStore.get();
    if (token) auth.Authorization = `Bearer ${token}`;
  }
  return fetch(`${API_BASE}${path}`, {
    credentials: USE_BEARER ? "omit" : "same-origin",
    ...init,
    headers: { ...auth, ...headers },
  }).then((response) => {
    // A 401 from any endpoint except the sign-in endpoint itself means the session expired or was revoked.
    if (response.status === 401 && !path.startsWith(AUTH_API)) {
      window.dispatchEvent(new Event("workbench-unauthorized"));
    }
    return response;
  });
}

export async function apiRequest(url, { method = "GET", body, headers = {}, signal } = {}) {
  const response = await apiFetch(url, {
    method,
    signal,
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(data.error || `Request failed (${response.status}).`, response.status, data);
  }
  if (USE_BEARER && typeof data.token === "string") tokenStore.set(data.token);
  return data;
}

export const AUTH_API = "/.netlify/functions/auth";
export const ACCOUNT_API = "/.netlify/functions/account";
export const CONVERSATIONS_API = "/.netlify/functions/conversations";
export const MODELS_API = "/.netlify/functions/models";
export const CHAT_API = "/.netlify/functions/chat";
