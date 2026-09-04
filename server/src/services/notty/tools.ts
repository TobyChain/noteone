/**
 * Notty tool registry — the single place where all 闹闹 tools are assembled.
 * Note/web tools are defined here; newlore/local/schedule tools are contributed
 * by their own service modules and aggregated below.
 */
import { db } from "../../db/client.js";
import { notes, noteTags, tags, users } from "../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { searchNotes } from "../note-search.js";
import { fetchUrlContent } from "../web-fetch.js";
import { searchWeb } from "../web-search.js";
import { newloreToolDefinitions, makeNewLoreHandlers } from "../newlore/tools.js";
import { localToolDefinitions, makeLocalHandlers } from "../local-tools.js";
import { scheduleToolDefinitions, makeScheduleHandlers } from "../schedule-tools.js";
import { startStudyReport, getStudyReportProgress } from "./learn-art.js";
import { getUserChatConfig } from "../user-config.js";
import type { ToolDefinition, ToolHandler } from "./agent-loop.js";
import type { NoteIndexEntry } from "./prompt-builder.js";
import type { NewLorePreferences, NewLoreModuleName } from "../newlore/pipeline/types.js";

export interface NottyToolkit {
  tools: ToolDefinition[];
  handlers: Record<string, ToolHandler>;
}

const noteToolDefinitions: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read_note",
      description: "读取某条笔记的正文及来源/作者信息。可用索引序号(系统提示里 [N] 的数字)或笔记 id 定位。大笔记可用 offset/limit 分段读取（按行）。需要引用或分析笔记具体内容时必须先调用本工具。",
      parameters: {
        type: "object",
        properties: {
          index: { type: "number", description: "笔记在索引列表中的序号([N] 里的数字)，从 1 开始" },
          id: { type: "string", description: "笔记的 id（与 index 二选一，优先使用 id）" },
          offset: { type: "number", description: "起始行号（从 0 开始），用于分段读取大笔记" },
          limit: { type: "number", description: "读取行数，默认 200" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_notes",
      description: "检索用户笔记；优先语义检索，不可用时自动全文检索。返回标题、摘要和 id，定位后用 read_note 读取正文。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "检索关键词或自然语言问题" },
          limit: { type: "number", description: "返回条数，默认 5，最大 20" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_fetch",
      description: "获取指定 URL 的网页内容，返回纯文本。当用户分享链接或你需要查看网页内容时使用。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "要获取的网页 URL" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "discover_feed",
      description: "自动发现网站的 RSS/Atom feed 地址。给定网站 URL，获取页面 HTML 解析 <link> 标签 + 尝试常见路径（/rss /feed /atom.xml 等）。用户让你'添加XX网站为新知来源'时，先此工具找到 feed 地址，再用 add_blog_source 添加。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "网站 URL，如 https://www.scmp.com/tech" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description: "在互联网上搜索关键词，返回相关网页的标题、URL 和摘要。当用户想了解笔记之外的外部信息时使用。",
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
];

const preferenceToolDefinitions: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_newlore_preferences",
      description: "获取用户的新知挖取偏好设置，包括每日重点、兴趣主题和模块显示顺序。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "update_newlore_preferences",
      description: "更新新知挖取偏好。focus 是今日重点（如'AI Agent, 多模态'）；topics 是长期兴趣；moduleOrder 是显示顺序（可选值: official, blog, github, arxiv, conference, wechat）。用户说'今天重点关注XX'或'调整日报顺序'时使用。",
      parameters: {
        type: "object",
        properties: {
          focus: { type: "string", description: "今日挖取重点，如'AI Agent, 多模态模型'" },
          topics: { type: "string", description: "长期兴趣主题，如'LLM, Agent, Web3'" },
          moduleOrder: {
            type: "array",
            items: { type: "string", enum: ["official", "blog", "github", "arxiv", "conference", "wechat"] },
            description: "模块显示顺序，默认 official→blog→github→arxiv→conference→wechat",
          },
        },
      },
    },
  },
];

