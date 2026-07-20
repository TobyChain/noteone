import { Router } from "express";
import { db } from "../db/client.js";
import { chatSessions, chatMessages, notes, noteTags, tags } from "../db/schema.js";
import { eq, and, asc, desc, ne, inArray, sql } from "drizzle-orm";
import { AuthRequest } from "../middleware/auth.js";
import { z } from "zod";
import { chatCompletion, chatCompletionWithTools, ToolDefinition, generateEmbedding } from "../services/llm.js";
import { getUserChatConfig } from "../services/user-config.js";
import { fetchUrlContent } from "../services/web-fetch.js";
import { searchWeb } from "../services/web-search.js";
import { ascanToolDefinitions, makeAscanHandlers } from "../services/ascan/tools.js";
import { localToolDefinitions, makeLocalHandlers } from "../services/local-tools.js";
import { scheduleToolDefinitions, makeScheduleHandlers } from "../services/schedule-tools.js";
import { trimToTokenBudget, needsCompaction, getProtectionZone, buildSummarizationPrompt, type ContextMessage } from "../services/context-manager.js";

const router = Router();

// Per-process lock so a flurry of /messages requests can't trigger overlapping compactions
// for the same session (which would risk duplicate summaries / half-deleted history).
const compactingSessions = new Set<string>();

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
  res.json({ deleted: true });
});

const sendSchema = z.object({
  message: z.string().min(1),
});

router.post("/:id/messages", async (req: AuthRequest, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const start = Date.now();
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

  const systemPrompt = `你是闹闹，壹识应用的 AI 助手。你可以帮助用户检索、总结和分析他们的笔记。

用户共有 ${allNotes.length} 条笔记，索引如下（仅含标题与摘要，不含正文）：
${noteIndex}

重要：上面的索引只是目录，不包含笔记正文。当你需要引用、总结或分析某条笔记的具体内容时，必须先调用工具读取正文，不要凭索引里的摘要臆测正文内容。

你拥有以下工具：
- read_note：按索引序号([N] 里的数字)或笔记 id 读取某条笔记的完整正文与来源/作者信息。
- search_notes：当用户的问题无法仅凭标题/摘要定位时，用语义检索找出最相关的笔记，再用 read_note 读取正文。
- web_fetch：获取外部网页内容（用户分享链接或需要查看网页时）。
- search_web：在互联网上搜索关键词，获取外部信息。当用户想了解笔记之外的知识时使用。
- list_ascan_reports：列出最近的新知日报（科技前沿日报），了解最新技术动态时使用。
- get_ascan_report：获取指定日期的新知日报纯文本内容。
- delete_ascan_report：删除指定日期的新知日报（用户明确要求删除时使用）。
- start_ascan_supplement({ date? })：启动新知补充（非阻塞，立即返回）。后台依次运行 arXiv、GitHub、官方动态、博客、会议论文、微信公众号 6 个模块并合并日报。用户说"补充今日新知"时调用。调用后你可以继续与用户对话，进度会自动展示给用户。
- get_ascan_status()：查看新知补充的运行状态和进度。
- run_command({ command })：在本地终端执行白名单只读命令（grep/find/ls/cat 等），路径限定 ~/Documents、~/Desktop、~/Downloads。用户让你搜索本地文件、查看目录、读文件内容时使用。
- search_files({ query, path?, filePattern? })：在本地目录中搜索文件内容（grep），比 run_command 更结构化。
- list_files({ path, recursive? })：列出本地目录内容。
- read_file({ path, offset?, limit? })：读取本地文件内容（按行）。
- schedule_task({ name, cron, action })：创建定时任务。action 目前支持 start_ascan_supplement（定时补充新知）。cron 格式如 "0 8 * * *" = 每天 8 点。
- list_scheduled_tasks()：列出所有定时任务。
- cancel_scheduled_task({ taskId })：取消定时任务。

规则：
- 用中文回答
- 引用笔记时注明标题；引用笔记内容前先用 read_note 读取正文
- 简洁友好
- 遇到 URL 时主动使用 web_fetch 查看内容
- 启动新知补充后，告诉用户已启动即可，进度会自动展示`;

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
    ...ascanToolDefinitions,
    ...localToolDefinitions,
    ...scheduleToolDefinitions,
  ];

  const toolHandlers: Record<string, (args: any) => Promise<string>> = {
    ...makeAscanHandlers(req.userId!),
    ...makeLocalHandlers(),
    ...makeScheduleHandlers(req.userId!),
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

  const historyMessages: ContextMessage[] = allMessages.map(m => ({
    role: m.role,
    content: m.content,
    isSummary: m.isSummary,
    tool_calls: m.toolCalls as any[] | undefined,
    tool_call_id: m.toolCallId || undefined,
  }));
  const trimmedHistory = trimToTokenBudget(historyMessages);

  const llmMessages = [
    { role: "system", content: systemPrompt },
    ...trimmedHistory,
  ];

  const chatConfig = await getUserChatConfig(req.userId!);

  // Collect intermediate tool messages for persistence
  const intermediateMessages: Array<{ role: string; content: string | null; tool_calls?: any[]; tool_call_id?: string }> = [];
  const reply = await chatCompletionWithTools(llmMessages, NOTTY_TOOLS, toolHandlers, chatConfig, 5, (msg) => {
    intermediateMessages.push(msg);
  });

  // Persist intermediate tool messages and final reply atomically
  await db.transaction(async (tx) => {
    for (const msg of intermediateMessages) {
      await tx.insert(chatMessages).values({
        sessionId: session.id,
        role: msg.role,
        content: msg.content || "",
        toolCalls: msg.tool_calls,
        toolCallId: msg.tool_call_id,
      });
    }
    await tx.insert(chatMessages).values({
      sessionId: session.id,
      role: "assistant",
      content: reply,
    });
  });

  // Fetch the assistant message to return its ID
  const assistantMsg = await db.query.chatMessages.findFirst({
    where: and(eq(chatMessages.sessionId, session.id), eq(chatMessages.role, "assistant")),
    orderBy: [desc(chatMessages.createdAt)],
  }) ?? { id: "", content: reply };

  await db.update(chatSessions)
    .set({ updatedAt: new Date(), title: session.title || parsed.data.message.slice(0, 50) })
    .where(eq(chatSessions.id, session.id));

  if (needsCompaction(allMessages.length + 2)) {
    compactSession(session.id).catch(console.error);
    console.log(`[chat] session=${session.id.slice(0, 8)} compaction=triggered msgCount=${allMessages.length + 2}`);
  }

  console.log(`[chat] message-processed session=${session.id.slice(0, 8)} duration=${Date.now() - start}ms noteCount=${allNotes.length} historyMsgs=${allMessages.length}`);
  res.json({ message: { id: assistantMsg.id, role: "assistant", content: reply } });
});

