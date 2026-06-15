import { Router } from "express";
import { db } from "../db/client.js";
import { chatSessions, chatMessages, notes, noteTags, tags } from "../db/schema.js";
import { eq, and, asc, desc, ne, inArray, sql } from "drizzle-orm";
import { AuthRequest } from "../middleware/auth.js";
import { z } from "zod";
import { chatCompletion, chatCompletionWithTools, ToolDefinition, generateEmbedding } from "../services/llm.js";
import { getUserChatConfig } from "../services/user-config.js";
import { fetchUrlContent } from "../services/web-fetch.js";

const router = Router();

const MAX_MESSAGES_BEFORE_COMPACT = 30;
const PROTECTION_ZONE = 6;

router.get("/", async (req: AuthRequest, res) => {
  const sessions = await db.query.chatSessions.findMany({
    where: eq(chatSessions.userId, req.userId!),
    orderBy: [desc(chatSessions.updatedAt)],
  });
  res.json(sessions);
});

router.post("/", async (req: AuthRequest, res) => {
  const [session] = await db.insert(chatSessions).values({
    userId: req.userId!,
    title: req.body.title || null,
  }).returning();
  res.status(201).json(session);
});

router.get("/:id", async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const session = await db.query.chatSessions.findFirst({
    where: and(eq(chatSessions.id, id), eq(chatSessions.userId, req.userId!)),
  });
  if (!session) { res.status(404).json({ error: "Not found" }); return; }

  const messages = await db.query.chatMessages.findMany({
    where: eq(chatMessages.sessionId, session.id),
    orderBy: [asc(chatMessages.createdAt)],
  });

  res.json({ ...session, messages });
});

router.delete("/:id", async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const session = await db.query.chatSessions.findFirst({
    where: and(eq(chatSessions.id, id), eq(chatSessions.userId, req.userId!)),
  });
  if (!session) { res.status(404).json({ error: "Not found" }); return; }
  await db.delete(chatSessions).where(eq(chatSessions.id, session.id));
  res.json({ ok: true });
});

const sendSchema = z.object({
  message: z.string().min(1),
});

