/**
 * Ascan API routes.
 * - GET  /api/ascan/reports        — list all daily reports
 * - GET  /api/ascan/reports/:date  — get a single report's HTML
 * - GET  /api/ascan/config         — get current ascan configuration
 * - PATCH /api/ascan/config        — update ascan configuration
 * - POST /api/ascan/trigger        — trigger a pipeline run
 * - GET  /api/ascan/status         — check run status
 */

import { Router } from "express";
import { AuthRequest } from "../middleware/auth.js";
import {
  listReports,
  getReport,
  getConfig,
  updateConfig,
  triggerRun,
  getRunStatus,
  type AscanConfig,
} from "../services/ascan-bridge.js";

export const ascanRouter = Router();

const SENSITIVE_KEYS: (keyof AscanConfig)[] = ["idealab_api_key", "github_token", "semantic_scholar_api_key"];

function maskConfig(config: AscanConfig): AscanConfig {
  const masked = { ...config };
  for (const key of SENSITIVE_KEYS) {
    (masked as any)[key] = masked[key] ? "***" : "";
  }
  return masked;
}

/**
 * GET /api/ascan/reports
 * List all available daily reports (HTML files in ascan/docs/).
 */
ascanRouter.get("/reports", async (_req: AuthRequest, res) => {
  try {
    const reports = await listReports();
    res.json({ reports });
  } catch (err: any) {
    console.error("[ascan] listReports failed:", err);
    res.status(500).json({ error: "Failed to list reports" });
  }
});

/**
 * GET /api/ascan/reports/:date
 * Get a single report's full HTML content.
 */
ascanRouter.get("/reports/:date", async (req: AuthRequest, res) => {
  const date = req.params.date as string;
  if (!/^\d{8}$/.test(date)) {
    res.status(400).json({ error: "Invalid date format. Use YYYYMMDD." });
    return;
  }
  try {
    const html = await getReport(date);
    if (!html) {
      res.status(404).json({ error: "Report not found" });
      return;
    }
    res.json({ date, html });
  } catch (err: any) {
    console.error("[ascan] getReport failed:", err);
    res.status(500).json({ error: "Failed to get report" });
  }
});

/**
 * GET /api/ascan/config
 * Get current ascan configuration (parsed from .env).
 */
ascanRouter.get("/config", async (_req: AuthRequest, res) => {
  try {
    const config = await getConfig();
    res.json(maskConfig(config));
  } catch (err: any) {
    console.error("[ascan] getConfig failed:", err);
    res.status(500).json({ error: "Failed to get config" });
  }
});

/**
 * PATCH /api/ascan/config
 * Update ascan configuration (writes to .env).
 * Body: Partial<AscanConfig>
 */
ascanRouter.patch("/config", async (req: AuthRequest, res) => {
  const updates = req.body as Partial<AscanConfig>;
  if (!updates || typeof updates !== "object") {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  // Filter to only known keys
  const allowedKeys: (keyof AscanConfig)[] = [
    "idealab_api_key",
    "idealab_base_url",
    "llm_model",
    "llm_max_concurrency",
    "github_token",
    "github_topics",
    "github_max_repos_per_topic",
    "github_min_stars",
    "github_top_analyze",
    "arxiv_subjects",
    "arxiv_date_offset_days",
    "max_papers_per_subject",
    "max_total_papers",
    "semantic_scholar_api_key",
    "conference_lookback_days",
    "conference_rank_filter",
    "conference_categories",
    "blog_max_per_source",
    "wechat_rss_base_url",
    "wechat_limit_per_mp",
    "output_dir",
    "log_level",
  ];
  const filtered: Partial<AscanConfig> = {};
  for (const key of allowedKeys) {
    if (key in updates) {
      // Skip masked values — don't overwrite with "***"
      const val = updates[key];
      if (val == null) continue;
      if (typeof val === "string" && val === "***") continue;
      (filtered as any)[key] = val;
    }
  }

  try {
    const updated = await updateConfig(filtered);
    res.json(maskConfig(updated));
  } catch (err: any) {
    console.error("[ascan] updateConfig failed:", err);
    res.status(500).json({ error: "Failed to update config" });
  }
});

/**
 * POST /api/ascan/trigger
 * Trigger an ascan pipeline run.
 * Body: { date?: string }  — YYYYMMDD format, optional
 */
ascanRouter.post("/trigger", async (req: AuthRequest, res) => {
  const { date } = req.body || {};
  if (date && !/^\d{8}$/.test(date)) {
    res.status(400).json({ error: "Invalid date format. Use YYYYMMDD." });
    return;
  }
  try {
    const result = await triggerRun(date);
    res.json(result);
  } catch (err: any) {
    console.error("[ascan] triggerRun failed:", err);
    const message = err?.message?.includes("already in progress")
      ? "A pipeline run is already in progress"
      : "Failed to trigger pipeline run";
    res.status(err?.message?.includes("already in progress") ? 409 : 500).json({ error: message });
  }
});

/**
 * GET /api/ascan/status
 * Check current run status (lock file, recent logs).
 */
ascanRouter.get("/status", async (_req: AuthRequest, res) => {
  try {
    const status = await getRunStatus();
    res.json(status);
  } catch (err: any) {
    console.error("[ascan] getStatus failed:", err);
    res.status(500).json({ error: "Failed to get status" });
  }
});