// Resolve a note (scoped to the user) to a full, citable text block.
async function renderNoteFull(userId: string, noteId: string, offset = 0, limit = 200): Promise<string | null> {
  const note = await db.query.notes.findFirst({
    where: and(eq(notes.id, noteId), eq(notes.userId, userId)),
  });
  if (!note) return null;
  const noteTagRows = await db.select({ name: tags.name, dimension: tags.dimension })
    .from(noteTags).innerJoin(tags, eq(noteTags.tagId, tags.id))
    .where(eq(noteTags.noteId, noteId));
  const tagStr = noteTagRows.map((t) => `#${t.name}(${t.dimension})`).join(" ");
  const citation = [
    note.author ? `作者: ${note.author}` : null,
    note.authorOrg ? `单位/来源: ${note.authorOrg}` : null,
    note.sourceUrl ? `链接: ${note.sourceUrl}` : null,
    `日期: ${note.createdAt.toISOString().slice(0, 10)}`,
  ].filter(Boolean).join(" | ");

  const lines = (note.content || "").split("\n");
  const totalLines = lines.length;
  const sliced = lines.slice(offset, offset + limit).join("\n");
  const remaining = totalLines - offset - limit;
  const paginationHint = remaining > 0
    ? `\n\n[... 省略 ${remaining} 行，共 ${totalLines} 行。使用 offset=${offset + limit} 继续读取 ...]`
    : offset > 0
      ? `\n\n[已显示第 ${offset + 1}-${Math.min(offset + limit, totalLines)} 行，共 ${totalLines} 行]`
      : "";

  return `标题: ${note.title || "无标题"}
摘要: ${note.aiSummary || "无"}
标签: ${tagStr || "无"}
引用信息: ${citation}

---
${sliced}${paginationHint}`;
}

function makeNoteHandlers(userId: string, allNotes: NoteIndexEntry[]): Record<string, ToolHandler> {
  return {
    read_note: async ({ index, id, offset, limit }: { index?: number; id?: string; offset?: number; limit?: number }) => {
      let noteId = typeof id === "string" && id.length > 0 ? id : undefined;
      if (!noteId && typeof index === "number") {
        const target = allNotes[index - 1];
        if (!target) return `索引 ${index} 超出范围（共 ${allNotes.length} 条）`;
        noteId = target.id;
      }
      if (!noteId) return "请提供 index 或 id";
      const text = await renderNoteFull(userId, noteId, offset ?? 0, limit ?? 200);
      return text ?? "笔记不存在";
    },
    search_notes: async (args: Record<string, any>) => {
      const query = args.query as string;
      const limit = (args.limit as number) || 5;
      const llmConfig = await getUserChatConfig(userId);
      const { results: rows } = await searchNotes(userId, query, { limit: Math.min(limit, 20), llmConfig });
      if (rows.length === 0) return "未找到相关笔记";
      return rows.map((r, i) =>
        `${i + 1}. id=${r.id} | ${r.title || "无标题"}${r.similarity == null ? "" : ` (相似度 ${(r.similarity * 100).toFixed(1)}%)`}\n   ${r.ai_summary || (r.content ? r.content.slice(0, 100) : "")}`
      ).join("\n\n");
    },
  };
}

const webHandlers: Record<string, ToolHandler> = {
  web_fetch: async (args: Record<string, any>) => {
    const result = await fetchUrlContent(args.url as string);
    if (result.error) return `获取失败: ${result.error}`;
    return `标题: ${result.title}\n\n${result.content}`;
  },
  discover_feed: async (args: Record<string, any>) => {
    const url = args.url as string;
    const feeds: string[] = [];
    const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
    // 1. Fetch page HTML + parse <link rel="alternate" type="application/rss+xml|atom+xml">
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": UA } });
      const html = await resp.text();
      const linkRegex = /<link[^>]*type=["']application\/(?:rss|atom)\+xml["'][^>]*href=["']([^"']+)["']/gi;
      let m: RegExpExecArray | null;
      while ((m = linkRegex.exec(html)) !== null) {
        try { const f = new URL(m[1], url).href; if (!feeds.includes(f)) feeds.push(f); } catch {}
      }
    } catch {}
    // 2. Try common feed paths
    const base = new URL(url);
    const candidates = ["/rss", "/feed", "/rss.xml", "/atom.xml", "/feed.xml", "/feeds/all.xml", "/rss/index.xml"];
    for (const path of candidates) {
      const candidate = new URL(path, base.origin).href;
      if (feeds.includes(candidate)) continue;
      try {
        const resp = await fetch(candidate, { method: "HEAD", signal: AbortSignal.timeout(8000), headers: { "User-Agent": UA } });
        const ct = resp.headers.get("content-type") || "";
        if (resp.ok && (ct.includes("xml") || ct.includes("rss"))) feeds.push(candidate);
      } catch {}
    }
    if (feeds.length === 0) return `未找到 ${url} 的 RSS/Atom feed。请手动提供 feed 地址。`;
    return `找到 ${feeds.length} 个 feed:\n${feeds.map((f: string, i: number) => `${i + 1}. ${f}`).join("\n")}`;
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
};

function makePreferenceHandlers(userId: string): Record<string, ToolHandler> {
  return {
    get_newlore_preferences: async () => {
      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { settings: true },
      });
      const settings = (user?.settings as any) ?? {};
      const prefs = (settings.newlorePreferences ?? settings.newseePreferences ?? settings.ascanPreferences ?? {}) as NewLorePreferences;
      const parts: string[] = [];
      if (prefs.focus) parts.push(`今日重点: ${prefs.focus}`);
      if (prefs.topics) parts.push(`兴趣主题: ${prefs.topics}`);
      if (prefs.moduleOrder?.length) parts.push(`显示顺序: ${prefs.moduleOrder.join(" → ")}`);
      return parts.length > 0 ? parts.join("\n") : "尚未设置新知挖取偏好（使用默认配置）。";
    },
    update_newlore_preferences: async (args: Record<string, any>) => {
      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { settings: true },
      });
      const current = (user?.settings ?? {}) as any;
      const prefs: NewLorePreferences = { ...(current.newlorePreferences ?? current.newseePreferences ?? current.ascanPreferences ?? {}) };
      if (typeof args.focus === "string") prefs.focus = args.focus || undefined;
      if (typeof args.topics === "string") prefs.topics = args.topics || undefined;
      if (Array.isArray(args.moduleOrder)) {
        const valid = ["official", "blog", "github", "arxiv", "conference", "wechat"] as const;
        prefs.moduleOrder = args.moduleOrder.filter((m: string) => valid.includes(m as any)) as NewLoreModuleName[];
      }
      await db.update(users)
        .set({ settings: { ...current, newlorePreferences: prefs }, updatedAt: new Date() })
        .where(eq(users.id, userId));
      const parts: string[] = ["已更新新知挖取偏好："];
      if (prefs.focus) parts.push(`  今日重点: ${prefs.focus}`);
      if (prefs.topics) parts.push(`  兴趣主题: ${prefs.topics}`);
      if (prefs.moduleOrder?.length) parts.push(`  显示顺序: ${prefs.moduleOrder.join(" → ")}`);
      return parts.join("\n");
    },
  };
}

