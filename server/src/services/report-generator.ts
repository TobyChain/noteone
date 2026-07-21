/**
 * Daily report generator service.
 * Reads today's notes, uses Notty's tool chain to research and expand knowledge,
 * then renders an HTML report in the user's chosen style × depth.
 */

import { db, rowsOf } from "../db/client.js";
import { notes, noteTags, tags, dailyReports } from "../db/schema.js";
import { eq, and, gte, lte, ne, inArray, sql, desc } from "drizzle-orm";
import { generateEmbedding } from "./llm.js";
import { runAgentLoop, ToolDefinition, ToolHandler } from "./notty/agent-loop.js";
import { searchWeb, fetchSearchResult, SearchResult } from "./web-search.js";
import { fetchUrlContent } from "./web-fetch.js";
import { getUserChatConfig } from "./user-config.js";

export type ReportStyle = "minimal" | "academic" | "dashboard" | "handwritten";
export type ReportDepth = "brief" | "deep" | "action";

interface ReportSection {
  type: "insight" | "knowledge" | "action" | "theme" | "connection";
  title: string;
  content: string;
  sources?: string[]; // note titles or URLs
}

interface ReportData {
  title: string;
  date: string;
  summary: string;
  themes: string[];
  sections: ReportSection[];
  expandedKnowledge: Array<{ topic: string; finding: string; source: string }>;
  actionItems: string[];
  noteCount: number;
}

/**
 * Generate a daily report for the given date.
 * Idempotent: if a completed report already exists for this date, returns it.
 */
export async function generateDailyReport(
  userId: string,
  date: string, // YYYY-MM-DD
  style: ReportStyle = "minimal",
  depth: ReportDepth = "brief",
): Promise<{ id: string; status: string; htmlContent: string | null }> {
  const start = Date.now();
  console.log(`[report] start userId=${userId.slice(0, 8)} date=${date} style=${style} depth=${depth}`);

  // Check for existing report (idempotent)
  const existing = await db.query.dailyReports.findFirst({
    where: and(eq(dailyReports.userId, userId), eq(dailyReports.date, date)),
  });

  if (existing && existing.status === "completed") {
    console.log(`[report] cached userId=${userId.slice(0, 8)} date=${date} duration=${Date.now() - start}ms`);
    return { id: existing.id, status: existing.status, htmlContent: existing.htmlContent };
  }

  // If there's a failed or generating report, delete and regenerate
  if (existing) {
    await db.delete(dailyReports).where(eq(dailyReports.id, existing.id));
  }

  // Create generating record
  const [report] = await db.insert(dailyReports).values({
    userId,
    date,
    style,
    depth,
    status: "generating",
  }).returning();

  try {
    // 1. Read today's notes
    const todayNotes = await getTodayNotes(userId, date);
    const allNotes = await getAllNotes(userId);

    if (todayNotes.length === 0) {
      // Still generate a report even with no notes (user requirement: 照常生成)
      const html = renderEmptyReport(date, style, depth);
      await db.update(dailyReports)
        .set({ status: "completed", htmlContent: html, updatedAt: new Date() })
        .where(eq(dailyReports.id, report.id));
      return { id: report.id, status: "completed", htmlContent: html };
    }

    // 2. Build report generation plan
    const reportData = await runReportPipeline(userId, todayNotes, allNotes, date, depth);

    // 3. Render HTML
    const html = renderReportHtml(reportData, style, depth);

    // 4. Save to DB
    const noteIds = todayNotes.map(n => n.id);
    await db.update(dailyReports)
      .set({
        status: "completed",
        htmlContent: html,
        sourceNoteIds: noteIds,
        updatedAt: new Date(),
      })
      .where(eq(dailyReports.id, report.id));

    console.log(`[report] done userId=${userId.slice(0, 8)} date=${date} duration=${Date.now() - start}ms noteCount=${todayNotes.length} sections=${reportData.sections.length}`);
    return { id: report.id, status: "completed", htmlContent: html };
  } catch (err: any) {
    console.error(`[report] failed userId=${userId.slice(0, 8)} date=${date} duration=${Date.now() - start}ms error=${err?.message}`);
    await db.update(dailyReports)
      .set({
        status: "failed",
        errorMessage: err?.message || String(err),
        updatedAt: new Date(),
      })
      .where(eq(dailyReports.id, report.id));
    return { id: report.id, status: "failed", htmlContent: null };
  }
}

