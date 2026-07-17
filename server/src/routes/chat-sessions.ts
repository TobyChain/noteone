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
  ];

  const toolHandlers: Record<string, (args: any) => Promise<string>> = {
    ...makeAscanHandlers(req.userId!),
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

// --- Writer-mode messages: Notty acts on the user's local markdown document ---

const writerSendSchema = z.object({
  message: z.string().min(1),
  documentText: z.string().default(""),
  selection: z.object({
    start: z.number().int().min(0),
    end: z.number().int().min(0),
  }).optional(),
});

interface WriterAction {
  type: "insert_text" | "append_text" | "replace_selection" | "rewrite_document";
  text: string;
}

router.post("/:id/writer-messages", async (req: AuthRequest, res) => {
  const parsed = writerSendSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const start = Date.now();
  const id = req.params.id as string;
  const session = await db.query.chatSessions.findFirst({
    where: and(eq(chatSessions.id, id), eq(chatSessions.userId, req.userId!)),
  });
  if (!session) { res.status(404).json({ error: "Not found" }); return; }

  const { message, documentText, selection } = parsed.data;

  // Persist the user message so writer chat history is consistent with normal chat history.
  await db.insert(chatMessages).values({
    sessionId: session.id,
    role: "user",
    content: message,
  });

  const allMessages = await db.query.chatMessages.findMany({
    where: eq(chatMessages.sessionId, session.id),
    orderBy: [asc(chatMessages.createdAt)],
  });

  // Slice out the selection so the LLM sees what's currently highlighted.
  const safeStart = selection ? Math.min(Math.max(selection.start, 0), documentText.length) : 0;
  const safeEnd = selection ? Math.min(Math.max(selection.end, safeStart), documentText.length) : 0;
  const selectionText = selection ? documentText.slice(safeStart, safeEnd) : "";

  const docPreview = documentText.length > 8000 ? documentText.slice(0, 8000) + "\n...(已截断)" : documentText;

  const systemPrompt = `你是闹闹，壹识写作页面的 AI 协作助手。用户正在本地一个 Markdown 文档里写作，希望你帮忙起草、续写、润色或整理内容。

文档当前内容（共 ${documentText.length} 字）：
\`\`\`
${docPreview || "(空文档)"}
\`\`\`
${selection ? `\n用户当前选中了 [${safeStart}, ${safeEnd}) 区间：\n\`\`\`\n${selectionText}\n\`\`\`\n` : ""}

你拥有以下"写"工具，会直接修改用户编辑器里的文档（每次回复最多产出一个写操作）：
- insert_text({ text }): 在用户光标处插入文本（无选区时使用）
- replace_selection({ text }): 替换用户当前选中的文本（仅当用户有选区时使用）
- append_text({ text }): 把文本追加到文档末尾
- rewrite_document({ text }): 用新内容整篇替换当前文档（重大改写时才使用，需谨慎）

你也可以用以下"读"工具查阅笔记和外部资料作为写作素材，再决定写什么：
- search_notes({ query, limit? }): 语义检索用户的笔记
- read_note({ id }): 读取某条笔记完整正文
- web_fetch({ url }): 抓取网页正文
- search_web({ query, maxResults? }): 联网检索
- list_ascan_reports(): 列出最近的新知日报，了解最新技术动态
- get_ascan_report({ date }): 获取指定日期的新知日报内容
- delete_ascan_report({ date }): 删除指定日期的新知日报（用户明确要求时）
- start_ascan_supplement({ date? }): 启动新知补充（非阻塞）。用户说"补充今日新知"时调用，后台自动运行各模块并合并。
- get_ascan_status(): 查看新知补充的运行状态和进度。

规则：
- 用中文回答
- 决定动手前先想清楚要"插入/替换/追加/重写"哪一种，最多调用一次写工具
- 调用写工具后，简要告诉用户你做了什么（"已在光标处插入两段……"），不要重复粘贴整段内容
- 若只是回答用户的提问而不需要修改文档，直接回复文字即可（不调写工具）`;

  let pendingAction: WriterAction | null = null;

  const tools: ToolDefinition[] = [
    {
      type: "function",
      function: {
        name: "insert_text",
        description: "在用户当前光标处（或选区开头）插入文本。",
        parameters: {
          type: "object",
          properties: { text: { type: "string", description: "要插入的 markdown 文本" } },
          required: ["text"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "replace_selection",
        description: "用新文本替换用户当前选中的区间（仅当 selection 存在时调用）。",
        parameters: {
          type: "object",
          properties: { text: { type: "string", description: "替换后的 markdown 文本" } },
          required: ["text"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "append_text",
        description: "把文本追加到文档末尾。",
        parameters: {
          type: "object",
          properties: { text: { type: "string", description: "要追加的 markdown 文本" } },
          required: ["text"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "rewrite_document",
        description: "用新内容整篇替换当前文档。仅在重大改写时使用。",
        parameters: {
          type: "object",
          properties: { text: { type: "string", description: "全文" } },
          required: ["text"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_notes",
        description: "语义检索用户的笔记，用于查找写作素材。",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "number", description: "默认 5，最大 20" },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_note",
        description: "按 id 读取某条笔记的完整正文。",
        parameters: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "web_fetch",
        description: "抓取一个 URL 的网页正文。",
        parameters: {
          type: "object",
          properties: { url: { type: "string" } },
          required: ["url"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_web",
        description: "联网搜索关键词。",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            maxResults: { type: "number" },
          },
          required: ["query"],
        },
      },
    },
    ...ascanToolDefinitions,
  ];

  const captureWrite = (type: WriterAction["type"]) =>
    async ({ text }: { text: string }): Promise<string> => {
      if (typeof text !== "string" || text.length === 0) return "需要 text 参数";
      // Last write wins — letting the model self-correct is simpler than rejecting a 2nd call.
      pendingAction = { type, text };
      return `已记录 ${type}（${text.length} 字），将在客户端应用`;
    };

  const toolHandlers: Record<string, (args: any) => Promise<string>> = {
    ...makeAscanHandlers(req.userId!),
    insert_text: captureWrite("insert_text"),
    replace_selection: captureWrite("replace_selection"),
    append_text: captureWrite("append_text"),
    rewrite_document: captureWrite("rewrite_document"),
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
    read_note: async ({ id }: { id: string }) => {
      const note = await db.query.notes.findFirst({
        where: and(eq(notes.id, id), eq(notes.userId, req.userId!)),
      });
      if (!note) return "笔记不存在";
      return `标题: ${note.title || "无标题"}\n摘要: ${note.aiSummary || "无"}\n来源: ${note.sourceUrl || "无"}\n\n---\n${note.content}`;
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

  const writerHistoryMessages: ContextMessage[] = allMessages.map(m => ({
    role: m.role,
    content: m.content,
    isSummary: m.isSummary,
    tool_calls: m.toolCalls as any[] | undefined,
    tool_call_id: m.toolCallId || undefined,
  }));
  const writerTrimmed = trimToTokenBudget(writerHistoryMessages);

  const llmMessages = [
    { role: "system", content: systemPrompt },
    ...writerTrimmed,
  ];

  const chatConfig = await getUserChatConfig(req.userId!);

  const writerIntermediateMessages: Array<{ role: string; content: string | null; tool_calls?: any[]; tool_call_id?: string }> = [];
  const reply = await chatCompletionWithTools(llmMessages, tools, toolHandlers, chatConfig, 6, (msg) => {
    writerIntermediateMessages.push(msg);
  });

  await db.transaction(async (tx) => {
    for (const msg of writerIntermediateMessages) {
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

  const assistantMsg = await db.query.chatMessages.findFirst({
    where: and(eq(chatMessages.sessionId, session.id), eq(chatMessages.role, "assistant")),
    orderBy: [desc(chatMessages.createdAt)],
  }) ?? { id: "", content: reply };

  await db.update(chatSessions)
    .set({ updatedAt: new Date(), title: session.title || message.slice(0, 50) })
    .where(eq(chatSessions.id, session.id));

  if (needsCompaction(allMessages.length + 2)) {
    compactSession(session.id).catch(console.error);
  }

  const finalAction = pendingAction as WriterAction | null;
  console.log(`[writer-chat] session=${session.id.slice(0, 8)} duration=${Date.now() - start}ms docLen=${documentText.length} hasSelection=${!!selection} action=${finalAction?.type ?? "none"}`);
  res.json({
    message: { id: assistantMsg.id, role: "assistant", content: reply },
    action: finalAction,
  });
});

export { router as chatSessionsRouter };
