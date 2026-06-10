import { Router } from "express";
import { db } from "../db/client.js";
import { notes, noteTags, tags } from "../db/schema.js";
import { eq, and, desc, inArray } from "drizzle-orm";
import { AuthRequest } from "../middleware/auth.js";
import { z } from "zod";
import { processNote } from "../services/pipeline.js";

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

  // Fire-and-forget: AI pipeline processes note in the background
  processNote(note.id, note.content, note.contentType, note.sourceUrl).catch(console.error);

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

  const noteIds = result.map(n => n.id);
  let tagsByNote: Record<string, any[]> = {};
  if (noteIds.length > 0) {
    const allTags = await db.select({
      noteId: noteTags.noteId,
      tagId: noteTags.tagId,
      name: tags.name,
      dimension: tags.dimension,
      confidence: noteTags.confidence,
      isManual: noteTags.isManual,
    }).from(noteTags)
      .innerJoin(tags, eq(noteTags.tagId, tags.id))
      .where(inArray(noteTags.noteId, noteIds));

    for (const t of allTags) {
      (tagsByNote[t.noteId] ??= []).push(t);
    }
  }

  const notesWithTags = result.map(n => ({
    ...n,
    tags: tagsByNote[n.id] || [],
  }));

  res.json({ notes: notesWithTags, limit, offset });
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

  const noteTags_ = await db.select({
    tagId: noteTags.tagId,
    name: tags.name,
    dimension: tags.dimension,
    confidence: noteTags.confidence,
    isManual: noteTags.isManual,
  }).from(noteTags)
    .innerJoin(tags, eq(noteTags.tagId, tags.id))
    .where(eq(noteTags.noteId, id));

  res.json({ note: { ...note, tags: noteTags_ } });
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

// POST /api/notes/:id/tags
router.post("/:id/tags", async (req: AuthRequest, res) => {
  const { tagId, confidence, isManual } = req.body;
  if (!tagId) {
    res.status(400).json({ error: "tagId is required" });
    return;
  }

  const id = req.params.id as string;
  const note = await db.query.notes.findFirst({
    where: and(eq(notes.id, id), eq(notes.userId, req.userId!)),
  });
  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  await db.insert(noteTags).values({
    noteId: id,
    tagId,
    confidence: confidence ?? null,
    isManual: isManual ?? false,
  });

  res.status(201).json({ attached: true });
});

// GET /api/notes/:id/tags
router.get("/:id/tags", async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const note = await db.query.notes.findFirst({
    where: and(eq(notes.id, id), eq(notes.userId, req.userId!)),
  });
  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  const result = await db.select({
    tagId: noteTags.tagId,
    name: tags.name,
    dimension: tags.dimension,
    confidence: noteTags.confidence,
    isManual: noteTags.isManual,
  })
    .from(noteTags)
    .innerJoin(tags, eq(noteTags.tagId, tags.id))
    .where(eq(noteTags.noteId, id));

  res.json({ tags: result });
});

export { router as notesRouter };
