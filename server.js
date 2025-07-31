import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Set cross-origin isolation headers for all responses
app.use((req, res, next) => {
  // Standard cross-origin isolation headers required by WebContainer
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

  // Additional headers for WebContainer compatibility
  res.setHeader("Permissions-Policy", "cross-origin-isolated=*");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "same-origin");

  // Additional security headers that might help WebContainer
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-DNS-Prefetch-Control", "off");

  next();
});

// Serve static files from the dist directory with proper CORP headers
app.use(
  express.static(path.join(__dirname, "dist"), {
    setHeaders: (res, path) => {
      // Ensure all static assets have proper CORP headers
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

      // Set specific headers for different asset types
      if (path.endsWith(".js")) {
        res.setHeader("Content-Type", "application/javascript");
      } else if (path.endsWith(".css")) {
        res.setHeader("Content-Type", "text/css");
      } else if (path.endsWith(".html")) {
        res.setHeader("Content-Type", "text/html; charset=UTF-8");
      }
    },
  })
);

// Handle all routes by serving index.html (SPA fallback)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
