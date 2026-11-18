# Nemotron Workbench

A private AI chat workspace for **NVIDIA** models and **free OpenRouter** models, available as a **website** and an **Android app** that share one **backend**.

- Streamed Markdown answers with code highlighting, copy, regenerate, edit-and-resend
- Searchable model picker, vision support (images are resized in the browser before upload)
- Accounts with e-mail verification (6-digit code), password reset, per-user private chat history in MongoDB
- Provider API keys stay on the server and are never sent to the browser or the app
- Light / dark / system theme, responsive layout (desktop sidebar, phone drawer)

---

## Project structure

```
nemotron-workbench/
├── backend/            API: auth, chat streaming, conversations, models
│   ├── functions/      Handlers (run as Netlify Functions OR via server.js)
│   ├── server.js       Standalone Node server (Render, Railway, Docker, VPS …)
│   ├── tests/          Unit tests (node --test)
│   └── .env.example    Every server setting, documented
├── web/                React + Vite website
│   └── .env.example    VITE_API_BASE_URL (needed for the mobile build)
├── mobile/             Capacitor wrapper that packages web/ into an Android APK
├── .github/workflows/
│   ├── build-apk.yml   Builds the APK on every push (and on tags → GitHub Release)
│   └── ci.yml          Backend tests + web build on pull requests
├── netlify.toml        One-click Netlify deploy of site + API
├── Dockerfile          Site + API in a single container
└── package.json        Convenience scripts
```

---

## 1. Run it locally

**Requirements:** Node.js 20+ (18 works for backend and web), a MongoDB database (a free MongoDB Atlas cluster is fine), an EmailJS account, and at least one of an NVIDIA or OpenRouter API key.

```bash
# 1) install
npm run install:all

# 2) configure the backend
cp backend/.env.example backend/.env      # then fill in the values (see the table below)

# 3) start the API (terminal 1)  ->  http://localhost:8787
npm run dev:api

# 4) start the website (terminal 2)  ->  http://localhost:5173
npm run dev:web
```

Open <http://localhost:5173>, create an account, enter the e-mail code, and start chatting. The Vite dev server proxies `/.netlify/functions/*` to the API, so no extra web configuration is needed.

### Backend settings (`backend/.env`)

| Variable | Required | What it is |
| --- | --- | --- |
| `MONGODB_URI` | yes | MongoDB connection string. Include a database name in the path. |
| `AUTH_SECRET` | yes | At least 32 random bytes. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID`, `EMAILJS_PUBLIC_KEY` | yes | EmailJS settings used to send the verification / reset code. |
| `EMAILJS_PRIVATE_KEY` | if enabled in EmailJS | Needed when "Use Private Key" is on in EmailJS → Account → Security. |
| `NVIDIA_API_KEY` / `OPENROUTER_API_KEY` | at least one | Provider keys. |
| `ALLOWED_ORIGINS` | if web and API are on different domains | Comma-separated origins allowed to call the API. The Android app is allowed by default. |
| `MONGODB_DB` | no | Database name, if it is not in the URI. |
| `MONGODB_DNS_SERVERS` | no | e.g. `8.8.8.8,1.1.1.1` — fixes `querySrv ECONNREFUSED`. |
| `PORT`, `TRUST_PROXY`, `SERVE_WEB` | standalone server only | Port (default 8787); set `TRUST_PROXY=true` behind a reverse proxy; `SERVE_WEB=true` also serves `web/dist`. |

**EmailJS template:** it must use the variables `to_email`, `otp_code`, `expires_in_minutes` and `purpose`. In EmailJS → Account → Security, enable **"Allow EmailJS API for non-browser applications"** — without it, e-mail sending from a server is rejected.

---

## 2. Deploy the backend (and website)

The Android app needs a **publicly reachable HTTPS backend**. Pick one option.

### Option A — Netlify (website + API together, recommended)

1. Push this repository to GitHub, then in Netlify choose **Add new site → Import from Git**. `netlify.toml` already contains the build command, publish folder and functions folder.
2. In **Site configuration → Environment variables**, add the variables from the table above (`MONGODB_URI`, `AUTH_SECRET`, `EMAILJS_*`, provider keys).
3. Deploy. Your API address is the site URL, e.g. `https://my-workbench.netlify.app`.

