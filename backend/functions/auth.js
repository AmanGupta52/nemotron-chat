import { getDb } from "./lib/db.js";
import { issueOtp, consumeOtp } from "./lib/otp.js";
import {
  authenticate,
  createSession,
  DUMMY_PASSWORD_HASH,
  expiredSessionCookie,
  hashPassword,
  HttpError,
  json,
  keyedDigest,
  publicUser,
  readJson,
  requestIp,
  requireAuth,
  requireSameOrigin,
  sessionCookie,
  validatePassword,
  verifyPassword,
  wantsBearer,
  withCors,
} from "./lib/security.js";
import { normalizeEmail, validateRegistration } from "./lib/validation.js";

const SESSION_COOKIE_HEADER = "Set-Cookie";
const passwordResetPurpose = "password-reset";
const emailVerificationPurpose = "email-verification";
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const HOUR_MS = 60 * 60 * 1000;

function errorResponse(error) {
  if (error instanceof HttpError) return json({ error: error.message, ...error.extra }, error.status);
  const message = error?.message;
  const configurationIssue = message === "MONGODB_URI is not configured."
    ? "MONGODB_URI is missing."
    : message === "AUTH_SECRET must contain at least 32 bytes."
      ? "AUTH_SECRET is missing or shorter than 32 bytes."
      : message === "EmailJS is not configured."
        ? "EmailJS configuration is incomplete."
        : typeof message === "string" && /\bquerySrv\b/.test(message) && /\bECONNREFUSED\b/.test(message)
          ? "MongoDB SRV DNS lookup was refused by the Node resolver."
        : undefined;
  const diagnostic = {
    name: typeof error?.name === "string" ? error.name.slice(0, 80) : "Error",
    ...(Number.isInteger(error?.code) || (typeof error?.code === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(error.code))
      ? { code: error.code }
      : {}),
    ...(configurationIssue ? { configurationIssue } : {}),
  };
  console.error("Authentication request failed.", diagnostic);
  return json({ error: "The authentication service is temporarily unavailable." }, 500);
}

async function establishSession(req, user) {
  const { token } = await createSession(user);
  // Mobile / cross-origin clients get the token in the body; browsers get an HttpOnly cookie.
  if (wantsBearer(req)) return json({ user: publicUser(user), token });
  return json({ user: publicUser(user) }, 200, { [SESSION_COOKIE_HEADER]: sessionCookie(req, token) });
}

async function enforceRateLimit(db, action, req, limit, windowMs) {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs);
  const key = keyedDigest(`${action}:${requestIp(req)}:${windowStart}`, "auth-rate-limit");
  try {
    await db.collection("authRateLimits").updateOne(
      { _id: key, count: { $lt: limit } },
      {
        $inc: { count: 1 },
        $setOnInsert: { expiresAt: new Date((windowStart + 2) * windowMs) },
      },
      { upsert: true },
    );
  } catch (error) {
    if (error?.code === 11000) throw new HttpError(429, "Too many requests. Please try again later.");
    throw error;
  }
}

async function checkLoginLimit(db, email, req) {
  const key = keyedDigest(`${email}:${requestIp(req)}`, "login-attempts");
  const record = await db.collection("loginAttempts").findOne({ _id: key, expiresAt: { $gt: new Date() } });
  if (record?.attempts >= LOGIN_MAX_ATTEMPTS) {
    throw new HttpError(429, "Too many sign-in attempts. Try again in 15 minutes.");
  }
  return key;
}

async function recordLoginFailure(db, key) {
  const now = new Date();
  await db.collection("loginAttempts").updateOne(
    { _id: key },
    [{
      $set: {
        attempts: {
          $cond: [
            { $gt: ["$expiresAt", now] },
            { $add: [{ $ifNull: ["$attempts", 0] }, 1] },
            1,
          ],
        },
        expiresAt: {
          $cond: [
            { $gt: ["$expiresAt", now] },
            "$expiresAt",
            new Date(now.getTime() + LOGIN_WINDOW_MS),
          ],
        },
      },
    }],
    { upsert: true },
  );
}

