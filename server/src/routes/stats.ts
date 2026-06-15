import { Router } from "express";
import { db } from "../db/client.js";
import { notes, noteTags, tags } from "../db/schema.js";
import { eq, and, sql, count, ne } from "drizzle-orm";
import { AuthRequest } from "../middleware/auth.js";

const router = Router();

// GET /api/stats
router.get("/", async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const notTrashed = and(eq(notes.userId, userId), ne(notes.status, "trashed"));

  const totalNotes = await db.select({ count: count() })
    .from(notes)
    .where(notTrashed);

  const byContentType = await db.select({
    contentType: notes.contentType,
    count: count(),
  })
    .from(notes)
    .where(notTrashed)
    .groupBy(notes.contentType);

  const topTags = await db.select({
    name: tags.name,
    dimension: tags.dimension,
    count: count(),
  })
    .from(noteTags)
    .innerJoin(tags, eq(noteTags.tagId, tags.id))
    .innerJoin(notes, and(eq(noteTags.noteId, notes.id), eq(notes.userId, userId), ne(notes.status, "trashed")))
    .groupBy(tags.name, tags.dimension)
    .orderBy(sql`count(*) DESC`)
    .limit(20);

  res.json({
    totalNotes: totalNotes[0].count,
    byContentType,
    topTags,
  });
});

export { router as statsRouter };
