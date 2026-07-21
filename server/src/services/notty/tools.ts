/**
 * Notty tool registry — the single place where all 闹闹 tools are assembled.
 * Note/web tools are defined here; ascan/local/schedule tools are contributed
 * by their own service modules and aggregated below.
 */
import { db, rowsOf } from "../../db/client.js";
import { notes, noteTags, tags } from "../../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { generateEmbedding } from "../llm.js";
import { fetchUrlContent } from "../web-fetch.js";
import { searchWeb } from "../web-search.js";
import { ascanToolDefinitions, makeAscanHandlers } from "../ascan/tools.js";
import { localToolDefinitions, makeLocalHandlers } from "../local-tools.js";
import { scheduleToolDefinitions, makeScheduleHandlers } from "../schedule-tools.js";
import type { ToolDefinition, ToolHandler } from "./agent-loop.js";
import type { NoteIndexEntry } from "./prompt-builder.js";

export interface NottyToolkit {
  tools: ToolDefinition[];
  handlers: Record<string, ToolHandler>;
}

const noteToolDefinitions: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read_note",
      description: "读取某条笔记的完整正文及来源/作者信息。可用索引序号(系统提示里 [N] 的数字)或笔记 id 定位。需要引用或分析笔记具体内容时必须先调用本工具。",
      parameters: {
        type: "object",
        properties: {
          index: { type: "number", description: "笔记在索引列表中的序号([N] 里的数字)，从 1 开始" },
          id: { type: "string", description: "笔记的 id（与 index 二选一，优先使用 id）" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_notes",
      description: "基于向量相似度语义检索用户的笔记，返回最相关的若干条（标题+摘要+id）。定位到笔记后用 read_note 读取正文。",
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

// Resolve a note (scoped to the user) to a full, citable text block.
async function renderNoteFull(userId: string, noteId: string): Promise<string | null> {
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
  return `标题: ${note.title || "无标题"}
摘要: ${note.aiSummary || "无"}
标签: ${tagStr || "无"}
引用信息: ${citation}

---
${note.content}`;
}

function makeNoteHandlers(userId: string, allNotes: NoteIndexEntry[]): Record<string, ToolHandler> {
  return {
    read_note: async ({ index, id }: { index?: number; id?: string }) => {
      let noteId = typeof id === "string" && id.length > 0 ? id : undefined;
      if (!noteId && typeof index === "number") {
        const target = allNotes[index - 1];
        if (!target) return `索引 ${index} 超出范围（共 ${allNotes.length} 条）`;
        noteId = target.id;
      }
      if (!noteId) return "请提供 index 或 id";
      const text = await renderNoteFull(userId, noteId);
      return text ?? "笔记不存在";
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
        `${i + 1}. id=${r.id} | ${r.title || "无标题"} (相似度 ${(r.similarity * 100).toFixed(1)}%)\n   ${r.ai_summary || (r.content ? r.content.slice(0, 100) : "")}`
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

export function buildNottyToolkit(userId: string, allNotes: NoteIndexEntry[]): NottyToolkit {
  return {
    tools: [
      ...noteToolDefinitions,
      ...ascanToolDefinitions,
      ...localToolDefinitions,
      ...scheduleToolDefinitions,
    ],
    handlers: {
      ...makeNoteHandlers(userId, allNotes),
      ...webHandlers,
      ...makeAscanHandlers(userId),
      ...makeLocalHandlers(),
      ...makeScheduleHandlers(userId),
    },
  };
}
