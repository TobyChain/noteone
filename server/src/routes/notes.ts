import { Router } from "express";
import { db } from "../db/client.js";
import { notes } from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { AuthRequest } from "../middleware/auth.js";
import { z } from "zod";

const router = Router();

const createNoteSchema = z.object({
  content: z.string().min(1),
  contentType: z.enum(["text", "image", "video", "link", "mixed"]).default("text"),
  title: z.string().optional(),
  sourceUrl: z.string().optional(),
  sourceApp: z.string().optional(),
  author: z.string().optional(),
  authorOrg: z.string().optional(),
  rawContent: z.any().optional(),
});

const updateNoteSchema = z.object({
  content: z.string().min(1).optional(),
  title: z.string().optional(),
  sourceUrl: z.string().optional(),
  author: z.string().optional(),
  authorOrg: z.string().optional(),
  status: z.enum(["pending_ai", "active", "archived"]).optional(),
});

// POST /api/notes
router.post("/", async (req: AuthRequest, res) => {
  const parsed = createNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const [note] = await db.insert(notes).values({
    userId: req.userId!,
    ...parsed.data,
  }).returning();

  res.status(201).json({ note });
});

// GET /api/notes
router.get("/", async (req: AuthRequest, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const offset = parseInt(req.query.offset as string) || 0;

  const result = await db.query.notes.findMany({
    where: eq(notes.userId, req.userId!),
    orderBy: desc(notes.createdAt),
    limit,
    offset,
  });

  res.json({ notes: result, limit, offset });
});

// GET /api/notes/:id
router.get("/:id", async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const note = await db.query.notes.findFirst({
    where: and(eq(notes.id, id), eq(notes.userId, req.userId!)),
  });

  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  res.json({ note });
});

// PATCH /api/notes/:id
router.patch("/:id", async (req: AuthRequest, res) => {
  const parsed = updateNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const id = req.params.id as string;
  const [note] = await db.update(notes)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(notes.id, id), eq(notes.userId, req.userId!)))
    .returning();

  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  res.json({ note });
});

// DELETE /api/notes/:id
router.delete("/:id", async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const [note] = await db.delete(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, req.userId!)))
    .returning();

  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  res.json({ deleted: true });
});

export { router as notesRouter };
