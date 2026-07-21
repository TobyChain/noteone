import { Router } from "express";
import { db, rowsOf } from "../db/client.js";
import { notes } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";
import { generateEmbedding } from "../services/llm.js";
import { AuthRequest } from "../middleware/auth.js";

const router = Router();

// POST /api/search
router.post("/", async (req: AuthRequest, res) => {
  const { query } = req.body;

  if (!query || typeof query !== "string") {
    res.status(400).json({ error: "query is required" });
    return;
  }

  const limit = Math.min(Math.max(parseInt(req.body.limit) || 20, 1), 100);

  // Optional content-type filter (previously accepted but ignored).
  const validTypes = ["text", "image", "video", "link", "mixed"];
  const contentType = typeof req.body.contentType === "string" && validTypes.includes(req.body.contentType)
    ? req.body.contentType
    : null;

  try {
    const embedStart = Date.now();
    const queryEmbedding = await generateEmbedding(query);
    const embedDuration = Date.now() - embedStart;
    const vectorStr = `[${queryEmbedding.join(",")}]`;
    const typeFilter = contentType ? sql`AND content_type = ${contentType}` : sql``;

    const searchStart = Date.now();
    const results = rowsOf(await db.execute(sql`
      SELECT
        id, title, content, content_type, source_url,
        source_app, author, author_org, ai_summary,
        status, created_at, updated_at,
        1 - (embedding <=> ${vectorStr}::vector) as similarity
      FROM notes
      WHERE user_id = ${req.userId}
        AND status = 'active'
        AND embedding IS NOT NULL
        ${typeFilter}
      ORDER BY embedding <=> ${vectorStr}::vector
      LIMIT ${limit}
    `));
    const searchDuration = Date.now() - searchStart;
    const resultCount = results.length;
    console.log(`[search] queryLen=${query.length} embedDuration=${embedDuration}ms searchDuration=${searchDuration}ms results=${resultCount}`);

    res.json({ results });
  } catch (error: any) {
    console.error("[search] Error:", error);
    res.status(500).json({ error: "Search failed" });
  }
});

export { router as searchRouter };