async function register(req, body) {
  const fields = validateRegistration(body);
  validatePassword(body.password);
  if (body.password !== body.confirmPassword) throw new HttpError(400, "Passwords do not match.");
  const db = await getDb();
  await enforceRateLimit(db, "register", req, 10, HOUR_MS);
  const users = db.collection("users");
  if (await users.findOne({ $or: [{ email: fields.email }, { username: fields.username }] }, { projection: { _id: 1 } })) {
    throw new HttpError(409, "That email or username is already in use.");
  }

  const now = new Date();
  const user = {
    ...fields,
    passwordHash: await hashPassword(body.password),
    emailVerified: false,
    avatar: null,
    preferences: { theme: "system" },
    createdAt: now,
    updatedAt: now,
  };
  try {
    const result = await users.insertOne(user);
    user._id = result.insertedId;
  } catch (error) {
    if (error?.code === 11000) throw new HttpError(409, "That email or username is already in use.");
    throw error;
  }
  try {
    await issueOtp(user, emailVerificationPurpose);
  } catch {
    throw new HttpError(
      502,
      "Your account was created, but the verification email could not be sent. Use Resend code to try again.",
      { email: user.email, verificationRequired: true },
    );
  }
  return json({ message: "Check your email for the verification code.", email: user.email }, 201);
}

async function verifyEmail(req, body) {
  const email = normalizeEmail(body.email);
  const db = await getDb();
  await enforceRateLimit(db, "verify-email", req, 30, LOGIN_WINDOW_MS);
  const user = await db.collection("users").findOne({ email });
  if (!user || user.emailVerified) throw new HttpError(400, "The code is invalid or expired.");
  await consumeOtp(user, emailVerificationPurpose, body.code);
  const now = new Date();
  const updated = await db.collection("users").findOneAndUpdate(
    { _id: user._id, emailVerified: false },
    { $set: { emailVerified: true, updatedAt: now, lastLoginAt: now } },
    { returnDocument: "after" },
  );
  const verifiedUser = updated?.value || updated;
  if (!verifiedUser?.emailVerified) throw new HttpError(409, "This account has already been verified. Please sign in.");
  return establishSession(req, verifiedUser);
}

async function resendVerification(req, body) {
  const email = normalizeEmail(body.email);
  const db = await getDb();
  await enforceRateLimit(db, "resend-verification", req, 8, HOUR_MS);
  const user = await db.collection("users").findOne({ email, emailVerified: false });
  if (user) {
    try {
      await issueOtp(user, emailVerificationPurpose);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, "The verification email could not be sent. Please try again later.");
    }
  }
  return json({ message: "If the account needs verification, a code has been sent." });
}

async function login(req, body) {
  const email = normalizeEmail(body.email);
  const db = await getDb();
  await enforceRateLimit(db, "login-ip", req, 50, LOGIN_WINDOW_MS);
  const attemptKey = await checkLoginLimit(db, email, req);
  const user = await db.collection("users").findOne({ email });
  const password = typeof body.password === "string" ? body.password : "";
  const valid = await verifyPassword(password, user ? user.passwordHash : DUMMY_PASSWORD_HASH) && Boolean(user);
  if (!valid) {
    await recordLoginFailure(db, attemptKey);
    throw new HttpError(401, "Email or password is incorrect.");
  }
  if (!user.emailVerified) {
    try {
      await issueOtp(user, emailVerificationPurpose);
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 429) {
        throw new HttpError(502, "Your email is not verified, and a code could not be sent. Please try again later.");
      }
    }
    throw new HttpError(403, "Verify your email before signing in.", { verificationRequired: true, email: user.email });
  }
  await db.collection("loginAttempts").deleteOne({ _id: attemptKey });
  const now = new Date();
  const updated = await db.collection("users").findOneAndUpdate(
    { _id: user._id, emailVerified: true, status: { $ne: "deleting" } },
    { $set: { lastLoginAt: now, updatedAt: now } },
    { returnDocument: "after", projection: { passwordHash: 0 } },
  );
  const loggedInUser = updated?.value || updated;
  if (!loggedInUser) throw new HttpError(401, "Email or password is incorrect.");
  return establishSession(req, loggedInUser);
}

