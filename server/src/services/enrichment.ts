import { chatCompletion, generateEmbedding, LLMConfig } from "./llm.js";
import { db } from "../db/client.js";
import { notes } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";

export async function enrichNote(
  noteId: string,
  content: string,
  contentType: string,
  llmConfig?: LLMConfig,
): Promise<void> {
  const start = Date.now();
  const results = await Promise.allSettled([
    generateSummary(content, llmConfig),
    generateTitle(content, llmConfig),
    generateEmbedding(content),
  ]);

  const summary = results[0].status === "fulfilled" ? results[0].value : "";
  const title = results[1].status === "fulfilled" ? results[1].value : "";
  const embedding = results[2].status === "fulfilled" ? results[2].value : null;

  if (results[0].status === "rejected") {
    console.error(`[enrichment] summary-failed noteId=${noteId}:`, results[0].reason);
  }
  if (results[1].status === "rejected") {
    console.error(`[enrichment] title-failed noteId=${noteId}:`, results[1].reason);
  }
  if (results[2].status === "rejected") {
    console.error(`[enrichment] embedding-failed noteId=${noteId}:`, results[2].reason);
  }

  const allFailed = !summary && !title;
  console.log(`[enrichment] noteId=${noteId} duration=${Date.now() - start}ms summaryLen=${summary.length} titleLen=${title.length} embedding=${embedding ? "ok" : "failed"} allFailed=${allFailed}`);

  const updateData: Record<string, unknown> = {
    status: allFailed ? "failed" : "active",
    updatedAt: new Date(),
  };
  if (summary) updateData.aiSummary = summary;
  if (title) updateData.title = sql`COALESCE(${notes.title}, ${title})`;
  if (embedding) updateData.embedding = embedding;

  await db.update(notes)
    .set(updateData)
    .where(eq(notes.id, noteId));
}

async function generateSummary(content: string, llmConfig?: LLMConfig): Promise<string> {
  return chatCompletion(
    [{ role: "user", content: `用一句话总结以下内容（不超过100字）：\n\n${content.slice(0, 6000)}` }],
    llmConfig,
  );
}

async function generateTitle(content: string, llmConfig?: LLMConfig): Promise<string> {
  return chatCompletion(
    [{ role: "user", content: `为以下内容生成一个简短的标题（不超过30字）：\n\n${content.slice(0, 4000)}` }],
    llmConfig,
  );
}
