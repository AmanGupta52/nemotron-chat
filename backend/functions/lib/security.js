import {
  createHmac,
  randomBytes,
  randomInt,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { getDb } from "./db.js";

const scrypt = promisify(scryptCallback);
const SESSION_DAYS = 30;
const SESSION_COOKIE = "workbench_session";
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

export async function readJson(req) {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

// Origins that may call the API besides the API's own origin: the Capacitor mobile app's WebView
// origins plus anything listed in ALLOWED_ORIGINS (comma-separated) or WEB_ORIGIN / Netlify's URL.
const APP_ORIGINS = ["https://localhost", "http://localhost", "capacitor://localhost", "ionic://localhost"];

export function allowedOrigins() {
  const clean = (value) => String(value || "").trim().replace(/\/+$/, "");
  const configured = (process.env.ALLOWED_ORIGINS || "").split(",").map(clean).filter(Boolean);
  const site = [process.env.URL, process.env.WEB_ORIGIN].map(clean).filter(Boolean);
  return new Set([...APP_ORIGINS, ...configured, ...site]);
}

function isAllowedOrigin(req, origin) {
  if (allowedOrigins().has(origin)) return true;
  try {
    // Compare hosts, not schemes: behind a TLS-terminating proxy the server may see http:// while the
    // browser's Origin is https:// for the very same site.
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

export function requireSameOrigin(req) {
  const origin = req.headers.get("origin");
  if (!origin) throw new HttpError(403, "A same-origin request is required.");
  if (!isAllowedOrigin(req, origin)) throw new HttpError(403, "This origin is not allowed to call the API.");
}

export function corsHeaders(req) {
  const origin = req.headers.get("origin");
  if (!origin || !isAllowedOrigin(req, origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Auth-Mode, Accept",
    "Access-Control-Expose-Headers": "X-Conversation-Id",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// Wraps a request handler with CORS preflight handling and CORS response headers.
export function withCors(handler) {
  return async (req, context) => {
    const cors = corsHeaders(req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const response = await handler(req, context);
    if (!Object.keys(cors).length) return response;
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(cors)) headers.set(name, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };
}

// Client address used for rate limiting. Netlify sets x-nf-client-connection-ip; server.js sets
// x-client-ip (and strips any value a client sent itself).
export function requestIp(req) {
  return req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-client-ip") || "unknown";
}

function authSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32 || secret.includes("REPLACE_WITH")) {
    throw new Error("AUTH_SECRET must contain at least 32 bytes.");
  }
  return secret;
}

export function keyedDigest(value, purpose = "token") {
  return createHmac("sha256", authSecret()).update(`${purpose}:${value}`).digest("hex");
}

export function secureEqualHex(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || !/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function createOtp() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function createOpaqueToken() {
  return randomBytes(32).toString("base64url");
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, SCRYPT_OPTIONS);
  return `scrypt$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${salt.toString("hex")}$${Buffer.from(derived).toString("hex")}`;
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== "string" || typeof encoded !== "string") return false;
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt" || parts[1] !== "16384" || parts[2] !== "8" || parts[3] !== "1") {
    return false;
  }
  if (!/^[a-f0-9]{32}$/i.test(parts[4]) || !/^[a-f0-9]{128}$/i.test(parts[5])) return false;
  const expected = Buffer.from(parts[5], "hex");
  const actual = Buffer.from(await scrypt(password, Buffer.from(parts[4], "hex"), expected.length, SCRYPT_OPTIONS));
  return timingSafeEqual(actual, expected);
}

export const DUMMY_PASSWORD_HASH = `scrypt$16384$8$1$${"0".repeat(32)}$${"0".repeat(128)}`;

export function validatePassword(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 128) {
    throw new HttpError(400, "Password must be between 12 and 128 characters.");
  }
}

// Mobile / cross-origin clients send "X-Auth-Mode: bearer" and receive the session token in the JSON body
// instead of a cookie (cookies are not sent between the app's origin and the API origin).
export function wantsBearer(req) {
  return req.headers.get("x-auth-mode") === "bearer";
}

function bearerToken(req) {
  const match = /^Bearer\s+([A-Za-z0-9_-]{20,100})$/.exec(req.headers.get("authorization") || "");
  return match ? match[1] : "";
}

function cookieValue(req) {
  const cookie = req.headers.get("cookie") || "";
  const item = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (!item) return "";
  try {
    return decodeURIComponent(item.slice(SESSION_COOKIE.length + 1));
  } catch {
    return "";
  }
}

export function sessionCookie(req, token) {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 24 * 60 * 60}${secure}`;
}

export function expiredSessionCookie(req) {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

export async function createSession(user) {
  const token = createOpaqueToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const db = await getDb();
  await db.collection("sessions").insertOne({
    tokenHash: keyedDigest(token, "session"),
    userId: user._id,
    createdAt: now,
    expiresAt,
  });
  return { token, expiresAt };
}

export async function authenticate(req) {
  const token = bearerToken(req) || cookieValue(req);
  if (!token) return null;
  const tokenHash = keyedDigest(token, "session");
  const db = await getDb();
  const session = await db.collection("sessions").findOne({
    tokenHash,
    expiresAt: { $gt: new Date() },
  });
  if (!session) return null;
  const user = await db.collection("users").findOne({
    _id: session.userId,
    status: { $ne: "deleting" },
  }, { projection: { passwordHash: 0 } });
  if (!user || !user.emailVerified) return null;
  return { user, session, token, tokenHash };
}

export async function requireAuth(req) {
  const auth = await authenticate(req);
  if (!auth) throw new HttpError(401, "Please sign in to continue.");
  return auth;
}

export function publicUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    username: user.username,
    email: user.email,
    emailVerified: Boolean(user.emailVerified),
    avatar: user.avatar || null,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null,
    preferences: user.preferences || { theme: "system" },
  };
}

export function isValidId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
