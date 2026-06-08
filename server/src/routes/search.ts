import { Router } from "express";
import { db, sql as pgClient } from "../db/client.js";
import { notes } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";
import { generateEmbedding } from "../services/llm.js";
import { AuthRequest } from "../middleware/auth.js";

const router = Router();

// POST /api/search
router.post("/", async (req: AuthRequest, res) => {
  const { query, contentType, limit = 20 } = req.body;

  if (!query || typeof query !== "string") {
    res.status(400).json({ error: "query is required" });
    return;
  }

  try {
    const queryEmbedding = await generateEmbedding(query);
    const vectorStr = `[${queryEmbedding.join(",")}]`;

    const results = await db.execute(sql`
      SELECT
        id, title, content, content_type, source_url,
        source_app, author, author_org, ai_summary,
        status, created_at, updated_at,
        1 - (embedding <=> ${vectorStr}::vector) as similarity
      FROM notes
      WHERE user_id = ${req.userId}
        AND status = 'active'
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vectorStr}::vector
      LIMIT ${limit}
    `);

    res.json({ results });
  } catch (error: any) {
    console.error("[search] Error:", error);
    res.status(500).json({ error: "Search failed" });
  }
});

export { router as searchRouter };
