import { Router } from "express";
import { db } from "../db/client.js";
import { chatSessions, chatMessages, notes, noteTags, tags } from "../db/schema.js";
import { eq, and, asc, lt, desc } from "drizzle-orm";
import { AuthRequest } from "../middleware/auth.js";
import { z } from "zod";
import { chatCompletion, chatCompletionWithTools, ToolDefinition } from "../services/llm.js";
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
    where: eq(notes.userId, req.userId!),
    columns: { id: true, title: true, aiSummary: true, contentType: true, createdAt: true },
  });

  const allTags = await db.select({
    noteId: noteTags.noteId,
    name: tags.name,
  }).from(noteTags).innerJoin(tags, eq(noteTags.tagId, tags.id));

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

用户共有 ${allNotes.length} 条笔记，索引如下：
${noteIndex}

你拥有 web_fetch 工具，当用户消息中包含链接，或你需要查看某个网页的内容时，主动调用 web_fetch 获取页面内容后再回答。

规则：
- 用中文回答
- 引用笔记时注明标题
- 简洁友好
- 遇到 URL 时主动使用 web_fetch 查看内容`;

  const NOTTY_TOOLS: ToolDefinition[] = [{
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
  }];

  const toolHandlers: Record<string, (args: any) => Promise<string>> = {
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

  const reply = await chatCompletionWithTools(llmMessages, NOTTY_TOOLS, toolHandlers);

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
