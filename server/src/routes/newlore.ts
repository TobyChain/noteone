/**
 * NewLore API routes (thin layer — business logic lives in services/newlore/*).
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
} from "../services/newlore/reports.js";
import { getEffectiveConfig, updateEffectiveConfig, maskConfig, sanitizeConfigUpdates } from "../services/newlore/config.js";
import {
  triggerRun,
  abortRun,
  getRunStatus,
  runModule,
  mergeReport,
} from "../services/newlore/runner.js";
import { moduleNames } from "../services/newlore/pipeline/index.js";
import { getUserChatConfig } from "../services/user-config.js";
import { checkWechatHealth } from "../services/wechat/service.js";
import { isLLMConfigured } from "../services/llm.js";
import { PRESETS, applyPreset } from "../services/newlore/presets.js";
import { getStudyReportProgress } from "../services/notty/learn-art.js";

export const newloreRouter = Router();

const LLM_NOT_CONFIGURED_MSG = "AI 模型未配置，请先在设置中配置 API Key";

function validDate(date: unknown): date is string {
  return typeof date === "string" && /^\d{8}$/.test(date);
}

newloreRouter.get("/reports", async (_req: AuthRequest, res) => {
  res.json({ reports: await listReports() });
});

newloreRouter.get("/reports/:date", async (req: AuthRequest, res) => {
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

newloreRouter.get("/reports/:date/path", async (req: AuthRequest, res) => {
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

newloreRouter.delete("/reports/:date", async (req: AuthRequest, res) => {
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

newloreRouter.get("/config", async (req: AuthRequest, res) => {
  res.json(maskConfig(await getEffectiveConfig(req.userId)));
});

newloreRouter.patch("/config", async (req: AuthRequest, res) => {
  if (!req.body || typeof req.body !== "object") {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const updated = await updateEffectiveConfig(req.userId, sanitizeConfigUpdates(req.body));
  res.json(maskConfig(updated));
});

newloreRouter.get("/presets", async (_req: AuthRequest, res) => {
  res.json({ presets: PRESETS.map((p) => ({ id: p.id, name: p.name, description: p.description })) });
});

newloreRouter.post("/config/preset", async (req: AuthRequest, res) => {
  const { presetId } = req.body || {};
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset) {
    res.status(400).json({ error: "Unknown preset" });
    return;
  }
  const updated = await updateEffectiveConfig(req.userId, applyPreset(preset));
  res.json(maskConfig(updated));
});

newloreRouter.post("/trigger", async (req: AuthRequest, res) => {
  const { date } = req.body || {};
  if (date && !validDate(date)) {
    res.status(400).json({ error: "Invalid date format. Use YYYYMMDD." });
    return;
  }
  try {
    const llmConfig = await getUserChatConfig(req.userId!);
    if (!isLLMConfigured(llmConfig)) {
      res.status(400).json({ error: LLM_NOT_CONFIGURED_MSG });
      return;
    }
    res.json(await triggerRun(date, llmConfig, req.userId!));
  } catch (err: any) {
    if (err?.message?.includes("已在运行中")) {
      res.status(409).json({ error: "A pipeline run is already in progress" });
      return;
    }
    throw err;
  }
});

newloreRouter.post("/run-module", async (req: AuthRequest, res) => {
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
  if (!isLLMConfigured(llmConfig)) {
    res.status(400).json({ error: LLM_NOT_CONFIGURED_MSG });
    return;
  }
  res.json(await runModule(module, date, llmConfig, req.userId!));
});

newloreRouter.post("/merge", async (req: AuthRequest, res) => {
  const { date } = req.body || {};
  if (date && !validDate(date)) {
    res.status(400).json({ error: "Invalid date format. Use YYYYMMDD." });
    return;
  }
  res.json(await mergeReport(date, req.userId!));
});

newloreRouter.get("/status", async (_req: AuthRequest, res) => {
  const status = await getRunStatus();
  res.json({ ...status, studyReport: getStudyReportProgress() });
});

newloreRouter.post("/abort", async (_req: AuthRequest, res) => {
  res.json(await abortRun());
});

newloreRouter.get("/docs-path", async (_req: AuthRequest, res) => {
  res.json({ path: getDocsPath() });
});

newloreRouter.get("/wechat-health", async (req: AuthRequest, res) => {
  res.json(await checkWechatHealth(req.userId));
});

newloreRouter.post("/summarize", async (req: AuthRequest, res) => {
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
