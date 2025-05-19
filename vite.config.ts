// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // REST API ------------------------------------------------------
      // anything that starts with /v1 → http://localhost:5500
      "/v1": {
        target: "http://localhost:5500",
        changeOrigin: true,
      },

      // WebSocket upgrade --------------------------------------------
      // the Socket.IO namespace we chose (“/ws”)
      "/ws": {
        target: "ws://localhost:5500",
        ws: true,           // tell Vite this is WebSocket traffic
      },
    },
  },
});