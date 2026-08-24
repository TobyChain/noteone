import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`[config] Missing required environment variable: ${name}`);
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV || "development";
const isProd = nodeEnv === "production";

// Embedded single-user mode (packaged .app): NOTEONE_DATA_DIR points at
// ~/Library/Application Support/NoteOne. The database runs in-process (PGlite),
// and JWT_SECRET is auto-generated and persisted under the data dir.
const dataDir = process.env.NOTEONE_DATA_DIR || "";
const isEmbedded = dataDir !== "";
if (isEmbedded) {
  mkdirSync(dataDir, { recursive: true });
}

function resolveJwtSecret(): string {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim() !== "") {
    return process.env.JWT_SECRET;
  }
  if (isEmbedded) {
    const secretPath = join(dataDir, "jwt-secret");
    if (existsSync(secretPath)) {
      return readFileSync(secretPath, "utf-8").trim();
    }
    const secret = randomBytes(32).toString("hex");
    writeFileSync(secretPath, secret, { mode: 0o600 });
    return secret;
  }
  return required("JWT_SECRET");
}

const jwtSecret = resolveJwtSecret();
if (isProd && !isEmbedded && (jwtSecret === "change-me-in-production" || jwtSecret.length < 16)) {
  throw new Error(
    "[config] JWT_SECRET is weak or default; set a strong secret (>= 16 chars) in production",
  );
}

function list(name: string, fallback = ""): string[] {
  return (process.env[name] || fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  nodeEnv,
  isProd,
  isEmbedded,
  dataDir,
  port: parseInt(process.env.PORT || "3000", 10),
  // Embedded mode uses PGlite under the data dir; DATABASE_URL is not needed.
  databaseUrl: isEmbedded ? (process.env.DATABASE_URL || "") : required("DATABASE_URL"),
  jwtSecret,
  // CORS allow-list; empty => reflect request origin (dev convenience)
  allowedOrigins: list("ALLOWED_ORIGINS"),
  // LLM defaults intentionally empty — open-source NoteOne ships without a bundled provider.
  // Users supply their own apiKey / baseUrl / model via PATCH /api/settings (per-user) or
  // QWEN_* env vars (server-wide). When unconfigured, AI features (tagging / summary / Notty
  // / report) are skipped gracefully and notes still save as plain text.
  qwen: {
    apiKey: process.env.QWEN_API_KEY || "",
    baseUrl: process.env.QWEN_BASE_URL || "",
    model: process.env.QWEN_MODEL || "",
  },
  search: {
    provider: (process.env.SEARCH_PROVIDER as "duckduckgo" | "tavily" | "bing") || "duckduckgo",
    tavilyApiKey: process.env.TAVILY_API_KEY || "",
    bingApiKey: process.env.BING_SEARCH_API_KEY || "",
  },
};
