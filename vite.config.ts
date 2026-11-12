import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The local reverse proxy is trusted; normalize Origin to the Worker origin for its CSRF check.
  server: {
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: false, configure: proxy => {
      proxy.on("proxyReq", request => request.setHeader("Origin", "http://localhost:5173"));
    } } },
    watch: { ignored: ["**/.wrangler/**", "**/test-results/**", "**/playwright-report/**"] },
  },
  build: { sourcemap: false },
});
