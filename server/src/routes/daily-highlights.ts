import { Router } from "express";
import { AuthRequest } from "../middleware/auth.js";
import { DailyHighlightError, getDailyHighlights, saveDailyHighlight, cancelDailyHighlight, quickNoteDailyHighlight } from "../services/daily-highlights.js";

export const dailyHighlightsRouter = Router();

dailyHighlightsRouter.get("/reports/:date/highlights", async (req: AuthRequest, res) => {
  try {
    res.json(await getDailyHighlights(req.userId!, String(req.params.date)));
  } catch (error) {
    if (error instanceof DailyHighlightError) res.status(error.status).json({ error: error.message });
    else throw error;
  }
});

dailyHighlightsRouter.post("/reports/:date/highlights", async (req: AuthRequest, res) => {
  try {
    res.json(await saveDailyHighlight(req.userId!, String(req.params.date), req.body));
  } catch (error) {
    if (error instanceof DailyHighlightError) res.status(error.status).json({ error: error.message });
    else throw error;
  }
});

dailyHighlightsRouter.delete("/reports/:date/highlights/:id", async (req: AuthRequest, res) => {
  try {
    res.json(await cancelDailyHighlight(req.userId!, String(req.params.date), String(req.params.id)));
  } catch (error) {
    if (error instanceof DailyHighlightError) res.status(error.status).json({ error: error.message });
    else throw error;
  }
});

dailyHighlightsRouter.post("/reports/:date/highlights/:id/quick-note", async (req: AuthRequest, res) => {
  try {
    res.json(await quickNoteDailyHighlight(req.userId!, String(req.params.date), String(req.params.id)));
  } catch (error) {
    if (error instanceof DailyHighlightError) res.status(error.status).json({ error: error.message });
    else throw error;
  }
});
