// Standalone HTTP server for the API. It exposes the same handlers Netlify runs as functions, so the
// backend can be hosted anywhere Node runs (Render, Railway, Fly.io, a VPS, Docker).
//
//   npm start               -> http://localhost:8787
//   SERVE_WEB=true npm start -> also serves ../web/dist (single deployable: site + API)
import { existsSync, readFileSync, statSync, createReadStream } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Minimal .env loader (handles CRLF files and quotes). Real environment variables win.
function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || line.trim().startsWith("#")) continue;
    let value = match[2];
    if (/^(".*"|'.*')$/.test(value)) value = value.slice(1, -1);
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}
loadEnvFile(join(here, ".env"));
loadEnvFile(join(here, "..", ".env"));

const { default: account } = await import("./functions/account.js");
const { default: auth } = await import("./functions/auth.js");
const { default: chat } = await import("./functions/chat.js");
const { default: conversations } = await import("./functions/conversations.js");
const { default: models } = await import("./functions/models.js");
const { default: upload } = await import("./functions/upload.js");

const ROUTES = { account, auth, chat, conversations, models, upload };
const PORT = Number(process.env.PORT) || 8787;
// Render, Railway and Fly put a proxy in front of the app; without this every visitor would share one IP address.
const TRUST_PROXY = ["1", "true", "yes"].includes(String(process.env.TRUST_PROXY || "").toLowerCase())
  || Boolean(process.env.RENDER || process.env.RAILWAY_ENVIRONMENT || process.env.FLY_APP_NAME);
const WEB_DIR = resolve(here, process.env.WEB_DIR || "../web/dist");
const SERVE_WEB = ["1", "true", "yes"].includes(String(process.env.SERVE_WEB || "").toLowerCase()) && existsSync(WEB_DIR);

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json",
};

function clientIp(req) {
  if (TRUST_PROXY) {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || "unknown";
}

function toWebRequest(req, res) {
  const proto = TRUST_PROXY ? String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() || "http" : "http";
  const url = new URL(req.url, `${proto}://${req.headers.host || `localhost:${PORT}`}`);

  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    // Never trust client-supplied "who is this" headers; they feed the rate limiter.
    if (name === "x-client-ip" || name === "x-nf-client-connection-ip") continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  headers.set("x-client-ip", clientIp(req));

  const abort = new AbortController();
  res.on("close", () => { if (!res.writableFinished) abort.abort(); });

  const init = { method: req.method, headers, signal: abort.signal };
  if (!["GET", "HEAD"].includes(req.method)) {
    init.body = Readable.toWeb(req);
    init.duplex = "half";
  }
  return new Request(url, init);
}

async function sendWebResponse(res, response) {
  const headers = {};
  for (const [name, value] of response.headers) {
    if (name === "set-cookie") continue;
    headers[name] = value;
  }
  const cookies = response.headers.getSetCookie?.() || [];
  if (cookies.length) headers["set-cookie"] = cookies;
  res.writeHead(response.status, headers);
  if (!response.body) return res.end();
  const stream = Readable.fromWeb(response.body);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

function serveStatic(req, res, pathname) {
  let file = normalize(join(WEB_DIR, decodeURIComponent(pathname)));
  if (file !== WEB_DIR && !file.startsWith(WEB_DIR + sep)) { res.writeHead(403); return res.end("Forbidden"); }
  let isAsset = true;
  if (!existsSync(file) || statSync(file).isDirectory()) {
    if (extname(pathname)) { res.writeHead(404); return res.end("Not found"); }
    file = join(WEB_DIR, "index.html"); // single-page-app fallback
    isAsset = false;
  }
  res.writeHead(200, {
    "Content-Type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
    "Cache-Control": isAsset && file.includes(`${sep}assets${sep}`) ? "public, max-age=31536000, immutable" : "no-cache",
  });
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, "http://localhost");
    if (pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true }));
    }
    const match = /^\/(?:\.netlify\/functions|api)\/([a-z]+)\/?$/.exec(pathname);
    if (match) {
      const handler = ROUTES[match[1]];
      if (!handler) { res.writeHead(404, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: "Unknown endpoint." })); }
      return await sendWebResponse(res, await handler(toWebRequest(req, res), {}));
    }
    if (SERVE_WEB && ["GET", "HEAD"].includes(req.method)) return serveStatic(req, res, pathname);
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found." }));
  } catch (error) {
    console.error("Unhandled server error.", error?.name || "Error");
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal server error." }));
  }
});

server.requestTimeout = 0; // chat replies stream for a long time
server.listen(PORT, () => {
  console.log(`Nemotron Workbench API listening on http://localhost:${PORT}${SERVE_WEB ? " (serving web build)" : ""}`);
});