// --- Internal helpers ---

interface NoteSummary {
  id: string;
  title: string | null;
  aiSummary: string | null;
  content: string;
  tags: string[];
  createdAt: Date;
}

async function getTodayNotes(userId: string, date: string): Promise<NoteSummary[]> {
  // date is YYYY-MM-DD, query notes created on that date (Asia/Shanghai timezone)
  const startOfDay = new Date(`${date}T00:00:00+08:00`);
  const endOfDay = new Date(`${date}T23:59:59+08:00`);

  const rows = await db.query.notes.findMany({
    where: and(
      eq(notes.userId, userId),
      ne(notes.status, "trashed"),
      gte(notes.createdAt, startOfDay),
      lte(notes.createdAt, endOfDay),
    ),
    orderBy: [desc(notes.createdAt)],
  });

  // Fetch tags for each note
  const noteIds = rows.map(r => r.id);
  const tagRows = noteIds.length > 0
    ? await db.select({ noteId: noteTags.noteId, name: tags.name })
        .from(noteTags).innerJoin(tags, eq(noteTags.tagId, tags.id))
        .where(inArray(noteTags.noteId, noteIds))
    : [];

  const tagsByNote = new Map<string, string[]>();
  for (const t of tagRows) {
    const list = tagsByNote.get(t.noteId) || [];
    list.push(t.name);
    tagsByNote.set(t.noteId, list);
  }

  return rows.map(r => ({
    id: r.id,
    title: r.title,
    aiSummary: r.aiSummary,
    content: r.content,
    tags: tagsByNote.get(r.id) || [],
    createdAt: r.createdAt,
  }));
}

async function getAllNotes(userId: string) {
  return db.query.notes.findMany({
    where: and(eq(notes.userId, userId), ne(notes.status, "trashed")),
    columns: { id: true, title: true, aiSummary: true, createdAt: true },
  });
}

/**
 * Run the Notty report pipeline:
 * 1. Understand background (read today's notes)
 * 2. Keyword search (search web for key topics)
 * 3. Expand knowledge (fetch relevant web pages)
 * 4. Organize viewpoints (synthesize)
 * 5. Present conclusions (structured output)
 */