router.post("/:id/messages", async (req: AuthRequest, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const id = req.params.id as string;
  const session = await db.query.chatSessions.findFirst({
    where: and(eq(chatSessions.id, id), eq(chatSessions.userId, req.userId!)),
  });
  if (!session) { res.status(404).json({ error: "Not found" }); return; }

  await db.insert(chatMessages).values({
    sessionId: session.id,
    role: "user",
    content: parsed.data.message,
  });

  const allMessages = await db.query.chatMessages.findMany({
    where: eq(chatMessages.sessionId, session.id),
    orderBy: [asc(chatMessages.createdAt)],
  });

  const allNotes = await db.query.notes.findMany({
    where: and(eq(notes.userId, req.userId!), ne(notes.status, "trashed")),
    columns: { id: true, title: true, aiSummary: true, contentType: true, createdAt: true },
  });

  const noteIdList = allNotes.map(n => n.id);
  const allTags = noteIdList.length === 0 ? [] : await db.select({
    noteId: noteTags.noteId,
    name: tags.name,
  }).from(noteTags).innerJoin(tags, eq(noteTags.tagId, tags.id))
    .where(inArray(noteTags.noteId, noteIdList));

  const tagsByNote = new Map<string, string[]>();
  for (const t of allTags) {
    const list = tagsByNote.get(t.noteId) || [];
    list.push(t.name);
    tagsByNote.set(t.noteId, list);
  }

  const noteIndex = allNotes.map((n, i) => {
    const ntags = tagsByNote.get(n.id)?.join(", ") || "";
    return `[${i + 1}] ${n.title || "无标题"} | ${n.aiSummary?.slice(0, 80) || "无摘要"} | tags: ${ntags}`;
  }).join("\n");

  const systemPrompt = `你是 Notty，NoteOne 应用的 AI 助手。你可以帮助用户检索、总结和分析他们的笔记。

用户共有 ${allNotes.length} 条笔记，索引如下（仅含标题与摘要，不含正文）：
${noteIndex}

重要：上面的索引只是目录，不包含笔记正文。当你需要引用、总结或分析某条笔记的具体内容时，必须先调用工具读取正文，不要凭索引里的摘要臆测正文内容。

你拥有以下工具：
- read_note：按索引序号([N] 里的数字)或笔记 id 读取某条笔记的完整正文与来源/作者信息。
- search_notes：当用户的问题无法仅凭标题/摘要定位时，用语义检索找出最相关的笔记，再用 read_note 读取正文。
- web_fetch：获取外部网页内容（用户分享链接或需要查看网页时）。

规则：
- 用中文回答
- 引用笔记时注明标题；引用笔记内容前先用 read_note 读取正文
- 简洁友好
- 遇到 URL 时主动使用 web_fetch 查看内容`;

  // Resolve a note (scoped to the current user) to a full, citable text block.
  async function renderNoteFull(id: string): Promise<string | null> {
    const note = await db.query.notes.findFirst({
      where: and(eq(notes.id, id), eq(notes.userId, req.userId!)),
    });
    if (!note) return null;
    const noteTagRows = await db.select({ name: tags.name, dimension: tags.dimension })
      .from(noteTags).innerJoin(tags, eq(noteTags.tagId, tags.id))
      .where(eq(noteTags.noteId, id));
    const tagStr = noteTagRows.map(t => `#${t.name}(${t.dimension})`).join(" ");
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

  const NOTTY_TOOLS: ToolDefinition[] = [
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
  ];

  const toolHandlers: Record<string, (args: any) => Promise<string>> = {
    read_note: async ({ index, id }: { index?: number; id?: string }) => {
      let noteId = typeof id === "string" && id.length > 0 ? id : undefined;
      if (!noteId && typeof index === "number") {
        const target = allNotes[index - 1];
        if (!target) return `索引 ${index} 超出范围（共 ${allNotes.length} 条）`;
        noteId = target.id;
      }
      if (!noteId) return "请提供 index 或 id";
      const text = await renderNoteFull(noteId);
      return text ?? "笔记不存在";
    },
    search_notes: async ({ query, limit = 5 }: { query: string; limit?: number }) => {
      const embedding = await generateEmbedding(query);
      const vectorStr = `[${embedding.join(",")}]`;
      const safeLimit = Math.min(Math.max(limit, 1), 20);
      const result = await db.execute<any>(sql`
        SELECT id, title, ai_summary, content,
               1 - (embedding <=> ${vectorStr}::vector) AS similarity
        FROM notes
        WHERE user_id = ${req.userId!}
          AND status != 'trashed'
          AND embedding IS NOT NULL
        ORDER BY embedding <=> ${vectorStr}::vector
        LIMIT ${safeLimit}
      `);
      const rows = Array.isArray(result) ? result : (result as any).rows || [];
      if (rows.length === 0) return "未找到相关笔记";
      return rows.map((r: any, i: number) =>
        `${i + 1}. id=${r.id} | ${r.title || "无标题"} (相似度 ${(r.similarity * 100).toFixed(1)}%)\n   ${r.ai_summary || (r.content ? r.content.slice(0, 100) : "")}`
      ).join("\n\n");
    },
    web_fetch: async ({ url }: { url: string }) => {
      const result = await fetchUrlContent(url);
      if (result.error) return `获取失败: ${result.error}`;
      return `标题: ${result.title}\n\n${result.content}`;
    },
  };

  const llmMessages = [
    { role: "system", content: systemPrompt },
    ...allMessages.map(m => ({ role: m.role, content: m.content })),
  ];

  const chatConfig = await getUserChatConfig(req.userId!);
  const reply = await chatCompletionWithTools(llmMessages, NOTTY_TOOLS, toolHandlers, chatConfig, 5);

  const [assistantMsg] = await db.insert(chatMessages).values({
    sessionId: session.id,
    role: "assistant",
    content: reply,
  }).returning();

  await db.update(chatSessions)
    .set({ updatedAt: new Date(), title: session.title || parsed.data.message.slice(0, 50) })
    .where(eq(chatSessions.id, session.id));

  if (allMessages.length + 2 >= MAX_MESSAGES_BEFORE_COMPACT) {
    compactSession(session.id).catch(console.error);
  }

  res.json({ message: { id: assistantMsg.id, role: "assistant", content: reply } });
});

async function compactSession(sessionId: string) {
  const messages = await db.query.chatMessages.findMany({
    where: eq(chatMessages.sessionId, sessionId),
    orderBy: [asc(chatMessages.createdAt)],
  });

  if (messages.length < MAX_MESSAGES_BEFORE_COMPACT) return;

  const cutoff = messages.length - PROTECTION_ZONE;
  const toCompact = messages.slice(0, cutoff);
  const summaryBoundary = toCompact.findIndex(m => m.isSummary);
  const startIdx = summaryBoundary >= 0 ? summaryBoundary : 0;
  const compactable = toCompact.slice(startIdx);

  if (compactable.length < 4) return;

  const transcript = compactable.map(m => `${m.role}: ${m.content}`).join("\n\n");

  const summary = await chatCompletion([
    { role: "system", content: "将以下对话历史压缩为一段简洁的摘要，保留关键信息、用户偏好和重要结论。用中文输出。" },
    { role: "user", content: transcript },
  ]);

  const idsToDelete = compactable.map(m => m.id);

  await db.insert(chatMessages).values({
    sessionId,
    role: "assistant",
    content: `[对话摘要]\n${summary}`,
    isSummary: true,
    createdAt: compactable[0].createdAt,
  });

  for (const id of idsToDelete) {
    await db.delete(chatMessages).where(eq(chatMessages.id, id));
  }
}

export { router as chatSessionsRouter };
