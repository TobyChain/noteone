import { tagNote } from "./tagging.js";
import { enrichNote } from "./enrichment.js";
import { LLMConfig } from "./llm.js";

export async function processNote(
  noteId: string,
  content: string,
  contentType: string,
  llmConfig?: LLMConfig,
): Promise<void> {
  const results = await Promise.allSettled([
    tagNote(noteId, content, contentType, llmConfig),
    enrichNote(noteId, content, contentType, llmConfig),
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
