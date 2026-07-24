import { Router } from "express";
import { db } from "../db/client.js";
import { chatSessions, chatMessages } from "../db/schema.js";
import { eq, desc, asc } from "drizzle-orm";
import { AuthRequest } from "../middleware/auth.js";
import { z } from "zod";
import { findSession, processSessionMessage } from "../services/notty/session-service.js";
import { getUserChatConfig } from "../services/user-config.js";
import { isLLMConfigured } from "../services/llm.js";

const router = Router();

const LLM_NOT_CONFIGURED_MSG = "AI 模型未配置，请先在设置中配置 API Key";

router.get("/", async (req: AuthRequest, res) => {
  const sessions = await db.query.chatSessions.findMany({
    where: eq(chatSessions.userId, req.userId!),
    orderBy: [desc(chatSessions.updatedAt)],
  });
  res.json(sessions);
});

router.post("/", async (req: AuthRequest, res) => {
  const [session] = await db.insert(chatSessions).values({
    userId: req.userId!,
    title: req.body.title || null,
  }).returning();
  res.status(201).json(session);
});

router.get("/:id", async (req: AuthRequest, res) => {
  const session = await findSession(req.userId!, req.params.id as string);
  if (!session) { res.status(404).json({ error: "Not found" }); return; }

  const messages = await db.query.chatMessages.findMany({
    where: eq(chatMessages.sessionId, session.id),
    orderBy: [asc(chatMessages.createdAt)],
  });

  res.json({ ...session, messages });
});

router.delete("/:id", async (req: AuthRequest, res) => {
  const session = await findSession(req.userId!, req.params.id as string);
  if (!session) { res.status(404).json({ error: "Not found" }); return; }
  await db.delete(chatSessions).where(eq(chatSessions.id, session.id));
  res.json({ deleted: true });
});

const sendSchema = z.object({
  message: z.string().min(1),
});

router.post("/:id/messages", async (req: AuthRequest, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const chatConfig = await getUserChatConfig(req.userId!);
  if (!isLLMConfigured(chatConfig)) {
    res.status(400).json({ error: LLM_NOT_CONFIGURED_MSG });
    return;
  }

  const controller = new AbortController();
  req.on("close", () => controller.abort());

  const wantsSSE = (req.headers.accept || "").includes("text/event-stream");

  if (wantsSSE) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await processSessionMessage(
        req.userId!, req.params.id as string, parsed.data.message, controller.signal,
        (activity) => {
          if (activity.type === "start") {
            send("tool_start", { name: activity.name, argsSummary: activity.argsSummary });
          } else {
            send("tool_end", { name: activity.name, durationMs: activity.durationMs, preview: activity.preview });
          }
        },
      );
      if (!result) {
        send("error", { error: "Not found" });
      } else {
        send("message", { id: result.messageId, role: "assistant", content: result.reply });
      }
    } catch (err) {
      send("error", { error: err instanceof Error ? err.message : String(err) });
    }
    res.end();
    return;
  }

  const result = await processSessionMessage(
    req.userId!, req.params.id as string, parsed.data.message, controller.signal,
  );
  if (!result) { res.status(404).json({ error: "Not found" }); return; }

  res.json({ message: { id: result.messageId, role: "assistant", content: result.reply } });
});

export { router as chatSessionsRouter };
