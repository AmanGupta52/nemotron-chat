import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the site talks to the backend (`npm run dev` in /backend, port 8787) through this proxy,
// so requests stay same-origin and the cookie session works exactly like production.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/.netlify/functions": { target: process.env.DEV_API_TARGET || "http://localhost:8787" },
    },
  },
  build: { chunkSizeWarningLimit: 700 },
});