const learnArtToolDefinitions: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "generate_study_report",
      description: "对指定 URL 生成 learn-art 深度解析报告（单文件 HTML），自动保存到往事。非阻塞，后台运行，完成后通知用户。当用户说\"深入分析这个链接\"、\"用 learn-art 分析\"、\"深度解读这篇文章\"或右键选择\"用 learn-art 深入分析\"时使用。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "要分析的目标 URL（GitHub 仓库、论文、技术文章/博客均可）" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_study_report_status",
      description: "查看 learn-art 学习报告的生成状态和进度。",
      parameters: { type: "object", properties: {} },
    },
  },
];

function makeLearnArtHandlers(userId: string): Record<string, ToolHandler> {
  return {
    generate_study_report: async (args: Record<string, any>) => {
      const url = args.url as string;
      try {
        const llmConfig = await getUserChatConfig(userId);
        await startStudyReport(url, userId, llmConfig);
        return `学习报告生成已启动（URL: ${url}），后台运行中。完成后会自动保存到往事并通知用户。`;
      } catch (err: any) {
        return `启动失败: ${err?.message || err}`;
      }
    },
    get_study_report_status: async () => {
      const p = getStudyReportProgress();
      if (!p) return "当前无学习报告生成任务";
      if (p.isRunning) return `学习报告生成中（${p.phase}）：${p.url}`;
      if (p.phase === "done") return `学习报告已完成并保存到往事：${p.title}`;
      if (p.phase === "failed") return `学习报告生成失败：${p.error}`;
      return "未知状态";
    },
  };
}

// Static tool definitions — assembled once.
let cachedTools: ToolDefinition[] | null = null;

// Per-user handler cache: only rebuilt when note index version changes.
const handlerCache = new Map<string, { noteVersion: string; handlers: Record<string, ToolHandler> }>();

export function buildNottyToolkit(userId: string, allNotes: NoteIndexEntry[], noteVersion: string): NottyToolkit {
  if (!cachedTools) {
    cachedTools = [
      ...noteToolDefinitions,
      ...preferenceToolDefinitions,
      ...newloreToolDefinitions,
      ...localToolDefinitions,
      ...scheduleToolDefinitions,
      ...learnArtToolDefinitions,
    ];
  }

  const cached = handlerCache.get(userId);
  if (cached && cached.noteVersion === noteVersion) {
    return { tools: cachedTools, handlers: cached.handlers };
  }

  const handlers: Record<string, ToolHandler> = {
    ...makeNoteHandlers(userId, allNotes),
    ...webHandlers,
    ...makePreferenceHandlers(userId),
    ...makeNewLoreHandlers(userId),
    ...makeLocalHandlers(),
    ...makeScheduleHandlers(userId),
    ...makeLearnArtHandlers(userId),
  };

  handlerCache.set(userId, { noteVersion, handlers });
  return { tools: cachedTools, handlers };
}
