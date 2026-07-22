import { Router } from "express";
import { searchNotesByEmbedding } from "../services/note-search.js";
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

  const validTypes = ["text", "image", "video", "link", "mixed"];
  const contentType = typeof req.body.contentType === "string" && validTypes.includes(req.body.contentType)
    ? req.body.contentType
    : null;

  try {
    const start = Date.now();
    const results = await searchNotesByEmbedding(req.userId!, query, { limit, contentType });
    console.log(`[search] queryLen=${query.length} duration=${Date.now() - start}ms results=${results.length}`);
    res.json({ results });
  } catch (error: any) {
    console.error("[search] Error:", error);
    res.status(500).json({ error: "Search failed" });
  }
});

export { router as searchRouter };