async function runReportPipeline(
  userId: string,
  todayNotes: NoteSummary[],
  allNotes: Array<{ id: string; title: string | null; aiSummary: string | null; createdAt: Date }>,
  date: string,
  depth: ReportDepth,
): Promise<ReportData> {
  // Build note index for system prompt
  const noteIndex = todayNotes.map((n, i) =>
    `[${i + 1}] ${n.title || "无标题"} | ${n.aiSummary?.slice(0, 80) || "无摘要"} | tags: ${n.tags.join(", ") || "无"}`
  ).join("\n");

  const historyIndex = allNotes.slice(0, 50).map((n, i) =>
    `[H${i + 1}] ${n.title || "无标题"} | ${n.aiSummary?.slice(0, 60) || ""}`
  ).join("\n");

  const depthGuidance = {
    brief: "产出速览版报告，5分钟可读完。重点提炼3-5个核心洞察，每个洞察用1-2句话说清楚。",
    deep: "产出深度版报告，20分钟可读完。对每个主题做深入分析，引用外部知识做交叉验证，给出详细论证。",
    action: "产出行动清单版报告。把每条笔记转化为可执行的TODO项，标注优先级和预期收益。",
  }[depth];

  const systemPrompt = `你是闹闹，壹识的 AI 助手。你的任务是为用户生成每日灵感报告。

今天是 ${date}，用户今天记录了 ${todayNotes.length} 条笔记：
${noteIndex}

${historyIndex ? `用户的历史笔记索引（供关联参考）：\n${historyIndex}` : ""}

## 报告生成计划

请按以下步骤执行：

1. **了解背景**：用 read_note 读取今天每条笔记的完整内容，理解用户的思考脉络。
2. **关键词搜索**：从笔记中提取 2-3 个关键主题，用 search_web 搜索相关外部信息。
3. **扩展知识**：对搜索结果中最相关的 1-2 个 URL，用 web_fetch 获取详细内容，补充笔记的知识盲区。
4. **观点整理**：把笔记观点和外部知识交叉对比，找出：
   - 用户关注的核心主题
   - 笔记之间的关联和矛盾
   - 外部知识能补充的新视角
5. **结论展示**：${depthGuidance}

## 输出格式

最终请输出一个 JSON 对象（不要 markdown 代码块包裹），格式如下：
{
  "title": "报告标题（不超过20字，有创意）",
  "summary": "一句话总结今天的灵感脉络（不超过50字）",
  "themes": ["主题1", "主题2", "主题3"],
  "sections": [
    {
      "type": "insight|knowledge|action|theme|connection",
      "title": "段落标题",
      "content": "段落内容（markdown 格式）",
      "sources": ["引用的笔记标题或外部URL"]
    }
  ],
  "expandedKnowledge": [
    { "topic": "主题", "finding": "发现", "source": "来源URL" }
  ],
  "actionItems": ["可执行的行动项1", "行动项2"]
}

规则：
- 用中文回答
- sections 数量：brief 版 3-5 个，deep 版 6-10 个，action 版以 actionItems 为主
- 每个 section 的 content 支持 markdown（**粗体**、- 列表、> 引用）
- 必须先 read_note 读取正文再分析，不要凭摘要臆测`;

  // Define tools for the report pipeline
  const tools: ToolDefinition[] = [
    {
      type: "function",
      function: {
        name: "read_note",
        description: "读取某条笔记的完整正文及来源/作者信息。",
        parameters: {
          type: "object",
          properties: {
            index: { type: "number", description: "笔记在索引列表中的序号([N] 里的数字)，从 1 开始" },
            id: { type: "string", description: "笔记的 id（与 index 二选一）" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_notes",
        description: "语义检索用户的历史笔记，找出相关的过往记录。",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "检索关键词" },
            limit: { type: "number", description: "返回条数，默认 5" },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_web",
        description: "在互联网上搜索关键词，返回相关网页的标题、URL 和摘要。用于扩展笔记的外部知识。",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "搜索关键词" },
            maxResults: { type: "number", description: "返回条数，默认 5" },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "web_fetch",
        description: "获取指定 URL 的网页内容，返回纯文本。用于深入阅读搜索结果中的相关文章。",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "要获取的网页 URL" },
          },
          required: ["url"],
        },
      },
    },
  ];

  const toolHandlers: Record<string, ToolHandler> = {
    read_note: async ({ index, id }: { index?: number; id?: string }) => {
      let noteId = typeof id === "string" && id.length > 0 ? id : undefined;
      if (!noteId && typeof index === "number") {
        const target = todayNotes[index - 1];
        if (!target) return `索引 ${index} 超出范围（共 ${todayNotes.length} 条）`;
        noteId = target.id;
      }
      if (!noteId) return "请提供 index 或 id";

      const note = await db.query.notes.findFirst({
        where: and(eq(notes.id, noteId), eq(notes.userId, userId)),
      });
      if (!note) return "笔记不存在";

      const tagRows = await db.select({ name: tags.name })
        .from(noteTags).innerJoin(tags, eq(noteTags.tagId, tags.id))
        .where(eq(noteTags.noteId, noteId));
      const tagStr = tagRows.map(t => `#${t.name}`).join(" ");

      const citation = [
        note.author ? `作者: ${note.author}` : null,
        note.sourceUrl ? `链接: ${note.sourceUrl}` : null,
        `日期: ${note.createdAt.toISOString().slice(0, 10)}`,
      ].filter(Boolean).join(" | ");

      return `标题: ${note.title || "无标题"}\n摘要: ${note.aiSummary || "无"}\n标签: ${tagStr || "无"}\n引用: ${citation}\n\n---\n${note.content}`;
    },

    search_notes: async (args: Record<string, any>) => {
      const query = args.query as string;
      const limit = (args.limit as number) || 5;
      const embedding = await generateEmbedding(query);
      const vectorStr = `[${embedding.join(",")}]`;
      const safeLimit = Math.min(Math.max(limit, 1), 20);
      const result = await db.execute<any>(sql`
        SELECT id, title, ai_summary, content,
               1 - (embedding <=> ${vectorStr}::vector) AS similarity
        FROM notes
        WHERE user_id = ${userId}
          AND status != 'trashed'
          AND embedding IS NOT NULL
        ORDER BY embedding <=> ${vectorStr}::vector
        LIMIT ${safeLimit}
      `);
      const rows = rowsOf(result);
      if (rows.length === 0) return "未找到相关笔记";
      return rows.map((r: any, i: number) =>
        `${i + 1}. id=${r.id} | ${r.title || "无标题"} (${(r.similarity * 100).toFixed(1)}%)\n   ${r.ai_summary || (r.content || "").slice(0, 100)}`
      ).join("\n\n");
    },

    search_web: async (args: Record<string, any>) => {
      const query = args.query as string;
      const maxResults = (args.maxResults as number) || 5;
      const results = await searchWeb(query, { maxResults });
      if (results.length === 0) return "未找到相关结果";
      return results.map((r, i) =>
        `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`
      ).join("\n\n");
    },

    web_fetch: async (args: Record<string, any>) => {
      const url = args.url as string;
      const result = await fetchUrlContent(url);
      if (result.error) return `获取失败: ${result.error}`;
      return `标题: ${result.title}\n\n${result.content}`;
    },
  };

  const chatConfig = await getUserChatConfig(userId);
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `请为今天的笔记生成报告。今天是 ${date}，我记了 ${todayNotes.length} 条笔记。请按照计划执行。` },
  ];

  const reply = await runAgentLoop(messages, tools, toolHandlers, chatConfig, 8);

  // Parse the JSON output
  let reportData: ReportData;
  try {
    // Try to extract JSON from the response
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      reportData = {
        title: parsed.title || `${date} 灵感报告`,
        date,
        summary: parsed.summary || "",
        themes: parsed.themes || [],
        sections: (parsed.sections || []).map((s: any) => ({
          type: s.type || "insight",
          title: s.title || "",
          content: s.content || "",
          sources: s.sources || [],
        })),
        expandedKnowledge: (parsed.expandedKnowledge || []).map((k: any) => ({
          topic: k.topic || "",
          finding: k.finding || "",
          source: k.source || "",
        })),
        actionItems: parsed.actionItems || [],
        noteCount: todayNotes.length,
      };
    } else {
      throw new Error("No JSON found in LLM response");
    }
  } catch (err) {
    console.error("[report-generator] Failed to parse LLM output as JSON, using raw text");
    reportData = {
      title: `${date} 灵感报告`,
      date,
      summary: "今日笔记整理",
      themes: [],
      sections: [{ type: "insight", title: "今日整理", content: reply, sources: [] }],
      expandedKnowledge: [],
      actionItems: [],
      noteCount: todayNotes.length,
    };
  }

  return reportData;
}

