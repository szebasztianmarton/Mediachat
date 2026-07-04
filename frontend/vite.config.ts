import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// A backend IPv4-en (0.0.0.0:8000) figyel. Windows + Node alatt a "localhost"
// gyakran IPv6 (::1) címre fordul, ami ECONNREFUSED-öt okoz a proxyban — ezért
// a 127.0.0.1 explicit IPv4 cím a megbízható.
const BACKEND = "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3100,
    strictPort: true, // ne essen vissza csendben más portra (3000-et másik projekt foglalja)
    proxy: {
      "/api": { target: BACKEND, changeOrigin: true },
      "/health": { target: BACKEND, changeOrigin: true },
    },
  },
  preview: {
    port: 3100,
  },
});
