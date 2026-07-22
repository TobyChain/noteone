/**
 * Notty session service — message processing, persistence, and progressive
 * summarization (compaction). Route layer stays thin; all chat business
 * logic lives here.
 */
import { db } from "../../db/client.js";
import { chatSessions, chatMessages } from "../../db/schema.js";
import { eq, and, asc, desc, inArray } from "drizzle-orm";
import { chatCompletion, type LLMConfig } from "../llm.js";
import { getUserChatConfig, getUserLanguage } from "../user-config.js";
import {
  trimToTokenBudget,
  needsCompaction,
  getProtectionZone,
  buildSummarizationPrompt,
  type ContextMessage,
} from "../context-manager.js";
import { runAgentLoop } from "./agent-loop.js";
import { buildNoteIndex, buildStableSystemPrompt, buildDynamicContext } from "./prompt-builder.js";
import { buildNottyToolkit } from "./tools.js";

// Per-process lock so a flurry of /messages requests can't trigger overlapping compactions
// for the same session (which would risk duplicate summaries / half-deleted history).
const compactingSessions = new Set<string>();

export async function findSession(userId: string, sessionId: string) {
  return db.query.chatSessions.findFirst({
    where: and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)),
  });
}

export interface ProcessedMessage {
  messageId: string;
  reply: string;
}

export async function processSessionMessage(
  userId: string,
  sessionId: string,
  message: string,
  signal?: AbortSignal,
): Promise<ProcessedMessage | null> {
  const start = Date.now();
  const session = await findSession(userId, sessionId);
  if (!session) return null;

  await db.insert(chatMessages).values({
    sessionId: session.id,
    role: "user",
    content: message,
  });

  const [allMessages, noteIndex, chatConfig, language] = await Promise.all([
    db.query.chatMessages.findMany({
      where: eq(chatMessages.sessionId, session.id),
      orderBy: [asc(chatMessages.createdAt)],
    }),
    buildNoteIndex(userId),
    getUserChatConfig(userId),
    getUserLanguage(userId),
  ]);

  const systemPrompt = buildStableSystemPrompt(language);
  const dynamicContext = buildDynamicContext(noteIndex, language);
  const { tools, handlers } = buildNottyToolkit(userId, noteIndex.allNotes, noteIndex.version);

  const historyMessages: ContextMessage[] = allMessages.map((m) => ({
    role: m.role,
    content: m.content,
    isSummary: m.isSummary,
    tool_calls: m.toolCalls as any[] | undefined,
    tool_call_id: m.toolCallId || undefined,
  }));
  const trimmedHistory = trimToTokenBudget(historyMessages);

  const llmMessages = [
    { role: "system", content: systemPrompt },
    { role: "system", content: dynamicContext },
    ...trimmedHistory,
  ];

  // Collect intermediate tool messages for persistence
  const intermediateMessages: Array<{ role: string; content: string | null; tool_calls?: any[]; tool_call_id?: string }> = [];
  const reply = await runAgentLoop(llmMessages, tools, handlers, {
    llmConfig: chatConfig,
    maxIterations: 5,
    signal,
    onIntermediateMessage: (msg) => intermediateMessages.push(msg),
  });

  // Persist intermediate tool messages and final reply atomically
  const assistantId = await db.transaction(async (tx) => {
    if (intermediateMessages.length > 0) {
      await tx.insert(chatMessages).values(
        intermediateMessages.map((msg) => ({
          sessionId: session.id,
          role: msg.role,
          content: msg.content || "",
          toolCalls: msg.tool_calls,
          toolCallId: msg.tool_call_id,
        })),
      );
    }
    const [assistant] = await tx.insert(chatMessages).values({
      sessionId: session.id,
      role: "assistant",
      content: reply,
    }).returning({ id: chatMessages.id });
    return assistant.id;
  });

  await db.update(chatSessions)
    .set({ updatedAt: new Date(), title: session.title || message.slice(0, 50) })
    .where(eq(chatSessions.id, session.id));

  if (needsCompaction(allMessages.length + 2)) {
    compactSession(session.id, chatConfig).catch(console.error);
    console.log(`[chat] session=${session.id.slice(0, 8)} compaction=triggered msgCount=${allMessages.length + 2}`);
  }

  console.log(`[chat] message-processed session=${session.id.slice(0, 8)} duration=${Date.now() - start}ms noteCount=${noteIndex.allNotes.length} historyMsgs=${allMessages.length}`);
  return { messageId: assistantId, reply };
}

export async function compactSession(sessionId: string, llmConfig?: LLMConfig) {
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
    const compactMessages: ContextMessage[] = compactable.map((m) => ({
      role: m.role,
      content: m.content,
      isSummary: m.isSummary,
    }));

    const summary = await chatCompletion(buildSummarizationPrompt(compactMessages, existingSummary), llmConfig);

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
