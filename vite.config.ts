import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
    host: "0.0.0.0", // Allow external access for WebContainer
    cors: true,
  },
  optimizeDeps: {
    // Include WebContainer in optimization to ensure consistent behavior
    include: ["@webcontainer/api"],
  },
  define: {
    global: "globalThis",
  },
  build: {
    rollupOptions: {
      external: [],
    },
    assetsInlineLimit: 0, // Don't inline any assets
  },
  assetsInclude: ["**/*.wasm", "**/*.worker.js"],
});