// --- HTML Rendering ---

function renderEmptyReport(date: string, style: ReportStyle, depth: ReportDepth): string {
  const data: ReportData = {
    title: `${date} · 安静的一天`,
    date,
    summary: "今天没有新的笔记记录，但闹闹依然在这里等你。",
    themes: [],
    sections: [{
      type: "insight",
      title: "今日无事",
      content: "今天没有记录新的笔记。也许明天会有新的灵感？随时打开 NoteOne，记下你看到的、想到的。",
      sources: [],
    }],
    expandedKnowledge: [],
    actionItems: [],
    noteCount: 0,
  };
  return renderReportHtml(data, style, depth);
}

function renderReportHtml(data: ReportData, style: ReportStyle, depth: ReportDepth): string {
  const styleCss = STYLE_CSS[style] || STYLE_CSS.minimal;
  const sectionsHtml = data.sections.map(s => renderSection(s)).join("\n");
  const themesHtml = data.themes.length > 0
    ? `<div class="themes">${data.themes.map(t => `<span class="theme-tag">${escapeHtml(t)}</span>`).join("")}</div>`
    : "";
  const expandedHtml = data.expandedKnowledge.length > 0
    ? `<div class="expanded-knowledge">
        <h2>🔍 扩展知识</h2>
        ${data.expandedKnowledge.map(k => `
          <div class="knowledge-item">
            <h3>${escapeHtml(k.topic)}</h3>
            <p>${escapeHtml(k.finding)}</p>
            ${k.source ? `<a href="${escapeHtml(k.source)}" target="_blank" class="source-link">📎 来源</a>` : ""}
          </div>
        `).join("")}
      </div>`
    : "";
  const actionsHtml = data.actionItems.length > 0
    ? `<div class="action-items">
        <h2>✅ 行动清单</h2>
        <ul>${data.actionItems.map(a => `<li>${escapeHtml(a)}</li>`).join("")}</ul>
      </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(data.title)}</title>
<style>${styleCss}</style>
</head>
<body class="report style-${style} depth-${depth}">
  <header>
    <h1>${escapeHtml(data.title)}</h1>
    <p class="date">${escapeHtml(data.date)}</p>
    <p class="summary">${escapeHtml(data.summary)}</p>
    <p class="note-count">📝 ${data.noteCount} 条笔记</p>
    ${themesHtml}
  </header>
  <main>
    ${sectionsHtml}
    ${expandedHtml}
    ${actionsHtml}
  </main>
  <footer>
    <p>由 闹闹 · 壹识 生成</p>
  </footer>
</body>
</html>`;
}

