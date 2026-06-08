import { Router } from "express";
import { db } from "../db/client.js";
import { tags } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { z } from "zod";

const router = Router();

const createTagSchema = z.object({
  name: z.string().min(1),
  dimension: z.enum(["format", "topic", "domain", "module"]),
  parentId: z.string().uuid().optional(),
  description: z.string().optional(),
});

// POST /api/tags
router.post("/", async (req, res) => {
  const parsed = createTagSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const [tag] = await db.insert(tags).values(parsed.data).returning();
  res.status(201).json({ tag });
});

// GET /api/tags
router.get("/", async (req, res) => {
  const dimension = req.query.dimension as string | undefined;
  const validDimensions = ["format", "topic", "domain", "module"];

  let result;
  if (dimension && validDimensions.includes(dimension)) {
    result = await db.query.tags.findMany({
      where: eq(tags.dimension, dimension as any),
    });
  } else {
    result = await db.query.tags.findMany();
  }

  res.json({ tags: result });
});

// DELETE /api/tags/:id
router.delete("/:id", async (req, res) => {
  const [tag] = await db.delete(tags)
    .where(eq(tags.id, req.params.id))
    .returning();

  if (!tag) {
    res.status(404).json({ error: "Tag not found" });
    return;
  }

  res.json({ deleted: true });
});

export { router as tagsRouter };
