import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Debug logging for environment variables
console.log("🔍 Environment Variables Debug:");
console.log(
  "ANTHROPIC_API_KEY:",
  process.env.ANTHROPIC_API_KEY
    ? `Set (${process.env.ANTHROPIC_API_KEY.substring(0, 10)}...)`
    : "Not set"
);
console.log(
  "GEMINI_API_KEY:",
  process.env.GEMINI_API_KEY
    ? `Set (${process.env.GEMINI_API_KEY.substring(0, 10)}...)`
    : "Not set"
);
console.log("NODE_ENV:", process.env.NODE_ENV);
console.log(
  "All env keys:",
  Object.keys(process.env).filter((key) => key.includes("API"))
);

// Initialize AI clients with server-side API keys
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const google = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

console.log("🤖 AI Clients Status:");
console.log("Anthropic client:", anthropic ? "Initialized" : "Not initialized");
console.log("Google client:", google ? "Initialized" : "Not initialized");

// Middleware to parse JSON requests
app.use(express.json({ limit: "10mb" }));

// Set cross-origin isolation headers for all responses
app.use((req, res, next) => {
  // WebContainer requires these specific headers as per official documentation
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");

  // Additional headers for WebContainer compatibility
  res.setHeader("Permissions-Policy", "cross-origin-isolated=*");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "same-origin");

  // Additional security headers that might help WebContainer
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-DNS-Prefetch-Control", "off");

  next();
});

// API endpoint for Anthropic messages
app.post("/api/anthropic/messages", async (req, res) => {
  try {
    if (!anthropic) {
      return res
        .status(400)
        .json({ error: "Anthropic API key not configured" });
    }

    const { model, max_tokens, system, messages, tools } = req.body;

    const response = await anthropic.messages.create({
      model: model || "claude-3-opus-20240229",
      max_tokens: max_tokens || 4096,
      system,
      messages,
      tools,
    });

    res.json(response);
  } catch (error) {
    console.error("Anthropic API error:", error);
    res.status(500).json({
      error: "Failed to call Anthropic API",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// API endpoint for Google GenAI
app.post("/api/google/generate", async (req, res) => {
  try {
    if (!google) {
      return res.status(400).json({ error: "Google API key not configured" });
    }

    const { model, contents, config } = req.body;

    // Debug: Log the request being sent to Google
    console.log("🔧 [SERVER] Google GenAI Request:");
    console.log("🔧 [SERVER] Model:", model || "gemini-2.0-flash");
    console.log(
      "🔧 [SERVER] Contents length:",
      typeof contents === "string" ? contents.length : "N/A"
    );
    console.log(
      "🔧 [SERVER] Contents preview:",
      typeof contents === "string"
        ? contents.substring(0, 200) + "..."
        : contents
    );
    console.log("🔧 [SERVER] Config:", JSON.stringify(config, null, 2));

    const response = await google.models.generateContent({
      model: model || "gemini-2.0-flash",
      contents,
      config,
    });

    // Debug: Log the response received from Google
    console.log("🔧 [SERVER] Google GenAI Response:");
    console.log("🔧 [SERVER] Response type:", typeof response);
    console.log("🔧 [SERVER] Response keys:", Object.keys(response));
    console.log("🔧 [SERVER] Raw response:", JSON.stringify(response, null, 2));

    if (response.candidates && response.candidates.length > 0) {
      const candidate = response.candidates[0];
      console.log(
        "🔧 [SERVER] First candidate:",
        JSON.stringify(candidate, null, 2)
      );

      if (candidate.content && candidate.content.parts) {
        console.log("🔧 [SERVER] Parts count:", candidate.content.parts.length);
        candidate.content.parts.forEach((part, index) => {
          console.log(
            `🔧 [SERVER] Part ${index}:`,
            JSON.stringify(part, null, 2)
          );
        });
      }
    }

    res.json(response);
  } catch (error) {
    console.error("Google GenAI API error:", error);
    res.status(500).json({
      error: "Failed to call Google GenAI API",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    anthropic: !!anthropic,
    google: !!google,
  });
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

// Handle all non-API routes by serving index.html (SPA fallback)
app.get("*", (req, res) => {
  // Only serve index.html for non-API routes
  if (!req.path.startsWith("/api/")) {
    res.sendFile(path.join(__dirname, "dist", "index.html"));
  } else {
    res.status(404).json({ error: "API endpoint not found" });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
