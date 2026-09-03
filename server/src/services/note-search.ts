import { db, rowsOf } from "../db/client.js";
import { sql } from "drizzle-orm";
import { generateEmbedding } from "./llm.js";
import type { LLMConfig } from "./llm.js";
import { isLLMConfigured } from "./llm.js";
import { getUserChatConfig } from "./user-config.js";

export interface NoteSearchResult {
  id: string;
  title: string | null;
  ai_summary: string | null;
  content: string;
  source_url: string | null;
  source_app: string | null;
  author: string | null;
  author_org: string | null;
  content_type: string;
  created_at: Date;
  updated_at: Date;
  similarity: number | null;
}

export interface NoteSearchOptions {
  limit?: number;
  contentType?: string | null;
  includeContent?: boolean;
  llmConfig?: LLMConfig;
}

export interface NoteSearchResponse {
  results: NoteSearchResult[];
  mode: "semantic" | "text";
}

export async function searchNotesByEmbedding(
  userId: string,
  query: string,
  opts: NoteSearchOptions = {},
): Promise<NoteSearchResult[]> {
  const { limit = 10, contentType = null } = opts;
  const embedding = await generateEmbedding(query, opts.llmConfig);
  const vectorStr = `[${embedding.join(",")}]`;
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const typeFilter = contentType ? sql`AND content_type = ${contentType}` : sql``;

  const result = await db.execute<any>(sql`
    SELECT id, title, ai_summary, content, source_url, source_app, author, author_org,
           content_type, created_at, updated_at,
           1 - (embedding <=> ${vectorStr}::vector) AS similarity
    FROM notes
    WHERE user_id = ${userId}
      AND status != 'trashed'
      AND embedding IS NOT NULL
      ${typeFilter}
    ORDER BY embedding <=> ${vectorStr}::vector
    LIMIT ${safeLimit}
  `);
  return rowsOf<NoteSearchResult>(result);
}

export async function searchNotesByText(
  userId: string,
  query: string,
  opts: NoteSearchOptions = {},
): Promise<NoteSearchResult[]> {
  const { limit = 10, contentType = null } = opts;
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const typeFilter = contentType ? sql`AND content_type = ${contentType}` : sql``;
  const result = await db.execute<any>(sql`
    SELECT id, title, ai_summary, content, source_url, source_app, author, author_org,
           content_type, created_at, updated_at, NULL::real AS similarity
    FROM notes
    WHERE user_id = ${userId}
      AND status != 'trashed'
      AND (position(lower(${query}) in lower(coalesce(title, ''))) > 0
           OR position(lower(${query}) in lower(content)) > 0
           OR position(lower(${query}) in lower(coalesce(ai_summary, ''))) > 0)
      ${typeFilter}
    ORDER BY updated_at DESC
    LIMIT ${safeLimit}
  `);
  return rowsOf<NoteSearchResult>(result);
}

export async function searchNotes(
  userId: string,
  query: string,
  opts: NoteSearchOptions = {},
): Promise<NoteSearchResponse> {
  const llmConfig = opts.llmConfig ?? await getUserChatConfig(userId);
  if (isLLMConfigured(llmConfig)) {
    try {
      const semantic = await searchNotesByEmbedding(userId, query, { ...opts, llmConfig });
      if (semantic.length > 0) return { results: semantic, mode: "semantic" };
    } catch (error) {
      console.warn("[search] semantic search unavailable, falling back to text:", error);
    }
  }
  return { results: await searchNotesByText(userId, query, opts), mode: "text" };
}
