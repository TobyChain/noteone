import { Router } from "express";
import type { AuthRequest } from "../middleware/auth.js";
import { getFarViewStatus, getFarViewTopic, getLatestFarViewSnapshot, startFarViewRefresh } from "../services/farview/service.js";
import { readUserPreferences } from "../services/newlore/pipeline/index.js";
import { isDateKey } from "../services/calendar-date.js";

export const farviewRouter = Router();

function preferenceTerms(focus?: string, topics?: string): string[] {
  return `${focus ?? ""},${topics ?? ""}`.toLowerCase()
    .split(/[,，;；\n]/).map((value) => value.trim()).filter((value) => value.length >= 2);
}

export function personalizeSnapshot<T extends { topics: Array<{ name: string }> }>(snapshot: T, terms: string[]): T & { topics: Array<T["topics"][number] & { relevance: "related" | "global" }> } {
  if (terms.length === 0) return { ...snapshot, topics: snapshot.topics.map((topic) => ({ ...topic, relevance: "global" as const })) };
  const topics = snapshot.topics.map((topic) => ({
    ...topic,
    relevance: terms.some((term) => topic.name.toLowerCase().includes(term) || term.includes(topic.name.toLowerCase()))
      ? "related" as const : "global" as const,
  })).sort((a, b) => Number(b.relevance === "related") - Number(a.relevance === "related"));
  return { ...snapshot, topics };
}

farviewRouter.get("/overview", async (req: AuthRequest, res) => {
  const snapshot = await getLatestFarViewSnapshot();
  if (!snapshot) {
    res.json({ state: "not_generated", snapshot: null });
    return;
  }
  const preferences = await readUserPreferences(req.userId);
  const personalized = personalizeSnapshot(snapshot, preferenceTerms(preferences?.focus, preferences?.topics));
  res.json({ state: snapshot.topics.length ? "ready" : "insufficient_data", snapshot: personalized });
});

farviewRouter.get("/topics/:id", async (req: AuthRequest, res) => {
  const result = await getFarViewTopic(String(req.params.id));
  if (!result) {
    res.status(404).json({ error: "Topic not found" });
    return;
  }
  res.json(result);
});

farviewRouter.post("/refresh", async (req: AuthRequest, res) => {
  const through = typeof req.body?.through === "string" ? req.body.through : new Date();
  if (typeof through === "string" && !isDateKey(through)) {
    res.status(400).json({ error: "Invalid through date. Use YYYY-MM-DD." });
    return;
  }
  res.status(202).json(startFarViewRefresh(through));
});

farviewRouter.get("/status", async (_req: AuthRequest, res) => {
  res.json(await getFarViewStatus());
});
