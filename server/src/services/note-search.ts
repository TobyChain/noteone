import { db, rowsOf } from "../db/client.js";
import { sql } from "drizzle-orm";
import { generateEmbedding } from "./llm.js";

export interface NoteSearchResult {
  id: string;
  title: string | null;
  ai_summary: string | null;
  content: string;
  source_url: string | null;
  similarity: number;
}

export interface NoteSearchOptions {
  limit?: number;
  contentType?: string | null;
  includeContent?: boolean;
}

export async function searchNotesByEmbedding(
  userId: string,
  query: string,
  opts: NoteSearchOptions = {},
): Promise<NoteSearchResult[]> {
  const { limit = 10, contentType = null } = opts;
  const embedding = await generateEmbedding(query);
  const vectorStr = `[${embedding.join(",")}]`;
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const typeFilter = contentType ? sql`AND content_type = ${contentType}` : sql``;

  const result = await db.execute<any>(sql`
    SELECT id, title, ai_summary, content, source_url,
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
