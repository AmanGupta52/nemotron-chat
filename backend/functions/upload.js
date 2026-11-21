import { getDb } from "./lib/db.js";
import { HttpError, json, requireAuth, requireSameOrigin, withCors } from "./lib/security.js";
import { cloudinaryConfigured, uploadToCloudinary } from "./lib/cloudinary.js";

const MAX_BYTES = (Number(process.env.UPLOAD_MAX_MB) || 10) * 1024 * 1024; // Cloudinary's free plan allows 10 MB per file
const UPLOAD_LIMIT = 30;
const UPLOAD_WINDOW_MS = 10 * 60 * 1000;

async function enforceUploadLimit(db, userId) {
  const windowStart = Math.floor(Date.now() / UPLOAD_WINDOW_MS);
  try {
    await db.collection("authRateLimits").updateOne(
      { _id: `upload:${userId}:${windowStart}`, count: { $lt: UPLOAD_LIMIT } },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((windowStart + 2) * UPLOAD_WINDOW_MS) } },
      { upsert: true },
    );
  } catch (error) {
    if (error?.code === 11000) throw new HttpError(429, "You are uploading too quickly. Please wait a few minutes.");
    throw error;
  }
}

async function handler(req) {
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed. Use POST.");
    requireSameOrigin(req);
    const { user } = await requireAuth(req);
    if (!cloudinaryConfigured()) throw new HttpError(500, "File storage is not configured (set CLOUDINARY_URL on the server).");

    let file;
    try {
      file = (await req.formData()).get("file");
    } catch {
      throw new HttpError(400, "Send the file as multipart form data.");
    }
    if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") throw new HttpError(400, "Choose a file to upload.");
    if (!file.size) throw new HttpError(400, "That file is empty.");
    if (file.size > MAX_BYTES) throw new HttpError(413, `Files must be under ${Math.round(MAX_BYTES / 1048576)} MB.`);

    const db = await getDb();
    await enforceUploadLimit(db, user._id);

    const name = String(file.name || "file").replace(/[\u0000-\u001f\\/]/g, "_").slice(0, 160) || "file";
    const mime = String(file.type || "application/octet-stream").slice(0, 120);
    const stored = await uploadToCloudinary(file, { userId: user._id });
    const record = {
      url: stored.url,
      publicId: stored.publicId,
      kind: stored.resourceType === "image" && mime.startsWith("image/") ? "image" : "file",
      resourceType: stored.resourceType,
      name,
      mime,
      size: file.size,
      ...(stored.width ? { width: stored.width, height: stored.height } : {}),
    };
    // MongoDB keeps the link and ownership; the bytes live only in Cloudinary.
    await db.collection("uploads").insertOne({ _id: record.publicId, userId: user._id, ...record, createdAt: new Date() });
    return json({ attachment: record });
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message, ...error.extra }, error.status);
    console.error("Upload failed.", String(error?.message || "").slice(0, 300));
    return json({ error: "The file could not be uploaded. Please try again." }, 502);
  }
}

export default withCors(handler);
