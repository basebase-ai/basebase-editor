import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Set cross-origin isolation headers for all responses
app.use((req, res, next) => {
  // Try credentialless mode which is more flexible for external resources
  res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

  // Additional headers for WebContainer compatibility
  res.setHeader("Permissions-Policy", "cross-origin-isolated=()");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "same-origin");

  next();
});

// Serve static files from the dist directory
app.use(express.static(path.join(__dirname, "dist")));

// Handle all routes by serving index.html (SPA fallback)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
