import { Router } from "express";
import { db } from "../db/client.js";
import { notes, noteTags, tags } from "../db/schema.js";
import { eq, and, desc, inArray, ne } from "drizzle-orm";
import { AuthRequest } from "../middleware/auth.js";
import { z } from "zod";
import { processNote } from "../services/pipeline.js";

const router = Router();

const NOTE_COLUMNS = {
  id: true, userId: true, contentType: true, title: true, content: true,
  sourceUrl: true, sourceApp: true, author: true, authorOrg: true,
  aiSummary: true, status: true, deletedAt: true,
  createdAt: true, updatedAt: true,
} as const;

async function loadTagsForNotes(noteIds: string[]) {
  if (noteIds.length === 0) return {};
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

  const byNote: Record<string, any[]> = {};
  for (const t of allTags) {
    (byNote[t.noteId] ??= []).push(t);
  }
  return byNote;
}

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

  processNote(note.id, req.userId!, note.content, note.contentType, note.sourceUrl).catch(console.error);

  res.status(201).json({ note });
});

// GET /api/notes
router.get("/", async (req: AuthRequest, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 100);
  const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

  const result = await db.query.notes.findMany({
    columns: NOTE_COLUMNS,
    where: and(eq(notes.userId, req.userId!), ne(notes.status, "trashed")),
    orderBy: desc(notes.createdAt),
    limit,
    offset,
  });

  const tagsByNote = await loadTagsForNotes(result.map(n => n.id));
  const notesWithTags = result.map(n => ({ ...n, tags: tagsByNote[n.id] || [] }));

  res.json({ notes: notesWithTags, limit, offset });
});

// GET /api/notes/trash
router.get("/trash", async (req: AuthRequest, res) => {
  const result = await db.query.notes.findMany({
    columns: NOTE_COLUMNS,
    where: and(eq(notes.userId, req.userId!), eq(notes.status, "trashed")),
    orderBy: desc(notes.deletedAt),
  });

  res.json({ notes: result });
});

// GET /api/notes/:id
router.get("/:id", async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const note = await db.query.notes.findFirst({
    columns: NOTE_COLUMNS,
    where: and(eq(notes.id, id), eq(notes.userId, req.userId!)),
  });

  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  const tagsByNote = await loadTagsForNotes([id]);
  res.json({ note: { ...note, tags: tagsByNote[id] || [] } });
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

  const tagsByNote = await loadTagsForNotes([id]);
  res.json({ note: { ...note, tags: tagsByNote[id] || [] } });
});

// DELETE /api/notes/:id  (soft delete → move to trash)
router.delete("/:id", async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const [note] = await db.update(notes)
    .set({ status: "trashed", deletedAt: new Date() })
    .where(and(eq(notes.id, id), eq(notes.userId, req.userId!), ne(notes.status, "trashed")))
    .returning();

  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  res.json({ deleted: true });
});

// POST /api/notes/:id/restore
router.post("/:id/restore", async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const [note] = await db.update(notes)
    .set({ status: "active", deletedAt: null })
    .where(and(eq(notes.id, id), eq(notes.userId, req.userId!), eq(notes.status, "trashed")))
    .returning();

  if (!note) {
    res.status(404).json({ error: "Note not found or not in trash" });
    return;
  }

  res.json({ note });
});

// DELETE /api/notes/:id/permanent
router.delete("/:id/permanent", async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const [note] = await db.delete(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, req.userId!), eq(notes.status, "trashed")))
    .returning();

  if (!note) {
    res.status(404).json({ error: "Note not found or not in trash" });
    return;
  }

  res.json({ deleted: true });
});

// POST /api/notes/:id/tags
const attachTagSchema = z.object({
  tagId: z.string().uuid(),
  confidence: z.number().optional(),
  isManual: z.boolean().optional(),
});

router.post("/:id/tags", async (req: AuthRequest, res) => {
  const parsed = attachTagSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { tagId, confidence, isManual } = parsed.data;

  const id = req.params.id as string;
  const note = await db.query.notes.findFirst({
    where: and(eq(notes.id, id), eq(notes.userId, req.userId!)),
  });
  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  // the tag must exist and belong to the same user (tenant isolation)
  const tag = await db.query.tags.findFirst({
    where: and(eq(tags.id, tagId), eq(tags.userId, req.userId!)),
  });
  if (!tag) {
    res.status(404).json({ error: "Tag not found" });
    return;
  }

  await db.insert(noteTags).values({
    noteId: id,
    tagId,
    confidence: confidence ?? null,
    isManual: isManual ?? false,
  }).onConflictDoNothing();

  res.status(201).json({ attached: true });
});

// POST /api/notes/:id/retry — re-run the AI pipeline for a failed note
router.post("/:id/retry", async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const [note] = await db.update(notes)
    .set({ status: "pending_ai", aiSummary: null, updatedAt: new Date() })
    .where(and(eq(notes.id, id), eq(notes.userId, req.userId!), ne(notes.status, "trashed")))
    .returning();

  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  processNote(note.id, req.userId!, note.content, note.contentType, note.sourceUrl).catch(console.error);

  res.json({ note });
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
