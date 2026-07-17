import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import "dotenv/config";
import { db } from "./db/client.js";
import { notes, noteTags, tags } from "./db/schema.js";
import { eq, and, desc, inArray, ne, sql } from "drizzle-orm";
import { processNote } from "./services/pipeline.js";
import { generateEmbedding } from "./services/llm.js";
import { attachPromptTags } from "./services/prompt-tagging.js";
import { listReports, getReport, deleteReport } from "./services/ascan/reports.js";
import { getRunStatus, runModule, mergeReport } from "./services/ascan/runner.js";
import { getUserChatConfig } from "./services/user-config.js";

const server = new McpServer({
  name: "noteone",
  version: "0.1.0",
});

const USER_ID = process.env.MCP_USER_ID || "";

async function getTagsForNotes(noteIds: string[]) {
  if (noteIds.length === 0) return {};
  const allTags = await db.select({
    noteId: noteTags.noteId,
    tagId: noteTags.tagId,
    name: tags.name,
    dimension: tags.dimension,
  }).from(noteTags)
    .innerJoin(tags, eq(noteTags.tagId, tags.id))
    .where(inArray(noteTags.noteId, noteIds));

  const byNote: Record<string, string[]> = {};
  for (const t of allTags) {
    (byNote[t.noteId] ??= []).push(`#${t.name}`);
  }
  return byNote;
}

server.tool(
  "list_notes",
  "列出用户的笔记，支持分页",
  { limit: z.number().optional(), offset: z.number().optional() },
  async ({ limit = 20, offset = 0 }) => {
    const result = await db.query.notes.findMany({
      where: and(eq(notes.userId, USER_ID), ne(notes.status, "trashed")),
      orderBy: desc(notes.createdAt),
      limit: Math.min(limit, 50),
      offset,
    });
    const tagMap = await getTagsForNotes(result.map(n => n.id));
    const text = result.map(n =>
      `[${n.id}] ${n.title || "无标题"} | ${n.aiSummary?.slice(0, 80) || n.content.slice(0, 80)} | ${n.status} | ${n.createdAt.toISOString().slice(0, 10)} | ${(tagMap[n.id] || []).join(" ")}`
    ).join("\n");
    return { content: [{ type: "text" as const, text: text || "暂无笔记" }] };
  }
);

server.tool(
  "get_note",
  "获取笔记的完整内容",
  { id: z.string() },
  async ({ id }) => {
    const note = await db.query.notes.findFirst({
      where: and(eq(notes.id, id), eq(notes.userId, USER_ID)),
    });
    if (!note) return { content: [{ type: "text" as const, text: "笔记不存在" }] };

    const noteTags_ = await db.select({ name: tags.name, dimension: tags.dimension })
      .from(noteTags).innerJoin(tags, eq(noteTags.tagId, tags.id))
      .where(eq(noteTags.noteId, id));

    const tagStr = noteTags_.map(t => `#${t.name}(${t.dimension})`).join(" ");
    const citation = [
      note.author ? `作者: ${note.author}` : null,
      note.authorOrg ? `单位/来源: ${note.authorOrg}` : null,
      note.sourceUrl ? `链接: ${note.sourceUrl}` : null,
      `日期: ${note.createdAt.toISOString().slice(0, 10)}`,
    ].filter(Boolean).join(" | ");
    const text = `标题: ${note.title || "无标题"}
状态: ${note.status}
摘要: ${note.aiSummary || "无"}
标签: ${tagStr || "无"}
来源: ${note.sourceUrl || "无"}
作者: ${note.author || "无"}
单位/来源: ${note.authorOrg || "无"}
创建: ${note.createdAt.toISOString()}

引用信息: ${citation}

---
${note.content}`;
    return { content: [{ type: "text" as const, text }] };
  }
);

/**
 * Reusable note-creation routine used by the MCP `create_note` tool. Extracted so that
 * integration tests can drive it directly without standing up the stdio MCP transport.
 *
 * When `source_app` is present, the note is treated as a prompt capture: it gets the
 * caller's app name written into `notes.source_app` AND two format-dimension tags
 * (`#prompt` + `#{source_app}`) attached synchronously, before pipeline tagging runs.
 * Read paths (list_notes / get_note / search_notes) need no special handling — these
 * are still regular text notes.
 */