> Netlify limits how long a function may run (10 s by default on the free plan — check your plan). A long AI answer can be cut off. If you see that, use Option B, which has no such limit.

### Option B — Node server / Docker (Render, Railway, Fly.io, a VPS)

```bash
# plain Node
cd backend && npm install && npm start

# or Docker (serves the website and the API from one container)
docker build -t nemotron-workbench .
docker run -p 8787:8787 --env-file backend/.env -e TRUST_PROXY=true nemotron-workbench
```

On Render/Railway: create a web service from this repo using the `Dockerfile`, add the environment variables, and set `TRUST_PROXY=true`. Check `https://<your-service>/health` returns `{"ok":true}`.

---

## 3. The Android app (APK) — built automatically by GitHub

The workflow `.github/workflows/build-apk.yml` builds an installable APK every time you push to `main`.

1. **Create a GitHub repository** and upload / push this whole folder.
2. In the repository open **Settings → Secrets and variables → Actions → Variables → New repository variable**
   - Name: `API_BASE_URL`
   - Value: your deployed backend URL from step 2, with no trailing slash, e.g. `https://my-workbench.netlify.app`
3. Open the **Actions** tab → **Build Android APK** → **Run workflow** (or just push a commit).
4. When the run finishes (about 5–10 minutes), download **nemotron-workbench-apk** from the run's *Artifacts* section and unzip it to get `nemotron-workbench.apk`.
5. Copy the APK to your phone and install it (Android asks you to allow installing from this source).

**Publishing a release:** push a tag such as `v1.0.0` (`git tag v1.0.0 && git push origin v1.0.0`) and the APK is also attached to a GitHub Release.

> If `API_BASE_URL` is not set, the build still succeeds (with a warning), but the app will show "built without an API address". Set the variable and re-run the workflow.

### Build the APK on your own computer instead

Requirements: Node 20+, JDK 21, Android SDK (Android Studio installs both).

```bash
cd web
echo "VITE_API_BASE_URL=https://your-backend.example.com" > .env.production
npm install && npm run build

cd ../mobile
npm install
npm run android:add          # one time: generates mobile/android
npm run apk:debug            # -> mobile/android/app/build/outputs/apk/debug/app-debug.apk
npm run android:open         # optional: open the project in Android Studio
```

### Notes on the app

- It is a **debug-signed** APK: fine for installing on your own devices. For Google Play you need a release build signed with your own keystore (never commit the keystore — `.gitignore` already blocks `*.jks` / `*.keystore`).
- The app talks to the backend over HTTPS with a **Bearer session token** stored in the app's private storage (cookies are not shared between the app and the API origin). Signing out, changing the password or deleting the account invalidates / clears it.
- To change the app icon, name or package id, edit `mobile/capacitor.config.json` and use `@capacitor/assets` (see the Capacitor docs).
- "Export as Markdown" opens the Android share sheet inside the app.

---

## API overview

All endpoints live under `/.netlify/functions/` (the standalone server also answers on `/api/`).

| Endpoint | Purpose |
| --- | --- |
| `GET models` | NVIDIA allow-list and the current free OpenRouter catalog (`?refresh=1` bypasses the cache). |
| `POST auth` | `register`, `verify-email`, `resend-verification`, `login`, `logout`, `forgot-password`, `reset-password`, `change-password`. `GET` returns the current user. |
| `GET/PATCH/DELETE account` | Profile, theme, and password-confirmed account deletion. |
| `GET/POST/PATCH/DELETE conversations` | List/search, paginated messages, rename/pin/delete, import local history. |
| `POST chat` | Streams a model reply (Server-Sent Events) and saves it once the stream finishes. |

