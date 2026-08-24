/**
 * learn-art service — generates single-file HTML study reports from URLs.
 * Distilled from the learn-art skill (9-chapter format + template).
 * Runs asynchronously in the background; progress tracked via module-level state.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { db } from "../../db/client.js";
import { notes } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { fetchUrlContent } from "../web-fetch.js";
import { chatCompletion, type LLMConfig } from "../llm.js";

const CHAPTER_TITLES = [
  "一句话理解", "项目/文章卡片", "为什么存在", "架构/模块拆解",
  "核心观点逐条解析", "关键代码 + 大白话", "端到端流程", "心智模型", "延伸阅读",
];

function loadTemplate(): string {
  const candidates = [
    join(process.cwd(), "src/services/notty/resources/learn-art-template.html"),
    join(process.cwd(), "notty-resources/learn-art-template.html"),
    join(dirname(fileURLToPath(import.meta.url)), "resources/learn-art-template.html"),
  ];
  for (const p of candidates) {
    try { return readFileSync(p, "utf-8"); } catch {}
  }
  throw new Error("learn-art template not found");
}

let cachedTemplate: string | null = null;
function getTemplate(): string {
  if (!cachedTemplate) cachedTemplate = loadTemplate();
  return cachedTemplate;
}

const LEARN_ART_PROMPT = `你是一个深度技术分析专家。请基于以下内容，生成一份 learn-art 深度解析报告的 HTML 片段。

报告必须包含 9 个章节，每个章节用 <section id="sec-N"> 包裹：

1. 一句话理解 (≤80字概括)
2. 项目/文章卡片 (元信息表格)
3. 为什么存在 (逐条列出痛点≥2、已有方案不足≥2、设计理念)
4. 架构/模块拆解 (≥1个 Mermaid 图 + ≥3个模块详解)
5. 核心观点/抽象逐条解析 (3-7个概念，每个含定义/为什么需要/机制/关系/定位)
6. 关键代码/公式 + 大白话 (≥3组，用 <div class="code-pair"><pre><code>...</code></pre><div class="explain">...</div></div>)
7. 端到端流程 (≥1个 Mermaid sequenceDiagram 或 flowchart)
8. 心智模型 (≥2个类比)
9. 延伸阅读 (关键文件/参考论文表格)

格式要求：
- 直接输出 <section> 标签内容，不要输出完整 HTML 文档
- Mermaid 图用 <div class="mermaid">graph TD ...</div> 包裹
- 全文中文（代码/专有名词除外）
- 不需要 markdown 代码块标记

源内容：
标题：{title}
URL：{url}

{content}`;

export interface StudyReportProgress {
  isRunning: boolean;
  url: string;
  phase: "fetching" | "generating" | "saving" | "done" | "failed";
  error: string | null;
  noteId: string | null;
  title: string | null;
  startedAt: string | null;
}

let studyReportProgress: StudyReportProgress | null = null;

export function getStudyReportProgress(): StudyReportProgress | null {
  return studyReportProgress;
}

export async function startStudyReport(
  url: string,
  userId: string,
  llmConfig: LLMConfig,
): Promise<{ started: boolean; url: string }> {
  if (studyReportProgress?.isRunning) {
    throw new Error("已有学习报告正在生成中，请稍候");
  }
  studyReportProgress = {
    isRunning: true,
    url,
    phase: "fetching",
    error: null,
    noteId: null,
    title: null,
    startedAt: new Date().toISOString(),
  };

  runStudyReport(url, userId, llmConfig).catch((err) => {
    console.error("[learn-art] background error:", err);
    studyReportProgress!.isRunning = false;
    studyReportProgress!.phase = "failed";
    studyReportProgress!.error = String(err?.message || err);
  });

  return { started: true, url };
}

async function runStudyReport(url: string, userId: string, llmConfig: LLMConfig): Promise<void> {
  // Step 1: Fetch URL content
  studyReportProgress!.phase = "fetching";
  const fetched = await fetchUrlContent(url, 30000);
  if (fetched.error) throw new Error(`URL 获取失败: ${fetched.error}`);
  const title = fetched.title || url;

  // Step 2: Generate HTML sections via LLM
  studyReportProgress!.phase = "generating";
  const prompt = LEARN_ART_PROMPT
    .replace("{title}", title)
    .replace("{url}", url)
    .replace("{content}", fetched.content.slice(0, 30000));

  const sectionsHtml = await chatCompletion(
    [{ role: "user", content: prompt }],
    { ...llmConfig, maxTokens: 16384 } as LLMConfig,
  );

  // Step 3: Fill template
  const tocItems = CHAPTER_TITLES
    .map((ch, i) => `<li><a href="#sec-${i + 1}">${ch}</a></li>`)
    .join("\n      ");

  const metaFooter = `<p>生成时间: ${new Date().toLocaleString("zh-CN")} | 源链接: <a href="${url}" target="_blank">${url}</a> | 由 learn-art (闹闹) 生成</p>`;

  const fullHtml = getTemplate()
    .replace(/\{\{TITLE\}\}/g, `${title} · learn-art`)
    .replace("{{SUBTITLE}}", url)
    .replace("{{TOC_ITEMS}}", tocItems)
    .replace("{{SECTIONS_HTML}}", sectionsHtml)
    .replace("{{META_FOOTER}}", metaFooter);

  // Step 4: Save as note
  studyReportProgress!.phase = "saving";
  const [note] = await db.insert(notes).values({
    userId,
    contentType: "html",
    title: `${title} · learn-art`,
    content: fullHtml,
    sourceUrl: url,
    sourceApp: "learn-art",
    author: fetched.author || null,
    authorOrg: fetched.siteName || null,
    status: "active",
    aiSummary: `learn-art 深度解析报告：${title}`,
  }).returning();

  studyReportProgress!.noteId = note.id;
  studyReportProgress!.title = note.title;
  studyReportProgress!.phase = "done";
  studyReportProgress!.isRunning = false;

  console.log(`[learn-art] report saved noteId=${note.id} title=${title.slice(0, 50)}`);
}