export async function mcpCreateNote(
  userId: string,
  args: { content: string; source_url?: string; title?: string; source_app?: string },
): Promise<{ id: string }> {
  const [note] = await db.insert(notes).values({
    userId,
    content: args.content,
    sourceUrl: args.source_url,
    sourceApp: args.source_app,
    title: args.title,
    contentType: "text",
  }).returning();

  if (args.source_app) {
    // Synchronous so the tags are present the moment the note is read back.
    await attachPromptTags(note.id, userId, args.source_app);
  }

  // Pipeline (URL fetch / enrichment / topic-domain-module tagging) runs asynchronously.
  processNote(note.id, userId, args.content, "text", args.source_url).catch(console.error);
  return { id: note.id };
}

server.tool(
  "create_note",
  "创建新笔记，AI 会自动生成标题、摘要和标签。也可用来记录用户的 prompt：传入 source_app（如 'Claude' / 'Cursor' / 'Codex'）会自动在笔记上打 #prompt + #{source_app} 两个 format 标签，便于用户后续回看。",
  {
    content: z.string().describe("笔记内容（记录 prompt 时即填 prompt 全文）"),
    source_url: z.string().optional().describe("来源链接"),
    title: z.string().optional().describe("手动指定标题，否则 AI 自动生成"),
    source_app: z.string().max(64).optional().describe("调用方应用名；记录 prompt 时强烈建议传入，如 'Claude' 、 'Cursor' 、 'Codex'"),
  },
  async ({ content, source_url, title, source_app }) => {
    const { id } = await mcpCreateNote(USER_ID, { content, source_url, title, source_app });
    const tail = source_app
      ? `\n已打上 #prompt + #${source_app.trim().toLowerCase()} 标签。`
      : "\nAI 正在后台分析生成标题和标签...";
    return { content: [{ type: "text" as const, text: `笔记已创建: ${id}${tail}` }] };
  }
);

server.tool(
  "update_note",
  "更新笔记内容或标题",
  {
    id: z.string(),
    title: z.string().optional(),
    content: z.string().optional(),
  },
  async ({ id, title, content }) => {
    const updates: any = { updatedAt: new Date() };
    if (title !== undefined) updates.title = title;
    if (content !== undefined) updates.content = content;
    const [note] = await db.update(notes)
      .set(updates)
      .where(and(eq(notes.id, id), eq(notes.userId, USER_ID)))
      .returning();
    if (!note) return { content: [{ type: "text" as const, text: "笔记不存在" }] };
    return { content: [{ type: "text" as const, text: `已更新: ${note.title || note.id}` }] };
  }
);

server.tool(
  "delete_note",
  "删除笔记（移入垃圾箱，30天后自动清理）",
  { id: z.string() },
  async ({ id }) => {
    const [note] = await db.update(notes)
      .set({ status: "trashed", deletedAt: new Date() })
      .where(and(eq(notes.id, id), eq(notes.userId, USER_ID), ne(notes.status, "trashed")))
      .returning();
    if (!note) return { content: [{ type: "text" as const, text: "笔记不存在" }] };
    return { content: [{ type: "text" as const, text: `已移入垃圾箱: ${note.title || note.id}` }] };
  }
);

server.tool(
  "restore_note",
  "从垃圾箱恢复笔记",
  { id: z.string() },
  async ({ id }) => {
    const [note] = await db.update(notes)
      .set({ status: "active", deletedAt: null })
      .where(and(eq(notes.id, id), eq(notes.userId, USER_ID), eq(notes.status, "trashed")))
      .returning();
    if (!note) return { content: [{ type: "text" as const, text: "笔记不存在或不在垃圾箱中" }] };
    return { content: [{ type: "text" as const, text: `已恢复: ${note.title || note.id}` }] };
  }
);

server.tool(
  "search_notes",
  "语义搜索笔记（基于向量相似度）",
  { query: z.string(), limit: z.number().optional() },
  async ({ query, limit = 10 }) => {
    const embedding = await generateEmbedding(query);
    const vectorStr = `[${embedding.join(",")}]`;
    const safeLimit = Math.min(Math.max(limit, 1), 50);

    // Parameterized via the sql template — never string-concatenate user/env values into SQL.
    const result = await db.execute<any>(sql`
      SELECT id, title, ai_summary, content, source_url,
             1 - (embedding <=> ${vectorStr}::vector) AS similarity
      FROM notes
      WHERE user_id = ${USER_ID}
        AND status != 'trashed'
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vectorStr}::vector
      LIMIT ${safeLimit}
    `);

    const rows = Array.isArray(result) ? result : (result as any).rows || [];
    const text = rows.map((r: any, i: number) =>
      `${i + 1}. [${r.id}] ${r.title || "无标题"} (相似度: ${(r.similarity * 100).toFixed(1)}%)\n   ${r.ai_summary || r.content?.slice(0, 80)}`
    ).join("\n\n");
    return { content: [{ type: "text" as const, text: text || "未找到相关笔记" }] };
  }
);

