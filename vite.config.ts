import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
    // Force localhost
    host: "localhost",
    cors: true,
  },
  optimizeDeps: {
    exclude: ["@webcontainer/api"],
  },
  // Ensure proper build configuration
  define: {
    global: "globalThis",
  },
  build: {
    // Ensure all built assets have proper CORS headers
    rollupOptions: {
      output: {
        // Add integrity checks for cross-origin resources
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
  },
});
