// Minimal Cloudinary client (signed uploads + deletes) using fetch only - no SDK needed.
//
// Config (either style):
//   CLOUDINARY_URL=cloudinary://API_KEY:API_SECRET@CLOUD_NAME
//   or CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET
// Because this Cloudinary account is shared by many apps, everything this app uploads lives under
// one folder (CLOUDINARY_FOLDER, default "nemotron-workbench") and is tagged with the same name.
import { createHash, randomUUID } from "node:crypto";

export const APP_FOLDER = (process.env.CLOUDINARY_FOLDER || "nemotron-workbench").replace(/^\/+|\/+$/g, "");

function config() {
  let cloud = process.env.CLOUDINARY_CLOUD_NAME || "";
  let key = process.env.CLOUDINARY_API_KEY || "";
  let secret = process.env.CLOUDINARY_API_SECRET || "";
  const url = process.env.CLOUDINARY_URL || "";
  if ((!cloud || !key || !secret) && url) {
    const match = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(url.trim());
    if (match) [, key, secret, cloud] = match;
  }
  if (!cloud || !key || !secret) return null;
  return { cloud, key, secret };
}

export const cloudinaryConfigured = () => Boolean(config());

function sign(params, secret) {
  const base = Object.keys(params)
    .filter((name) => params[name] !== undefined && params[name] !== "")
    .sort()
    .map((name) => `${name}=${params[name]}`)
    .join("&");
  return createHash("sha1").update(base + secret).digest("hex");
}

// Uploads any file type. Returns the data worth keeping in MongoDB.
export async function uploadToCloudinary(blob, { userId }) {
  const cfg = config();
  if (!cfg) throw new Error("Cloudinary is not configured.");
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `${APP_FOLDER}/${userId}`;
  const params = {
    asset_folder: folder, // shows the file in this folder in the Media Library (dynamic-folder accounts)
    public_id: `${folder}/${randomUUID()}`, // the path is also in the public ID (works with fixed-folder accounts)
    tags: APP_FOLDER,
    timestamp,
  };
  const form = new FormData();
  form.append("file", blob);
  for (const [name, value] of Object.entries(params)) form.append(name, String(value));
  form.append("api_key", cfg.key);
  form.append("signature", sign(params, cfg.secret));

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloud}/auto/upload`, { method: "POST", body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.secure_url) {
    throw new Error(`Cloudinary upload failed: ${String(data?.error?.message || response.status).slice(0, 200)}`);
  }
  return {
    url: data.secure_url,
    publicId: data.public_id,
    resourceType: data.resource_type, // image | video | raw
    width: data.width,
    height: data.height,
  };
}

export async function destroyFromCloudinary(publicId, resourceType = "image") {
  const cfg = config();
  if (!cfg || !publicId.startsWith(`${APP_FOLDER}/`)) return false; // never touch other apps' files
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { invalidate: "true", public_id: publicId, timestamp };
  const form = new URLSearchParams({ ...params, api_key: cfg.key, signature: sign(params, cfg.secret) });
  const type = ["image", "video", "raw"].includes(resourceType) ? resourceType : "image";
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloud}/${type}/destroy`, { method: "POST", body: form });
  return response.ok;
}

// Removes this user's uploads (all, or only the given public IDs) from Cloudinary and MongoDB. Best effort.
export async function deleteUserUploads(db, userId, publicIds = null) {
  try {
    const filter = { userId };
    if (publicIds) {
      if (!publicIds.length) return;
      filter._id = { $in: publicIds };
    }
    const uploads = db.collection("uploads");
    const docs = await uploads.find(filter, { projection: { _id: 1, resourceType: 1 } }).toArray();
    await Promise.allSettled(docs.map((doc) => destroyFromCloudinary(doc._id, doc.resourceType)));
    await uploads.deleteMany({ ...filter, _id: { $in: docs.map((doc) => doc._id) } });
  } catch (error) {
    console.error("Upload cleanup failed.", String(error?.message || "").slice(0, 200));
  }
}
