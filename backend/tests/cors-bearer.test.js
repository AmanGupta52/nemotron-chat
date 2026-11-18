import test from "node:test";
import assert from "node:assert/strict";
import {
  authenticate,
  corsHeaders,
  DUMMY_PASSWORD_HASH,
  requestIp,
  requireSameOrigin,
  verifyPassword,
  wantsBearer,
  withCors,
} from "../functions/lib/security.js";

const api = "https://api.example.com/.netlify/functions/chat";
const req = (headers = {}, method = "POST", url = api) => new Request(url, { method, headers });

test("same-origin and mobile-app origins are accepted, others rejected", () => {
  assert.doesNotThrow(() => requireSameOrigin(req({ origin: "https://api.example.com" })));
  assert.doesNotThrow(() => requireSameOrigin(req({ origin: "https://localhost" })));
  assert.doesNotThrow(() => requireSameOrigin(req({ origin: "capacitor://localhost" })));
  assert.doesNotThrow(() => requireSameOrigin(req({ origin: "http://api.example.com" }))); // scheme differs behind a proxy
  assert.throws(() => requireSameOrigin(req({ origin: "https://evil.example" })), { status: 403 });
  assert.throws(() => requireSameOrigin(req({ origin: "https://api.example.com.evil.example" })), { status: 403 });
  assert.throws(() => requireSameOrigin(req({ origin: "not a url" })), { status: 403 });
  assert.throws(() => requireSameOrigin(req()), { status: 403 });
});

test("ALLOWED_ORIGINS extends the allow-list", () => {
  process.env.ALLOWED_ORIGINS = "https://my-site.example/, http://localhost:5173";
  try {
    assert.doesNotThrow(() => requireSameOrigin(req({ origin: "https://my-site.example" })));
    assert.doesNotThrow(() => requireSameOrigin(req({ origin: "http://localhost:5173" })));
  } finally {
    delete process.env.ALLOWED_ORIGINS;
  }
});

test("CORS headers are only produced for allowed origins", () => {
  assert.deepEqual(corsHeaders(req({ origin: "https://evil.example" })), {});
  assert.deepEqual(corsHeaders(req()), {});
  const headers = corsHeaders(req({ origin: "https://localhost" }));
  assert.equal(headers["Access-Control-Allow-Origin"], "https://localhost");
  assert.match(headers["Access-Control-Allow-Headers"], /Authorization/);
});

test("withCors answers preflight requests and decorates responses", async () => {
  const wrapped = withCors(async () => new Response("ok", { status: 201, headers: { "X-Test": "1" } }));
  const preflight = await wrapped(req({ origin: "https://localhost" }, "OPTIONS"));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://localhost");

  const ok = await wrapped(req({ origin: "https://localhost" }));
  assert.equal(ok.status, 201);
  assert.equal(ok.headers.get("x-test"), "1");
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://localhost");
  assert.equal(await ok.text(), "ok");

  const foreign = await wrapped(req({ origin: "https://evil.example" }));
  assert.equal(foreign.headers.get("access-control-allow-origin"), null);
});

test("bearer mode is opt-in and requests without credentials are anonymous", async () => {
  assert.equal(wantsBearer(req({ "x-auth-mode": "bearer" })), true);
  assert.equal(wantsBearer(req()), false);
  assert.equal(await authenticate(req()), null);
  assert.equal(await authenticate(req({ authorization: "Bearer short" })), null);
});

test("client IP comes from trusted headers only", () => {
  assert.equal(requestIp(req({ "x-nf-client-connection-ip": "203.0.113.9" })), "203.0.113.9");
  assert.equal(requestIp(req({ "x-client-ip": "198.51.100.4" })), "198.51.100.4");
  assert.equal(requestIp(req({ "x-forwarded-for": "1.2.3.4" })), "unknown");
});

test("the dummy hash used for unknown emails is well-formed and never verifies", async () => {
  assert.equal(await verifyPassword("anything at all", DUMMY_PASSWORD_HASH), false);
});
