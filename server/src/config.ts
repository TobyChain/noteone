import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`[config] Missing required environment variable: ${name}`);
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV || "development";
const isProd = nodeEnv === "production";

const jwtSecret = required("JWT_SECRET");
if (isProd && (jwtSecret === "change-me-in-production" || jwtSecret.length < 16)) {
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
  port: parseInt(process.env.PORT || "3000", 10),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret,
  // dev-token login is only ever available when explicitly enabled AND not in production
  enableDevLogin: process.env.ENABLE_DEV_LOGIN === "true" && !isProd,
  apple: {
    // audience(s) the Apple identityToken must be issued for — the app bundle id(s)
    clientIds: list("APPLE_CLIENT_IDS", "com.noteone.app"),
  },
  // CORS allow-list; empty => reflect request origin (dev convenience)
  allowedOrigins: list("ALLOWED_ORIGINS"),
  qwen: {
    apiKey: process.env.QWEN_API_KEY || "",
    baseUrl: process.env.QWEN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: process.env.QWEN_MODEL || "gpt-5.4-mini",
  },
};
