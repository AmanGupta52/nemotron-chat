import { getDb } from "./lib/db.js";
import {
  HttpError,
  expiredSessionCookie,
  json,
  publicUser,
  readJson,
  requireAuth,
  requireSameOrigin,
  verifyPassword,
  withCors,
} from "./lib/security.js";
import { validateProfileName } from "./lib/validation.js";

function errorResponse(error) {
  if (error instanceof HttpError) return json({ error: error.message, ...error.extra }, error.status);
  console.error("Account request failed.", error?.name || "Error", String(error?.message || "").slice(0, 300));
  return json({ error: "The account service is temporarily unavailable." }, 500);
}

async function handler(req) {
  try {
    if (req.method === "GET") {
      const { user } = await requireAuth(req);
      return json({ user: publicUser(user) });
    }
    if (!["PATCH", "DELETE"].includes(req.method)) return json({ error: "Method not allowed." }, 405);
    requireSameOrigin(req);
    const { user } = await requireAuth(req);
    const body = await readJson(req);
    const db = await getDb();

    if (req.method === "PATCH") {
      const updates = { updatedAt: new Date() };
      if (body.name !== undefined) updates.name = validateProfileName(body.name);
      if (body.username !== undefined) {
        const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
        if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
          throw new HttpError(400, "Username must be 3–32 characters using letters, numbers, dots, underscores, or hyphens.");
        }
        updates.username = username;
      }
      if (body.preferences !== undefined) {
        if (!body.preferences || !["system", "light", "dark"].includes(body.preferences.theme)) {
          throw new HttpError(400, "Choose a valid theme preference.");
        }
        updates.preferences = { ...user.preferences, theme: body.preferences.theme };
      }
      if (Object.keys(updates).length === 1) throw new HttpError(400, "No profile changes were provided.");
      try {
        await db.collection("users").updateOne({ _id: user._id }, { $set: updates });
      } catch (error) {
        if (error?.code === 11000) throw new HttpError(409, "That username is already in use.");
        throw error;
      }
      const updated = await db.collection("users").findOne({ _id: user._id }, { projection: { passwordHash: 0 } });
      return json({ user: publicUser(updated) });
    }

    if (body.confirmation !== "DELETE") throw new HttpError(400, "Type DELETE to confirm account deletion.");
    const stored = await db.collection("users").findOne({ _id: user._id });
    if (!stored || !(await verifyPassword(body.password || "", stored.passwordHash))) {
      throw new HttpError(400, "Password is incorrect.");
    }

    await db.collection("users").updateOne({ _id: user._id }, { $set: { status: "deleting", updatedAt: new Date() } });
    await db.collection("sessions").deleteMany({ userId: user._id });
    await db.collection("challenges").deleteMany({ userId: user._id });
    await db.collection("conversations").deleteMany({ userId: user._id });
    await db.collection("messages").deleteMany({ userId: user._id });
    await db.collection("users").deleteOne({ _id: user._id });
    return json({ message: "Account and associated private data deleted." }, 200, {
      "Set-Cookie": expiredSessionCookie(req),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export default withCors(handler);
