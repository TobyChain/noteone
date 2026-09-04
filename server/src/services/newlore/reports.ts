/**
 * NewLore reports — list / read / delete / summarize daily HTML reports.
 * Extracted from the former newlore-bridge.ts.
 */
import { readdir, readFile, writeFile, stat, unlink } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { chatCompletion, isLLMConfigured, getDefaultLLMConfig } from "../llm.js";
import { NEWLORE_DOCS, LEGACY_NEWSEE_ROOT, LEGACY_ASCAN_ROOT } from "./config.js";

const reportRoots = () => [NEWLORE_DOCS, join(LEGACY_NEWSEE_ROOT, "docs"), join(LEGACY_ASCAN_ROOT, "docs")];
const REPORT_PREFIXES = ["NewLore", "NewSee", "Ascan"] as const;
const reportFilename = (prefix: string, date: string, ext: string) => `${prefix}-${date}.${ext}`;
export const hasReportArtifact = (files: string[], date: string, ext: string): boolean =>
  REPORT_PREFIXES.some((prefix) => files.includes(reportFilename(prefix, date, ext)));
export const getReportStorageRoots = (): string[] => reportRoots();
const findReportFile = (date: string, ext: string): string => {
  for (const root of reportRoots()) {
    for (const prefix of REPORT_PREFIXES) {
      const filename = reportFilename(prefix, date, ext);
      if (existsSync(join(root, filename))) return join(root, filename);
    }
  }
  return join(NEWLORE_DOCS, reportFilename(REPORT_PREFIXES[0], date, ext));
};

export interface NewLoreReportMeta {
  date: string;
  filename: string;
  size: number;
  hasMarkdown: boolean;
  summary: string;
}

