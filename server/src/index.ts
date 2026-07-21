import express, { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "url";
import { join } from "path";
import { config } from "./config.js";
import { authRouter } from "./routes/auth.js";
import { requireAuth } from "./middleware/auth.js";
import { notesRouter } from "./routes/notes.js";
import { tagsRouter } from "./routes/tags.js";
import { searchRouter } from "./routes/search.js";
import { statsRouter } from "./routes/stats.js";
import { chatSessionsRouter } from "./routes/chat-sessions.js";
import { uploadsRouter, UPLOAD_DIR } from "./routes/uploads.js";
import { settingsRouter } from "./routes/settings.js";
import { accountRouter } from "./routes/account.js";
import { exportRouter } from "./routes/export.js";
import { reportsRouter } from "./routes/reports.js";
import { ascanRouter } from "./routes/ascan.js";
import { wechatRouter } from "./routes/wechat.js";
import { startTrashCleanup } from "./services/trash-cleanup.js";
import { seedReportIfNeeded } from "./services/ascan/reports.js";
import { restoreTasks } from "./services/scheduler.js";
import { requestLogger } from "./middleware/logger.js";

const app = express();

app.disable("x-powered-by");
// upgrade-insecure-requests is dropped: the /wechat config page is typically served
// over plain http (localhost/LAN) and the directive would break its same-origin fetches.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: { upgradeInsecureRequests: null },
    },
  }),
);
app.use(
  cors({
    origin: config.allowedOrigins.length > 0 ? config.allowedOrigins : true,
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(requestLogger);

// Tighter limit on auth endpoints to blunt brute-force / token-replay attempts.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Uploaded images are served as static files (filenames are unguessable UUIDs).
app.use("/uploads", express.static(UPLOAD_DIR));

app.use("/auth", authLimiter, authRouter);
app.use("/api", apiLimiter);
app.use("/api/notes", requireAuth, notesRouter);
app.use("/api/tags", requireAuth, tagsRouter);
app.use("/api/search", requireAuth, searchRouter);
app.use("/api/stats", requireAuth, statsRouter);
app.use("/api/chat-sessions", requireAuth, chatSessionsRouter);
app.use("/api/uploads", requireAuth, uploadsRouter);
app.use("/api/settings", requireAuth, settingsRouter);
app.use("/api/account", requireAuth, accountRouter);
app.use("/api/export", requireAuth, exportRouter);
app.use("/api/reports", requireAuth, reportsRouter);
app.use("/api/ascan", requireAuth, ascanRouter);
// WeChat MP integration: login flow uses WeChat uuid cookies, data endpoints use auth-key.
app.use("/api/wechat", wechatRouter);

// Built-in WeChat config page (embedded by the app's WebView).
const PUBLIC_DIR = process.env.NOTEONE_PUBLIC_DIR
  || fileURLToPath(new URL("../public", import.meta.url));
app.use("/wechat", express.static(join(PUBLIC_DIR, "wechat")));

// Central error handler — never leak stack traces in production.
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[error]", err);
  if (res.headersSent) return;
  res.status(err?.status || 500).json({
    error: config.isProd ? "Internal server error" : String(err?.message || err),
  });
});

import { dbReady } from "./db/client.js";

await dbReady();
app.listen(config.port, () => {
  console.log(`NoteOne server running on port ${config.port}${config.isEmbedded ? " (embedded)" : ""}`);
  startTrashCleanup();
  seedReportIfNeeded();
  restoreTasks();
});

// Embedded watchdog: if the host app dies without terminating us (force quit),
// we get reparented to launchd (ppid 1) — exit instead of lingering on the port.
if (config.isEmbedded) {
  const parentPid = process.ppid;
  setInterval(() => {
    if (process.ppid !== parentPid) {
      console.log("[embedded] host app gone, shutting down");
      process.exit(0);
    }
  }, 5000).unref();
}

export { app };
