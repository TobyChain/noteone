import { Router } from "express";
import { db } from "../db/client.js";
import { tags } from "../db/schema.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth.js";

const router = Router();

const createTagSchema = z.object({
  name: z.string().min(1),
  dimension: z.enum(["format", "topic", "domain", "module"]),
  parentId: z.string().uuid().optional(),
  description: z.string().optional(),
});

// POST /api/tags
router.post("/", async (req: AuthRequest, res) => {
  const parsed = createTagSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const [tag] = await db.insert(tags).values({
    ...parsed.data,
    userId: req.userId!,
  }).returning();
  res.status(201).json({ tag });
});

// GET /api/tags
router.get("/", async (req: AuthRequest, res) => {
  const dimension = req.query.dimension as string | undefined;
  const validDimensions = ["format", "topic", "domain", "module"];

  const where = dimension && validDimensions.includes(dimension)
    ? and(eq(tags.userId, req.userId!), eq(tags.dimension, dimension as any))
    : eq(tags.userId, req.userId!);

  const result = await db.query.tags.findMany({ where });
  res.json({ tags: result });
});

// DELETE /api/tags/:id
router.delete("/:id", async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  const [tag] = await db.delete(tags)
    .where(and(eq(tags.id, id), eq(tags.userId, req.userId!)))
    .returning();

  if (!tag) {
    res.status(404).json({ error: "Tag not found" });
    return;
  }

  res.json({ deleted: true });
});

export { router as tagsRouter };
