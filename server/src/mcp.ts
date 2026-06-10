import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import "dotenv/config";
import { db } from "./db/client.js";
import { notes, noteTags, tags } from "./db/schema.js";
import { eq, and, desc, inArray } from "drizzle-orm";
import { processNote } from "./services/pipeline.js";
import { generateEmbedding } from "./services/llm.js";

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
      where: eq(notes.userId, USER_ID),
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
    const text = `标题: ${note.title || "无标题"}
状态: ${note.status}
摘要: ${note.aiSummary || "无"}
标签: ${tagStr || "无"}
来源: ${note.sourceUrl || "无"}
创建: ${note.createdAt.toISOString()}

---
${note.content}`;
    return { content: [{ type: "text" as const, text }] };
  }
);

server.tool(
  "create_note",
  "创建新笔记，AI 会自动生成标题、摘要和标签",
  {
    content: z.string().describe("笔记内容"),
    source_url: z.string().optional().describe("来源链接"),
    title: z.string().optional().describe("手动指定标题，否则 AI 自动生成"),
  },
  async ({ content, source_url, title }) => {
    const [note] = await db.insert(notes).values({
      userId: USER_ID,
      content,
      sourceUrl: source_url,
      title,
      contentType: "text",
    }).returning();
    processNote(note.id, content, "text").catch(console.error);
    return { content: [{ type: "text" as const, text: `笔记已创建: ${note.id}\nAI 正在后台分析生成标题和标签...` }] };
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
  "删除笔记",
  { id: z.string() },
  async ({ id }) => {
    const [note] = await db.delete(notes)
      .where(and(eq(notes.id, id), eq(notes.userId, USER_ID)))
      .returning();
    if (!note) return { content: [{ type: "text" as const, text: "笔记不存在" }] };
    return { content: [{ type: "text" as const, text: `已删除: ${note.title || note.id}` }] };
  }
);

server.tool(
  "search_notes",
  "语义搜索笔记（基于向量相似度）",
  { query: z.string(), limit: z.number().optional() },
  async ({ query, limit = 10 }) => {
    const embedding = await generateEmbedding(query);
    const result = await db.execute<any>(`
      SELECT id, title, ai_summary, content, source_url,
             1 - (embedding <=> $1::vector) AS similarity
      FROM notes
      WHERE user_id = $2 AND embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT $3
    `.replace("$1", `'[${embedding.join(",")}]'`)
     .replace("$2", `'${USER_ID}'`)
     .replace("$3", `${limit}`));

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
    const where = dimension ? eq(tags.dimension, dimension) : undefined;
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