async function forgotPassword(req, body) {
  const email = normalizeEmail(body.email);
  const db = await getDb();
  await enforceRateLimit(db, "forgot-password", req, 8, HOUR_MS);
  const user = await db.collection("users").findOne({ email, emailVerified: true });
  if (user) {
    try {
      await issueOtp(user, passwordResetPurpose);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, "The reset email could not be sent. Please try again later.");
    }
  }
  return json({ message: "If a verified account exists for that email, a reset code has been sent." });
}

async function resetPassword(req, body) {
  const email = normalizeEmail(body.email);
  validatePassword(body.password);
  if (body.password !== body.confirmPassword) throw new HttpError(400, "Passwords do not match.");
  const db = await getDb();
  await enforceRateLimit(db, "reset-password", req, 20, LOGIN_WINDOW_MS);
  const user = await db.collection("users").findOne({ email, emailVerified: true });
  if (!user) throw new HttpError(400, "The code is invalid or expired.");
  await consumeOtp(user, passwordResetPurpose, body.code);
  const passwordHash = await hashPassword(body.password);
  const now = new Date();
  const updated = await db.collection("users").findOneAndUpdate(
    { _id: user._id, emailVerified: true, status: { $ne: "deleting" } },
    { $set: { passwordHash, updatedAt: now } },
    { returnDocument: "after", projection: { passwordHash: 0 } },
  );
  const resetUser = updated?.value || updated;
  if (!resetUser) throw new HttpError(400, "The code is invalid or expired.");
  await db.collection("sessions").deleteMany({ userId: user._id });
  return establishSession(req, resetUser);
}

async function changePassword(req, body) {
  const { user } = await requireAuth(req);
  validatePassword(body.newPassword);
  if (body.newPassword !== body.confirmPassword) throw new HttpError(400, "Passwords do not match.");
  const db = await getDb();
  const stored = await db.collection("users").findOne({ _id: user._id });
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  if (!stored || !(await verifyPassword(currentPassword, stored.passwordHash))) {
    throw new HttpError(400, "Current password is incorrect.");
  }
  const passwordHash = await hashPassword(body.newPassword);
  await db.collection("users").updateOne({ _id: user._id }, { $set: { passwordHash, updatedAt: new Date() } });
  await db.collection("sessions").deleteMany({ userId: user._id });
  const updatedUser = await db.collection("users").findOne({ _id: user._id }, { projection: { passwordHash: 0 } });
  return establishSession(req, updatedUser);
}

async function handler(req) {
  try {
    if (req.method === "GET") {
      const auth = await authenticate(req);
      if (!auth) return json({ error: "Please sign in to continue." }, 401);
      return json({ user: publicUser(auth.user) });
    }
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
    requireSameOrigin(req);
    const body = await readJson(req);
    switch (body?.action) {
      case "register":
        return await register(req, body);
      case "verify-email":
        return await verifyEmail(req, body);
      case "resend-verification":
        return await resendVerification(req, body);
      case "login":
        return await login(req, body);
      case "logout": {
        const auth = await authenticate(req);
        if (auth) await (await getDb()).collection("sessions").deleteOne({ _id: auth.session._id });
        return json({ message: "Signed out." }, 200, { [SESSION_COOKIE_HEADER]: expiredSessionCookie(req) });
      }
      case "forgot-password":
        return await forgotPassword(req, body);
      case "reset-password":
        return await resetPassword(req, body);
      case "change-password":
        return await changePassword(req, body);
      default:
        throw new HttpError(400, "Choose a valid authentication action.");
    }
  } catch (error) {
    return errorResponse(error);
  }
}

export default withCors(handler);
