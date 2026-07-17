import { Router } from "express";
import { db } from "../db/client.js";
import { notes, noteTags, tags } from "../db/schema.js";
import { eq, and, inArray } from "drizzle-orm";
import { AuthRequest } from "../middleware/auth.js";
import { z } from "zod";
import { chatCompletion } from "../services/llm.js";
import { getUserChatConfig } from "../services/user-config.js";

const router = Router();

const chatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
  })),
  noteIds: z.array(z.string()).optional(),
});

router.post("/", async (req: AuthRequest, res) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { messages, noteIds } = parsed.data;

  const allNotes = await db.query.notes.findMany({
    where: eq(notes.userId, req.userId!),
    columns: { id: true, title: true, aiSummary: true, contentType: true, createdAt: true },
  });

  const noteIdList = allNotes.map(n => n.id);
  const allTags = noteIdList.length === 0 ? [] : await db.select({
    noteId: noteTags.noteId,
    name: tags.name,
    dimension: tags.dimension,
  }).from(noteTags)
    .innerJoin(tags, eq(noteTags.tagId, tags.id))
    .where(inArray(noteTags.noteId, noteIdList));

  const tagsByNote = new Map<string, string[]>();
  for (const t of allTags) {
    const list = tagsByNote.get(t.noteId) || [];
    list.push(t.name);
    tagsByNote.set(t.noteId, list);
  }

  const noteIndex = allNotes.map((n, i) => {
    const ntags = tagsByNote.get(n.id)?.join(", ") || "";
    return `[${i + 1}] id=${n.id} | ${n.title || "无标题"} | ${n.aiSummary?.slice(0, 80) || "无摘要"} | ${n.contentType} | ${n.createdAt.toISOString().slice(0, 10)} | tags: ${ntags}`;
  }).join("\n");

  let noteDetails = "";
  if (noteIds && noteIds.length > 0) {
    const detailed = await db.query.notes.findMany({
      where: and(eq(notes.userId, req.userId!), inArray(notes.id, noteIds)),
    });
    noteDetails = detailed.map(n =>
      `\n--- 笔记: ${n.title || "无标题"} (${n.id}) ---\n${n.content}\n`
    ).join("\n");
  }

  const systemPrompt = `你是闹闹，壹识应用的 AI 助手。你可以帮助用户检索、总结和分析他们的笔记。

用户共有 ${allNotes.length} 条笔记，索引如下：
${noteIndex}

${noteDetails ? `以下是用户请求查看的笔记详情：${noteDetails}` : ""}

规则：
- 用中文回答
- 引用笔记时注明标题
- 简洁友好
- 如需查看某条笔记的完整内容，告诉用户你需要哪条笔记的详情`;

  const llmMessages = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  const chatConfig = await getUserChatConfig(req.userId!);
  const reply = await chatCompletion(llmMessages, chatConfig);

  res.json({ message: { role: "assistant", content: reply } });
});

export { router as chatRouter };