function renderSection(section: ReportSection): string {
  const iconMap: Record<string, string> = {
    insight: "💡",
    knowledge: "📚",
    action: "🎯",
    theme: "🏷️",
    connection: "🔗",
  };
  const icon = iconMap[section.type] || "📝";
  const sourcesHtml = section.sources && section.sources.length > 0
    ? `<div class="sources">来源：${section.sources.map(s =>
        s.startsWith("http") ? `<a href="${escapeHtml(s)}" target="_blank">${escapeHtml(s.slice(0, 60))}</a>` : escapeHtml(s)
      ).join("、")}</div>`
    : "";

  const contentHtml = markdownToHtml(escapeHtml(section.content));

  return `<section class="report-section type-${section.type}">
    <h2>${icon} ${escapeHtml(section.title)}</h2>
    <div class="section-content">${contentHtml}</div>
    ${sourcesHtml}
  </section>`;
}

function markdownToHtml(md: string): string {
  return md
    // Bold
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    // Blockquote
    .replace(/^>\s*(.+)$/gm, "<blockquote>$1</blockquote>")
    // Unordered list items
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    // Wrap consecutive <li> in <ul>
    .replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>")
    // Paragraphs (double newline)
    .replace(/\n\n/g, "</p><p>")
    // Single newlines → <br>
    .replace(/\n/g, "<br>")
    // Wrap in paragraph
    .replace(/^(?!<[hulo])/gm, "")
    .replace(/^/, "<p>")
    .replace(/$/, "</p>")
    // Clean up empty paragraphs
    .replace(/<p><\/p>/g, "")
    .replace(/<p>(<h[1-6]>)/g, "$1")
    .replace(/(<\/h[1-6]>)<\/p>/g, "$1")
    .replace(/<p>(<ul>)/g, "$1")
    .replace(/(<\/ul>)<\/p>/g, "$1")
    .replace(/<p>(<blockquote>)/g, "$1")
    .replace(/(<\/blockquote>)<\/p>/g, "$1");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// --- Style CSS Templates ---

const STYLE_CSS: Record<ReportStyle, string> = {
  minimal: `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, "SF Pro Text", "Helvetica Neue", sans-serif; background: #fafafa; color: #1a1a1a; line-height: 1.7; padding: 40px 20px; max-width: 680px; margin: 0 auto; }
    header { margin-bottom: 40px; border-bottom: 2px solid #1a1a1a; padding-bottom: 24px; }
    h1 { font-size: 28px; font-weight: 700; letter-spacing: -0.5px; }
    .date { color: #666; font-size: 14px; margin-top: 4px; }
    .summary { font-size: 16px; color: #333; margin-top: 12px; }
    .note-count { font-size: 13px; color: #999; margin-top: 8px; }
    .themes { margin-top: 16px; display: flex; gap: 8px; flex-wrap: wrap; }
    .theme-tag { background: #1a1a1a; color: #fff; padding: 4px 12px; border-radius: 20px; font-size: 12px; }
    main { margin-bottom: 40px; }
    .report-section { margin-bottom: 32px; }
    .report-section h2 { font-size: 20px; font-weight: 600; margin-bottom: 12px; }
    .section-content { font-size: 15px; color: #333; }
    .section-content p { margin-bottom: 12px; }
    .section-content strong { color: #1a1a1a; }
    .section-content blockquote { border-left: 3px solid #ddd; padding-left: 16px; color: #666; margin: 12px 0; }
    .section-content ul { padding-left: 20px; margin: 8px 0; }
    .section-content li { margin-bottom: 4px; }
    .sources { font-size: 12px; color: #999; margin-top: 8px; }
    .sources a { color: #666; }
    .expanded-knowledge { margin-top: 40px; padding-top: 24px; border-top: 1px solid #eee; }
    .expanded-knowledge h2 { font-size: 20px; margin-bottom: 16px; }
    .knowledge-item { background: #fff; border: 1px solid #eee; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
    .knowledge-item h3 { font-size: 16px; margin-bottom: 8px; }
    .source-link { font-size: 12px; color: #0066cc; }
    .action-items { margin-top: 40px; padding: 20px; background: #f0f7ff; border-radius: 12px; }
    .action-items h2 { font-size: 20px; margin-bottom: 12px; }
    .action-items ul { padding-left: 20px; }
    .action-items li { margin-bottom: 8px; font-size: 15px; }
    footer { text-align: center; color: #ccc; font-size: 12px; padding-top: 24px; border-top: 1px solid #eee; }
  `,
  academic: `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: "Georgia", "Noto Serif SC", serif; background: #fff; color: #222; line-height: 1.8; padding: 60px 40px; max-width: 750px; margin: 0 auto; }
    header { margin-bottom: 48px; text-align: center; }
    h1 { font-size: 26px; font-weight: 700; font-style: italic; }
    .date { color: #666; font-size: 13px; margin-top: 8px; letter-spacing: 1px; text-transform: uppercase; }
    .summary { font-size: 15px; color: #444; margin-top: 16px; font-style: italic; max-width: 500px; margin-left: auto; margin-right: auto; }
    .note-count { font-size: 12px; color: #999; margin-top: 8px; }
    .themes { margin-top: 20px; display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
    .theme-tag { border: 1px solid #222; padding: 4px 16px; font-size: 12px; letter-spacing: 0.5px; }
    main { margin-bottom: 48px; }
    .report-section { margin-bottom: 36px; }
    .report-section h2 { font-size: 18px; font-weight: 700; margin-bottom: 12px; border-bottom: 1px solid #ddd; padding-bottom: 8px; }
    .section-content { font-size: 15px; text-align: justify; }
    .section-content p { margin-bottom: 14px; text-indent: 2em; }
    .section-content blockquote { border-left: 2px solid #999; padding-left: 20px; margin: 16px 0; font-style: italic; color: #555; }
    .section-content ul { padding-left: 24px; margin: 12px 0; }
    .sources { font-size: 11px; color: #888; margin-top: 8px; font-style: italic; }
    .expanded-knowledge { margin-top: 48px; }
    .expanded-knowledge h2 { font-size: 18px; font-weight: 700; margin-bottom: 20px; }
    .knowledge-item { margin-bottom: 20px; padding: 20px; background: #fafafa; border-left: 3px solid #999; }
    .knowledge-item h3 { font-size: 15px; margin-bottom: 8px; }
    .source-link { font-size: 11px; color: #0055aa; }
    .action-items { margin-top: 48px; padding: 24px; background: #f8f8f0; border: 1px solid #ddd; }
    .action-items h2 { font-size: 18px; margin-bottom: 16px; }
    .action-items li { margin-bottom: 10px; font-size: 14px; }
    footer { text-align: center; color: #ccc; font-size: 11px; padding-top: 32px; border-top: 2px solid #222; margin-top: 48px; }
  `,
  dashboard: `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, "SF Pro Display", "Inter", sans-serif; background: #0f172a; color: #e2e8f0; line-height: 1.6; padding: 32px 20px; }
    .report { max-width: 900px; margin: 0 auto; }
    header { background: linear-gradient(135deg, #1e293b, #334155); border-radius: 16px; padding: 32px; margin-bottom: 24px; }
    h1 { font-size: 24px; font-weight: 700; color: #f8fafc; }
    .date { color: #94a3b8; font-size: 13px; margin-top: 4px; }
    .summary { font-size: 15px; color: #cbd5e1; margin-top: 12px; }
    .note-count { display: inline-block; background: #3b82f6; color: #fff; padding: 4px 12px; border-radius: 20px; font-size: 12px; margin-top: 12px; }
    .themes { margin-top: 16px; display: flex; gap: 8px; flex-wrap: wrap; }
    .theme-tag { background: rgba(59,130,246,0.2); color: #93c5fd; border: 1px solid rgba(59,130,246,0.3); padding: 4px 12px; border-radius: 20px; font-size: 12px; }
    main { display: grid; gap: 16px; }
    .report-section { background: #1e293b; border-radius: 12px; padding: 24px; border: 1px solid #334155; }
    .report-section h2 { font-size: 17px; font-weight: 600; color: #f1f5f9; margin-bottom: 12px; }
    .section-content { font-size: 14px; color: #cbd5e1; }
    .section-content strong { color: #f1f5f9; }
    .section-content blockquote { border-left: 3px solid #3b82f6; padding-left: 16px; color: #94a3b8; margin: 12px 0; }
    .section-content ul { padding-left: 20px; }
    .section-content li { margin-bottom: 4px; }
    .sources { font-size: 11px; color: #64748b; margin-top: 8px; }
    .sources a { color: #60a5fa; }
    .expanded-knowledge { background: #1e293b; border-radius: 12px; padding: 24px; border: 1px solid #334155; }
    .expanded-knowledge h2 { font-size: 17px; margin-bottom: 16px; color: #f1f5f9; }
    .knowledge-item { background: #0f172a; border-radius: 8px; padding: 16px; margin-bottom: 12px; border: 1px solid #1e293b; }
    .knowledge-item h3 { font-size: 14px; color: #93c5fd; margin-bottom: 8px; }
    .source-link { font-size: 11px; color: #60a5fa; }
    .action-items { background: linear-gradient(135deg, #1e3a5f, #1e293b); border-radius: 12px; padding: 24px; border: 1px solid #2563eb; }
    .action-items h2 { font-size: 17px; margin-bottom: 12px; color: #93c5fd; }
    .action-items li { margin-bottom: 8px; font-size: 14px; color: #e2e8f0; }
    footer { text-align: center; color: #475569; font-size: 11px; padding-top: 24px; }
  `,
  handwritten: `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: "Segoe Print", "Comic Sans MS", "Noto Sans SC", cursive; background: #fffef5; color: #2d2d2d; line-height: 1.9; padding: 40px 20px; max-width: 700px; margin: 0 auto; background-image: repeating-linear-gradient(transparent, transparent 31px, #e8e4d9 31px, #e8e4d9 32px); }
    header { margin-bottom: 40px; padding-bottom: 20px; border-bottom: 2px dashed #ccc; }
    h1 { font-size: 28px; font-weight: 400; color: #1a5276; transform: rotate(-1deg); }
    .date { color: #888; font-size: 14px; margin-top: 4px; }
    .summary { font-size: 16px; color: #555; margin-top: 12px; font-style: italic; }
    .note-count { font-size: 13px; color: #999; margin-top: 8px; }
    .themes { margin-top: 16px; display: flex; gap: 8px; flex-wrap: wrap; }
    .theme-tag { background: #fff3cd; border: 1px solid #ffc107; padding: 4px 12px; border-radius: 4px; font-size: 13px; transform: rotate(1deg); }
    main { margin-bottom: 40px; }
    .report-section { margin-bottom: 32px; padding: 16px; background: rgba(255,255,255,0.5); border-radius: 8px; }
    .report-section h2 { font-size: 20px; font-weight: 400; color: #2c3e50; margin-bottom: 12px; border-bottom: 1px solid #ddd; padding-bottom: 8px; }
    .section-content { font-size: 15px; color: #444; }
    .section-content p { margin-bottom: 12px; }
    .section-content blockquote { border-left: 3px solid #f39c12; padding-left: 16px; color: #777; margin: 12px 0; background: rgba(243,156,18,0.05); padding: 8px 16px; border-radius: 0 8px 8px 0; }
    .section-content ul { padding-left: 24px; }
    .section-content li { margin-bottom: 6px; }
    .sources { font-size: 12px; color: #aaa; margin-top: 8px; }
    .sources a { color: #2980b9; }
    .expanded-knowledge { margin-top: 40px; padding: 20px; background: rgba(231,245,255,0.5); border-radius: 12px; border: 1px dashed #3498db; }
    .expanded-knowledge h2 { font-size: 20px; margin-bottom: 16px; color: #2980b9; }
    .knowledge-item { margin-bottom: 16px; padding: 12px; background: rgba(255,255,255,0.6); border-radius: 8px; }
    .knowledge-item h3 { font-size: 16px; color: #2c3e50; margin-bottom: 8px; }
    .source-link { font-size: 12px; color: #2980b9; }
    .action-items { margin-top: 40px; padding: 20px; background: rgba(255,243,205,0.5); border-radius: 12px; border: 1px dashed #f39c12; }
    .action-items h2 { font-size: 20px; margin-bottom: 12px; color: #e67e22; }
    .action-items li { margin-bottom: 8px; font-size: 15px; }
    footer { text-align: center; color: #ccc; font-size: 12px; padding-top: 24px; }
  `,
};
