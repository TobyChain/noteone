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
  const [summary, title, embedding] = await Promise.all([
    generateSummary(content, llmConfig),
    generateTitle(content, llmConfig),
    generateEmbedding(content, llmConfig),
  ]);

  await db.update(notes)
    .set({
      aiSummary: summary,
      title: sql`COALESCE(${notes.title}, ${title})`,
      embedding: embedding,
      status: "active",
      updatedAt: new Date(),
    })
    .where(eq(notes.id, noteId));
}

async function generateSummary(content: string, llmConfig?: LLMConfig): Promise<string> {
  return chatCompletion(
    [{ role: "user", content: `用一句话总结以下内容（不超过100字）：\n\n${content.slice(0, 3000)}` }],
    llmConfig,
  );
}

async function generateTitle(content: string, llmConfig?: LLMConfig): Promise<string> {
  return chatCompletion(
    [{ role: "user", content: `为以下内容生成一个简短的标题（不超过30字）：\n\n${content.slice(0, 2000)}` }],
    llmConfig,
  );
}
