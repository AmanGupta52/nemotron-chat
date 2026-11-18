// Copies the production web build (../web/dist) into ./www, which Capacitor packages into the app.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const from = resolve(root, "../web/dist");
const to = resolve(root, "www");

if (!existsSync(resolve(from, "index.html"))) {
  console.error("web/dist was not found. Build the web app first:  cd ../web && npm install && npm run build");
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log(`Copied ${from} -> ${to}`);
