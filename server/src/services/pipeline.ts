import { tagNote } from "./tagging.js";
import { enrichNote } from "./enrichment.js";
import { LLMConfig } from "./llm.js";

export async function processNote(
  noteId: string,
  content: string,
  contentType: string,
  llmConfig?: LLMConfig,
): Promise<void> {
  try {
    await Promise.all([
      tagNote(noteId, content, contentType, llmConfig),
      enrichNote(noteId, content, contentType, llmConfig),
    ]);
    console.log(`[pipeline] Note ${noteId} processed successfully`);
  } catch (error) {
    console.error(`[pipeline] Error processing note ${noteId}:`, error);
  }
}
