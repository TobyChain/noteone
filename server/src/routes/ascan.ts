/**
 * Ascan API routes.
 * - GET  /api/ascan/reports        — list all daily reports
 * - GET  /api/ascan/reports/:date  — get a single report's HTML
 * - GET  /api/ascan/reports/:date/path — get file path for a report
 * - DELETE /api/ascan/reports/:date — delete a daily report
 * - GET  /api/ascan/config         — get current ascan configuration
 * - PATCH /api/ascan/config        — update ascan configuration
 * - POST /api/ascan/trigger        — trigger a full pipeline run (fire-and-forget)
 * - POST /api/ascan/run-module     — run a single module (blocking, for 闹闹 orchestration)
 * - POST /api/ascan/merge          — merge module fragments into a report (blocking)
 * - POST /api/ascan/abort          — abort a running pipeline
 * - GET  /api/ascan/status         — check run status
 * - GET  /api/ascan/docs-path      — get docs directory path for Finder reveal
 */

import { Router } from "express";
import { AuthRequest } from "../middleware/auth.js";
import {
  listReports,
  getReport,
  deleteReport,
  getReportPath,
  generateReportSummary,
  getDocsPath,
} from "../services/ascan/reports.js";
import { getConfig, updateConfig, type AscanConfig } from "../services/ascan/config.js";
import {
  triggerRun,
  abortRun,
  getRunStatus,
  runModule,
  mergeReport,
} from "../services/ascan/runner.js";
import { getUserChatConfig } from "../services/user-config.js";

export const ascanRouter = Router();

const SENSITIVE_KEYS: (keyof AscanConfig)[] = ["llm_api_key", "github_token", "semantic_scholar_api_key"];

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
 * GET /api/ascan/reports/:date/path
 * Get the file system path for a report (for "reveal in Finder").
 */
ascanRouter.get("/reports/:date/path", async (req: AuthRequest, res) => {
  const date = req.params.date as string;
  if (!/^\d{8}$/.test(date)) {
    res.status(400).json({ error: "Invalid date format. Use YYYYMMDD." });
    return;
  }
  const filePath = getReportPath(date);
  if (!filePath) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  res.json({ date, path: filePath });
});

/**
 * DELETE /api/ascan/reports/:date
 * Delete a daily report and its sidecar files (html / md / summary).
 */
ascanRouter.delete("/reports/:date", async (req: AuthRequest, res) => {
  const date = req.params.date as string;
  if (!/^\d{8}$/.test(date)) {
    res.status(400).json({ error: "Invalid date format. Use YYYYMMDD." });
    return;
  }
  try {
    const result = await deleteReport(date);
    res.json(result);
  } catch (err: any) {
    if (err?.message?.includes("running")) {
      res.status(409).json({ error: err.message });
    } else {
      console.error("[ascan] deleteReport failed:", err);
      res.status(500).json({ error: "Failed to delete report" });
    }
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
    "llm_api_key",
    "llm_base_url",
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
    const llmConfig = await getUserChatConfig(req.userId!);
    const result = await triggerRun(date, llmConfig);
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
 * POST /api/ascan/run-module
 * Run a single ascan module (blocking). Returns the module result.
 * Body: { module: string, date?: string }
 */
ascanRouter.post("/run-module", async (req: AuthRequest, res) => {
  const { module, date } = req.body || {};
  const allowed = ["arxiv", "github", "official", "blog", "conference", "wechat"];
  if (!module || !allowed.includes(module)) {
    res.status(400).json({ error: `Invalid module. Allowed: ${allowed.join(", ")}` });
    return;
  }
  if (date && !/^\d{8}$/.test(date)) {
    res.status(400).json({ error: "Invalid date format. Use YYYYMMDD." });
    return;
  }
  try {
    const llmConfig = await getUserChatConfig(req.userId!);
    const result = await runModule(module, date, llmConfig);
    res.json(result);
  } catch (err: any) {
    console.error("[ascan] runModule failed:", err);
    res.status(500).json({ error: `Failed to run module ${module}: ${err?.message || err}` });
  }
});

/**
 * POST /api/ascan/merge
 * Merge already-run module fragments into a daily report (blocking).
 * Body: { date?: string }
 */
ascanRouter.post("/merge", async (req: AuthRequest, res) => {
  const { date } = req.body || {};
  if (date && !/^\d{8}$/.test(date)) {
    res.status(400).json({ error: "Invalid date format. Use YYYYMMDD." });
    return;
  }
  try {
    const result = await mergeReport(date);
    res.json(result);
  } catch (err: any) {
    console.error("[ascan] mergeReport failed:", err);
    res.status(500).json({ error: `Failed to merge: ${err?.message || err}` });
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

/**
 * POST /api/ascan/abort
 * Abort a running pipeline (kills the process, removes lock file).
 */
ascanRouter.post("/abort", async (_req: AuthRequest, res) => {
  try {
    const result = await abortRun();
    res.json(result);
  } catch (err: any) {
    console.error("[ascan] abortRun failed:", err);
    res.status(500).json({ error: "Failed to abort pipeline" });
  }
});

/**
 * GET /api/ascan/docs-path
 * Get the docs directory path (for "reveal in Finder").
 */
ascanRouter.get("/docs-path", async (_req: AuthRequest, res) => {
  try {
    res.json({ path: getDocsPath() });
  } catch {
    res.status(500).json({ error: "Failed to get docs path" });
  }
});

/**
 * POST /api/ascan/summarize
 * Generate LLM summary for a report (or all reports missing summaries).
 * Body: { date?: string }  — YYYYMMDD, optional. If omitted, generates for all.
 */
ascanRouter.post("/summarize", async (req: AuthRequest, res) => {
  try {
    const { date } = req.body || {};
    if (date) {
      if (!/^\d{8}$/.test(date)) {
        res.status(400).json({ error: "Invalid date format. Use YYYYMMDD." });
        return;
      }
      const summary = await generateReportSummary(date);
      res.json({ date, summary });
    } else {
      const reports = await listReports();
      const results: { date: string; summary: string }[] = [];
      for (const r of reports) {
        const summary = await generateReportSummary(r.date);
        results.push({ date: r.date, summary });
      }
      res.json({ summaries: results });
    }
  } catch (err: any) {
    console.error("[ascan] summarize failed:", err);
    res.status(500).json({ error: "Failed to generate summaries" });
  }
});
