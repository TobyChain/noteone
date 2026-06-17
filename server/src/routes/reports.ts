/**
 * Reports API routes.
 * - POST /api/reports/daily — generate today's report (idempotent)
 * - GET /api/reports — list all reports for the user
 * - GET /api/reports/:id — get a single report (with HTML)
 * - DELETE /api/reports/:id — delete a report
 */

import { Router } from "express";
import { db } from "../db/client.js";
import { dailyReports } from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { AuthRequest } from "../middleware/auth.js";
import { generateDailyReport, ReportStyle, ReportDepth } from "../services/report-generator.js";

export const reportsRouter = Router();

/**
 * POST /api/reports/daily
 * Generate a daily report for the specified date.
 * Body: { date?: string, style?: ReportStyle, depth?: ReportDepth }
 * Idempotent: if a completed report already exists for the date, returns it.
 */
reportsRouter.post("/daily", async (req: AuthRequest, res) => {
  const { date, style = "minimal", depth = "brief" } = req.body || {};

  // Default to today's date in Asia/Shanghai timezone
  const reportDate = date || new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD." });
    return;
  }

  // Validate style
  const validStyles: ReportStyle[] = ["minimal", "academic", "dashboard", "handwritten"];
  if (!validStyles.includes(style)) {
    res.status(400).json({ error: `Invalid style. Must be one of: ${validStyles.join(", ")}` });
    return;
  }

  // Validate depth
  const validDepths: ReportDepth[] = ["brief", "deep", "action"];
  if (!validDepths.includes(depth)) {
    res.status(400).json({ error: `Invalid depth. Must be one of: ${validDepths.join(", ")}` });
    return;
  }

  try {
    const result = await generateDailyReport(req.userId!, reportDate, style, depth);
    res.json({
      id: result.id,
      date: reportDate,
      style,
      depth,
      status: result.status,
      htmlContent: result.htmlContent,
    });
  } catch (err: any) {
    console.error("[reports] Generation failed:", err);
    res.status(500).json({ error: "Report generation failed", message: err?.message });
  }
});

/**
 * GET /api/reports
 * List all reports for the current user, ordered by date descending.
 */
reportsRouter.get("/", async (req: AuthRequest, res) => {
  const reports = await db.query.dailyReports.findMany({
    where: eq(dailyReports.userId, req.userId!),
    orderBy: [desc(dailyReports.date)],
    columns: {
      id: true,
      date: true,
      style: true,
      depth: true,
      status: true,
      sourceNoteIds: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  res.json({ reports });
});

/**
 * GET /api/reports/:id
 * Get a single report with its HTML content.
 */
reportsRouter.get("/:id", async (req: AuthRequest, res) => {
  const reportId = req.params.id as string;

  const report = await db.query.dailyReports.findFirst({
    where: and(
      eq(dailyReports.id, reportId),
      eq(dailyReports.userId, req.userId!),
    ),
  });

  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  res.json(report);
});

/**
 * DELETE /api/reports/:id
 * Delete a report.
 */
reportsRouter.delete("/:id", async (req: AuthRequest, res) => {
  const reportId = req.params.id as string;

  const report = await db.query.dailyReports.findFirst({
    where: and(
      eq(dailyReports.id, reportId),
      eq(dailyReports.userId, req.userId!),
    ),
  });

  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  await db.delete(dailyReports).where(eq(dailyReports.id, reportId));
  res.json({ ok: true });
});
