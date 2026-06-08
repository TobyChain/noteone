import express from "express";
import { config } from "./config.js";
import { authRouter } from "./routes/auth.js";
import { requireAuth } from "./middleware/auth.js";
import { notesRouter } from "./routes/notes.js";
import { tagsRouter } from "./routes/tags.js";
import { searchRouter } from "./routes/search.js";
import { statsRouter } from "./routes/stats.js";

const app = express();

app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/auth", authRouter);
app.use("/api/notes", requireAuth, notesRouter);
app.use("/api/tags", requireAuth, tagsRouter);
app.use("/api/search", requireAuth, searchRouter);
app.use("/api/stats", requireAuth, statsRouter);

app.listen(config.port, () => {
  console.log(`NoteOne server running on port ${config.port}`);
});

export { app };