export async function seedReportIfNeeded(): Promise<void> {
  try {
    const files = await readdir(NEWLORE_DOCS).catch(() => [] as string[]);
    const htmlFiles = files.filter((f) => /^NewLore-\d{8}\.html$/.test(f));
    if (htmlFiles.length > 0) return;

    const seedDate = "00000000";
    const seedPath = join(NEWLORE_DOCS, `NewLore-${seedDate}.html`);
    const seedHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>新知-示例</title>
  <style>body{font-family:system-ui,sans-serif;max-width:900px;margin:0 auto;padding:24px;color:#191919}h2{border-bottom:1px solid #e8e7e4;padding-bottom:8px}p{line-height:1.6}</style>
</head>
<body>
  <nav style="background:#f7f7f5;border-radius:12px;padding:12px 16px;margin-bottom:32px">
    <div style="font-weight:600;font-size:14px">大纲</div>
    <a href="#arxiv-papers" style="display:block;padding:4px;color:#2383e2;text-decoration:none">1 · arXiv 论文精选</a>
    <a href="#github-repos" style="display:block;padding:4px;color:#2383e2;text-decoration:none">2 · GitHub 项目挖掘</a>
  </nav>
  <section id="arxiv-papers" style="margin-bottom:32px">
    <h2>Part 1 — arXiv 论文精选</h2>
    <p>这是新知模块的示例日报。当你运行新知 pipeline 后，这里会显示经过 LLM 筛选和翻译的 arXiv 前沿论文。</p>
  </section>
  <section id="github-repos">
    <h2>Part 2 — GitHub 项目挖掘</h2>
    <p>这里是当日 GitHub 热门项目的深度分析，涵盖 AI Agent、RAG、多模态等方向。</p>
  </section>
</body>
</html>`;
    await writeFile(seedPath, seedHtml, "utf-8");
    console.log("[newlore] seed report created");
  } catch (err) {
    console.error("[newlore] seed report failed:", err);
  }
}

export async function listReports(): Promise<NewLoreReportMeta[]> {
  try {
    const entries = await Promise.all(reportRoots().map(async (root) => ({ root, files: await readdir(root).catch(() => [] as string[]) })));
    const files = entries.flatMap(({ root, files }) => files.filter((f) => /^(NewLore|NewSee|Ascan)-\d{8}\.html$/.test(f)).map((f) => ({ root, name: f })));
    const reports: NewLoreReportMeta[] = [];
    const seen = new Set<string>();
    for (const { root, name: f } of files) {
      const date = f.match(/^(?:NewLore|NewSee|Ascan)-(\d{8})\.html$/)![1];
      if (seen.has(date)) continue;
      seen.add(date);
      const filePath = join(root, f);
      const st = await stat(filePath);
      const hasMd = entries.some((entry) => hasReportArtifact(entry.files, date, "md"));
      let summary = "";
      const summaryPath = findReportFile(date, "summary");
      try {
        summary = (await readFile(summaryPath, "utf-8")).trim();
      } catch {
        const html = await readFile(filePath, "utf-8");
        summary = extractSummary(html);
      }
      reports.push({ date, filename: f, size: st.size, hasMarkdown: hasMd, summary });
    }
    reports.sort((a, b) => b.date.localeCompare(a.date));
    return reports.slice(0, 10);
  } catch {
    return [];
  }
}

export function extractSummary(html: string): string {
  const h2Matches = html.match(/<h2>[^<]+<\/h2>/g);
  if (!h2Matches || h2Matches.length === 0) return "";
  const sections = h2Matches.map((h) => h.replace(/<\/?h2>/g, "").replace(/^\d+ — /, ""));
  return sections.join(" · ");
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function generateReportSummary(
  date: string,
  llmConfig?: { apiKey: string; baseUrl: string; model: string },
): Promise<string> {
  const htmlPath = findReportFile(date, "html");
  const summaryPath = join(NEWLORE_DOCS, `NewLore-${date}.summary`);
  try {
    const html = await readFile(htmlPath, "utf-8");
    const text = stripHtml(html).slice(0, 3000);
    const cfg = llmConfig ?? getDefaultLLMConfig();
    if (!isLLMConfigured(cfg)) {
      const fallback = extractSummary(html);
      await writeFile(summaryPath, fallback, "utf-8");
      return fallback;
    }
    const summary = await chatCompletion(
      [
        { role: "system", content: "你是一个科技日报编辑。请用一句话（不超过60个字）概括今天日报的核心内容，突出重点方向和关键发现。不要使用标点符号开头。" },
        { role: "user", content: `以下是今日科技日报的正文内容，请生成摘要：\n\n${text}` },
      ],
      cfg,
    );
    const cleaned = summary.trim().replace(/^["'""]|["'""]$/g, "");
    await writeFile(summaryPath, cleaned, "utf-8");
    console.log(`[newlore] generated LLM summary for ${date}: ${cleaned.slice(0, 60)}`);
    return cleaned;
  } catch (err) {
    console.error(`[newlore] generateReportSummary failed for ${date}:`, err);
    return "";
  }
}

export async function getReport(date: string): Promise<string | null> {
  const filePath = findReportFile(date, "html");
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

export function getReportPath(date: string): string | null {
  if (!/^\d{8}$/.test(date)) return null;
  return findReportFile(date, "html");
}

export function getDocsPath(): string {
  return NEWLORE_DOCS;
}

/**
 * Delete a daily report and its sidecar files (html / md / summary).
 * Refuses to delete today's report while a pipeline run is in progress,
 * since the file may be mid-write.
 */
export async function deleteReport(date: string): Promise<{ deleted: boolean; date: string }> {
  if (!/^\d{8}$/.test(date)) throw new Error("Invalid date format");
  const { getRunStatus, todayDateStr } = await import("./runner.js");
  const status = await getRunStatus();
  if (status.isRunning && date === todayDateStr()) {
    throw new Error("Cannot delete today's report while pipeline is running");
  }
  const variants = ["html", "md", "summary"];
  let deleted = false;
  for (const ext of variants) {
    for (const root of reportRoots()) {
      for (const prefix of REPORT_PREFIXES) {
        const p = join(root, reportFilename(prefix, date, ext));
        try { await unlink(p); deleted = true; } catch {}
      }
    }
  }
  console.log(`[newlore] deleted report ${date} (removed=${deleted})`);
  return { deleted, date };
}
