import express from "express";
import { config } from "./config.js";

const app = express();

app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(config.port, () => {
  console.log(`NoteOne server running on port ${config.port}`);
});

export { app };
