import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
    host: "0.0.0.0", // Allow external access for WebContainer
    cors: true,
  },
  optimizeDeps: {
    exclude: ["@webcontainer/api"],
  },
  define: {
    global: "globalThis",
  },
});
