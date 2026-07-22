import { Router } from "express";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth.js";

const router = Router();

// GET /api/settings — returns the user's settings with the LLM apiKey masked.
router.get("/", async (req: AuthRequest, res) => {
  const user = await db.query.users.findFirst({
    where: eq(users.id, req.userId!),
    columns: { settings: true },
  });
  const settings = (user?.settings ?? {}) as any;
  const llm = settings.llm ?? {};
  const language = settings.language === "en" ? "en" : "zh";
  res.json({
    llm: {
      baseUrl: llm.baseUrl ?? null,
      model: llm.model ?? null,
      hasApiKey: typeof llm.apiKey === "string" && llm.apiKey.length > 0,
    },
    language,
  });
});

const updateSchema = z.object({
  llm: z.object({
    // empty string clears the field; undefined leaves it unchanged
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    model: z.string().optional(),
  }).optional(),
  language: z.enum(["zh", "en"]).optional(),
});

// PATCH /api/settings — merge LLM config into the user's settings.
router.patch("/", async (req: AuthRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, req.userId!),
    columns: { settings: true },
  });
  const current = (user?.settings ?? {}) as any;
  const currentLlm = current.llm ?? {};
  const incoming = parsed.data.llm ?? {};

  const mergedLlm: Record<string, string> = { ...currentLlm };
  for (const key of ["apiKey", "baseUrl", "model"] as const) {
    if (incoming[key] === undefined) continue;
    if (incoming[key] === "") delete mergedLlm[key]; // empty string clears
    else mergedLlm[key] = incoming[key] as string;
  }

  const merged: Record<string, unknown> = { ...current, llm: mergedLlm };
  if (parsed.data.language !== undefined) {
    merged.language = parsed.data.language;
  }

  await db.update(users)
    .set({ settings: merged, updatedAt: new Date() })
    .where(eq(users.id, req.userId!));

  res.json({
    llm: {
      baseUrl: mergedLlm.baseUrl ?? null,
      model: mergedLlm.model ?? null,
      hasApiKey: typeof mergedLlm.apiKey === "string" && mergedLlm.apiKey.length > 0,
    },
    language: (merged.language === "en" ? "en" : "zh") as "zh" | "en",
  });
});

export { router as settingsRouter };