async function compactSession(sessionId: string) {
  if (compactingSessions.has(sessionId)) return;
  compactingSessions.add(sessionId);
  try {
    const messages = await db.query.chatMessages.findMany({
      where: eq(chatMessages.sessionId, sessionId),
      orderBy: [asc(chatMessages.createdAt)],
    });

    const PROTECTION = getProtectionZone();
    if (!needsCompaction(messages.length)) return;

    const cutoff = messages.length - PROTECTION;
    const toCompact = messages.slice(0, cutoff);
    const summaryIdx = toCompact.findIndex((m) => m.isSummary);
    const startIdx = summaryIdx >= 0 ? summaryIdx + 1 : 0;
    const compactable = toCompact.slice(startIdx);

    if (compactable.length < 4) return;

    const existingSummary = summaryIdx >= 0 ? toCompact[summaryIdx].content?.replace(/^\[对话摘要\]\n?/, "") || null : null;
    const compactMessages: ContextMessage[] = compactable.map(m => ({
      role: m.role,
      content: m.content,
      isSummary: m.isSummary,
    }));

    const summary = await chatCompletion(buildSummarizationPrompt(compactMessages, existingSummary));

    const idsToDelete = compactable.map((m) => m.id);

    await db.transaction(async (tx) => {
      await tx.insert(chatMessages).values({
        sessionId,
        role: "assistant",
        content: `[对话摘要]\n${summary}`,
        isSummary: true,
        createdAt: compactable[0].createdAt,
      });
      await tx.delete(chatMessages).where(inArray(chatMessages.id, idsToDelete));
    });
    console.log(`[chat] session=${sessionId.slice(0, 8)} compaction=done compacted=${compactable.length} summaryLen=${summary.length}`);
  } finally {
    compactingSessions.delete(sessionId);
  }
}

export { router as chatSessionsRouter };
