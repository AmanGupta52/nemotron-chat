// Uploads a file through the API to Cloudinary. The API returns the stored link (kept in MongoDB with the chat).
import { ApiError, apiFetch } from "../auth/api.js";

const UPLOAD_API = "/.netlify/functions/upload";
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function dataUrlToBlob(dataUrl) {
  const [head, body] = dataUrl.split(",");
  const type = /data:([^;]+)/.exec(head)?.[1] || "application/octet-stream";
  const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type });
}

export async function uploadFile(blob, name) {
  const form = new FormData();
  form.append("file", blob, name);
  const response = await apiFetch(UPLOAD_API, { method: "POST", body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.attachment) throw new ApiError(data.error || `Upload failed (${response.status}).`, response.status, data);
  return data.attachment;
}