Browsers authenticate with an HttpOnly cookie. Clients that send `X-Auth-Mode: bearer` (the mobile app) receive the session token in the JSON body and send it as `Authorization: Bearer …`.

---

## Security notes

- Passwords: scrypt. Sessions: random tokens stored only as keyed digests, 30-day expiry. Codes: 6 digits, 10 minutes, 5 attempts, resend cooldowns, rate limits.
- Every conversation query is scoped to the signed-in user; client-supplied user ids are never trusted.
- State-changing requests must come from the API's own origin, the Android app, or an origin listed in `ALLOWED_ORIGINS`.
- **Never commit `.env` files.** `.gitignore` excludes them. The `.env` in the project you uploaded contained what looked like real keys (NVIDIA, OpenRouter, MongoDB, EmailJS). It was **not** copied into this folder. Treat those values as exposed: revoke/rotate the API keys, change the MongoDB user password, and generate a new `AUTH_SECRET`.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Registration says the verification e-mail could not be sent | Enable "Allow EmailJS API for non-browser applications" in EmailJS → Account → Security; add `EMAILJS_PRIVATE_KEY` if "Use Private Key" is on. The server log prints EmailJS's exact reason. |
| `MongoDB SRV DNS lookup was refused` (`querySrv ECONNREFUSED`) | The server now retries with public DNS automatically; you can also set `MONGODB_DNS_SERVERS=8.8.8.8,1.1.1.1` or use the non-SRV connection string from Atlas. Also allow your server's IP in Atlas → Network Access. |
| "This origin is not allowed to call the API" | Add the website's origin to `ALLOWED_ORIGINS` on the backend. |
| App says it was built without an API address | Set the `API_BASE_URL` repository variable and re-run the workflow. |
| Chat requests fail with "The authentication service is temporarily unavailable" | Check the backend log: `MONGODB_URI` / `AUTH_SECRET` missing, or `AUTH_SECRET` still the placeholder. |
| Answers get cut off on Netlify | Function time limit — host the backend with Option B. |

---

## Tests

```bash
npm test          # backend unit tests (password hashing, OTP limits, CORS/origin rules, bearer auth, owner scoping)
```

The CI workflow also runs the web build on every pull request.

---

## What changed from the original project

**Bugs fixed**
- **Mobile login could never work:** the API relied on same-origin cookies and rejected any other origin, and returned no CORS headers. Added CORS, an origin allow-list, and Bearer-token sessions for the app.
- **A failed first verification e-mail left new users stuck** on the registration page (the error told them to "Resend code" but they were never taken to the screen that has the button). The API now returns the e-mail so the app opens the verification screen.
- **A single MongoDB connection failure was cached forever**, breaking every later request until the function restarted. Failed connections and index creation are now retried.
- `querySrv ECONNREFUSED` MongoDB errors are retried once with public DNS.
- **Rate limiting off Netlify:** all users shared one "unknown" IP bucket. The standalone server now supplies the real client address (and ignores spoofed headers unless `TRUST_PROXY=true`).
- E-mail sending now supports the EmailJS private key and logs the provider's real error.
- `AUTH_SECRET` is rejected if it is still the `REPLACE_WITH…` placeholder.
- Login timing no longer reveals whether an e-mail has an account.
- Brand link in the sidebar did a full page reload (which breaks routing inside the app); it is now client-side navigation.
- "Export as Markdown" did nothing inside the Android WebView; it now uses the share sheet there.
- Removed the leftover `deno.lock`, a stale `dist/` build, and the unused `mongodb` dependency from the web package.

**New**
- Split into `backend/`, `web/`, `mobile/`.
- Standalone Node server + Dockerfile (no Netlify required).
- Android app (Capacitor) and a GitHub Actions workflow that builds the APK.
- CI workflow, more tests, documented environment files.