server.tool(
  "list_tags",
  "列出所有标签，按维度分组",
  { dimension: z.enum(["format", "topic", "domain", "module"]).optional() },
  async ({ dimension }) => {
    const where = dimension
      ? and(eq(tags.userId, USER_ID), eq(tags.dimension, dimension))
      : eq(tags.userId, USER_ID);
    const result = await db.query.tags.findMany({ where });
    const grouped: Record<string, string[]> = {};
    for (const t of result) {
      (grouped[t.dimension] ??= []).push(t.name);
    }
    const text = Object.entries(grouped)
      .map(([dim, names]) => `[${dim}] ${names.join(", ")}`)
      .join("\n");
    return { content: [{ type: "text" as const, text: text || "暂无标签" }] };
  }
);

server.tool(
  "list_ascan_reports",
  "列出最近的 新知 日报（科技前沿日报），包含日期和摘要",
  {},
  async () => {
    const reports = await listReports();
    const text = reports.map(r =>
      `[${r.date}] ${r.summary || "无摘要"} (${r.size}B)`
    ).join("\n");
    return { content: [{ type: "text" as const, text: text || "暂无日报" }] };
  }
);

server.tool(
  "get_ascan_report",
  "获取指定日期的新知日报内容（纯文本）",
  { date: z.string().describe("日期，格式 YYYYMMDD，如 20260716") },
  async ({ date }) => {
    const html = await getReport(date);
    if (!html) return { content: [{ type: "text" as const, text: `未找到 ${date} 的日报` }] };
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 8000);
    return { content: [{ type: "text" as const, text }] };
  }
);

server.tool(
  "get_ascan_status",
  "查看新知 pipeline 的运行状态",
  {},
  async () => {
    const status = await getRunStatus();
    const parts = [
      `运行中: ${status.isRunning ? "是" : "否"}`,
      status.recentLog ? `最新日志: ${status.recentLog}` : null,
      status.lockAge ? `锁文件时长: ${status.lockAge}` : null,
    ].filter(Boolean);
    return { content: [{ type: "text" as const, text: parts.join("\n") }] };
  }
);

server.tool(
  "delete_ascan_report",
  "删除指定日期的新知日报（同时清理 html/md/summary 文件）。运行中的当日日报无法删除。",
  { date: z.string().describe("日期，格式 YYYYMMDD，如 20260716") },
  async ({ date }) => {
    try {
      const result = await deleteReport(date);
      return {
        content: [{
          type: "text" as const,
          text: result.deleted
            ? `已删除日报 ${date}`
            : `${date} 无可删除的日报文件`,
        }],
      };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `删除失败: ${err?.message || err}` }] };
    }
  }
);

server.tool(
  "run_ascan_module",
  "运行新知的单个模块（阻塞，可能耗时 1-5 分钟）。模块：arxiv/github/official/blog/conference/wechat。补充新知时依次调用各模块，再 merge_ascan_report 合并。",
  {
    module: z.enum(["arxiv", "github", "official", "blog", "conference", "wechat"]),
    date: z.string().optional().describe("报告日期 YYYYMMDD，默认今天"),
  },
  async ({ module, date }) => {
    const llmConfig = await getUserChatConfig(USER_ID);
    const r = await runModule(module, date, llmConfig);
    return {
      content: [{
        type: "text" as const,
        text: `${module} 模块${r.ok ? "完成" : "失败"}：${r.chars} 字符${r.error ? "；错误：" + r.error : ""}`,
      }],
    };
  }
);

server.tool(
  "merge_ascan_report",
  "合并已运行模块的片段为新知日报（阻塞，数秒）。在 run_ascan_module 跑完所需模块后调用。",
  { date: z.string().optional().describe("报告日期 YYYYMMDD，默认今天") },
  async ({ date }) => {
    const r = await mergeReport(date);
    return {
      content: [{
        type: "text" as const,
        text: r.ok ? `日报已合并生成：Ascan-${r.date}` : `合并失败：${r.md_path}`,
      }],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only start the stdio transport when this file is executed directly
// (`tsx src/mcp.ts`). When the module is imported by tests, we just expose
// `mcpCreateNote` and friends without trying to grab stdio.
const entryUrl = process.argv[1] ? new URL(`file://${process.argv[1]}`).href : "";
if (import.meta.url === entryUrl) {
  main().catch(console.error);
}
