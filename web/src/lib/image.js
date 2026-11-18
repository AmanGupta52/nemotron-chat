// Decodes any browser-readable image, fixes orientation, and re-encodes it as a compact JPEG
// so uploads stay well inside the server's size limits (phone photos are often 5-12 MB).

const MAX_OUTPUT_CHARS = 2_400_000; // base64 characters, ~1.8 MB of image data

async function decode(file) {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { /* fall back below */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("decode"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function prepareImage(file) {
  if (!file || !String(file.type).startsWith("image/")) throw new Error("Please choose an image file (PNG, JPG or WEBP).");
  if (file.size > 30 * 1024 * 1024) throw new Error("That image is larger than 30 MB. Please pick a smaller one.");
  let source;
  try { source = await decode(file); } catch { throw new Error("This browser could not read that image. Try a PNG, JPG or WEBP file."); }

  const width = source.width || source.naturalWidth;
  const height = source.height || source.naturalHeight;
  let maxSide = 1600;
  let quality = 0.86;
  let dataUrl = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; // flatten transparency
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrl.length <= MAX_OUTPUT_CHARS) break;
    maxSide = Math.round(maxSide * 0.75);
    quality = Math.max(0.6, quality - 0.08);
  }
  source.close?.();
  if (!dataUrl.startsWith("data:image/jpeg")) throw new Error("Could not process that image. Try another file.");
  const base = (file.name || "image").replace(/\.[^.]+$/, "");
  return { name: `${base}.jpg`, size: Math.round((dataUrl.length * 3) / 4), dataUrl };
}
