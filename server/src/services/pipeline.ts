import { tagNote } from "./tagging.js";
import { enrichNote } from "./enrichment.js";
import { LLMConfig } from "./llm.js";
import { fetchUrlContent } from "./web-fetch.js";
import { db } from "../db/client.js";
import { notes } from "../db/schema.js";
import { eq } from "drizzle-orm";

export async function processNote(
  noteId: string,
  content: string,
  contentType: string,
  sourceUrl?: string | null,
  llmConfig?: LLMConfig,
): Promise<void> {
  let effectiveContent = content;

  if (sourceUrl) {
    const fetched = await fetchUrlContent(sourceUrl);
    if (!fetched.error && fetched.content) {
      await db.update(notes)
        .set({
          rawContent: {
            fetchedUrl: fetched.url,
            fetchedTitle: fetched.title,
            fetchedContent: fetched.content,
            fetchedAt: new Date().toISOString(),
          },
        })
        .where(eq(notes.id, noteId));

      effectiveContent = `${content}\n\n---\n来源页面「${fetched.title}」内容：\n${fetched.content}`;
    } else {
      console.error(`[pipeline] URL fetch failed for ${sourceUrl}:`, fetched.error);
    }
  }

  const results = await Promise.allSettled([
    tagNote(noteId, effectiveContent, contentType, llmConfig),
    enrichNote(noteId, effectiveContent, contentType, llmConfig),
  ]);

  for (const result of results) {
    if (result.status === "rejected") {
      console.error(`[pipeline] Partial failure for note ${noteId}:`, result.reason);
    }
  }

  if (results.every(r => r.status === "fulfilled")) {
    console.log(`[pipeline] Note ${noteId} processed successfully`);
  }
}
