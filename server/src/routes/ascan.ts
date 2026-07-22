/**
 * Ascan API routes (thin layer — business logic lives in services/ascan/*).
 * Errors bubble up to the central error handler in index.ts.
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
import { getConfig, updateConfig, maskConfig, sanitizeConfigUpdates } from "../services/ascan/config.js";
import {
  triggerRun,
  abortRun,
  getRunStatus,
  runModule,
  mergeReport,
} from "../services/ascan/runner.js";
import { moduleNames } from "../services/ascan/pipeline/index.js";
import { getUserChatConfig } from "../services/user-config.js";
import { checkWechatHealth } from "../services/wechat/service.js";

export const ascanRouter = Router();

function validDate(date: unknown): date is string {
  return typeof date === "string" && /^\d{8}$/.test(date);
}

ascanRouter.get("/reports", async (_req: AuthRequest, res) => {
  res.json({ reports: await listReports() });
});

ascanRouter.get("/reports/:date", async (req: AuthRequest, res) => {
  const date = req.params.date as string;
  if (!validDate(date)) {
    res.status(400).json({ error: "Invalid date format. Use YYYYMMDD." });
    return;
  }
  const html = await getReport(date);
  if (!html) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  res.json({ date, html });
});

ascanRouter.get("/reports/:date/path", async (req: AuthRequest, res) => {
  const date = req.params.date as string;
  if (!validDate(date)) {
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

ascanRouter.delete("/reports/:date", async (req: AuthRequest, res) => {
  const date = req.params.date as string;
  if (!validDate(date)) {
    res.status(400).json({ error: "Invalid date format. Use YYYYMMDD." });
    return;
  }
  try {
    res.json(await deleteReport(date));
  } catch (err: any) {
    if (err?.message?.includes("running")) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
});

ascanRouter.get("/config", async (_req: AuthRequest, res) => {
  res.json(maskConfig(await getConfig()));
});

ascanRouter.patch("/config", async (req: AuthRequest, res) => {
  if (!req.body || typeof req.body !== "object") {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const updated = await updateConfig(sanitizeConfigUpdates(req.body));
  res.json(maskConfig(updated));
});

ascanRouter.post("/trigger", async (req: AuthRequest, res) => {
  const { date } = req.body || {};
  if (date && !validDate(date)) {
    res.status(400).json({ error: "Invalid date format. Use YYYYMMDD." });
    return;
  }
  try {
    const llmConfig = await getUserChatConfig(req.userId!);
    res.json(await triggerRun(date, llmConfig, req.userId!));
  } catch (err: any) {
    if (err?.message?.includes("已在运行中")) {
      res.status(409).json({ error: "A pipeline run is already in progress" });
      return;
    }
    throw err;
  }
});

ascanRouter.post("/run-module", async (req: AuthRequest, res) => {
  const { module, date } = req.body || {};
  const allowed: string[] = moduleNames();
  if (!module || !allowed.includes(module)) {
    res.status(400).json({ error: `Invalid module. Allowed: ${allowed.join(", ")}` });
    return;
  }
  if (date && !validDate(date)) {
    res.status(400).json({ error: "Invalid date format. Use YYYYMMDD." });
    return;
  }
  const llmConfig = await getUserChatConfig(req.userId!);
  res.json(await runModule(module, date, llmConfig, req.userId!));
});

ascanRouter.post("/merge", async (req: AuthRequest, res) => {
  const { date } = req.body || {};
  if (date && !validDate(date)) {
    res.status(400).json({ error: "Invalid date format. Use YYYYMMDD." });
    return;
  }
  res.json(await mergeReport(date, req.userId!));
});

ascanRouter.get("/status", async (_req: AuthRequest, res) => {
  res.json(await getRunStatus());
});

ascanRouter.post("/abort", async (_req: AuthRequest, res) => {
  res.json(await abortRun());
});

ascanRouter.get("/docs-path", async (_req: AuthRequest, res) => {
  res.json({ path: getDocsPath() });
});

ascanRouter.get("/wechat-health", async (_req: AuthRequest, res) => {
  res.json(await checkWechatHealth());
});

ascanRouter.post("/summarize", async (req: AuthRequest, res) => {
  const { date } = req.body || {};
  if (date) {
    if (!validDate(date)) {
      res.status(400).json({ error: "Invalid date format. Use YYYYMMDD." });
      return;
    }
    res.json({ date, summary: await generateReportSummary(date) });
    return;
  }
  const reports = await listReports();
  const results: { date: string; summary: string }[] = [];
  for (const r of reports) {
    results.push({ date: r.date, summary: await generateReportSummary(r.date) });
  }
  res.json({ summaries: results });
});
