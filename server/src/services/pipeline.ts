import { tagNote } from "./tagging.js";
import { enrichNote } from "./enrichment.js";
import { LLMConfig, isLLMConfigured, LLMNotConfiguredError } from "./llm.js";
import { getUserChatConfig } from "./user-config.js";
import { fetchUrlContent } from "./web-fetch.js";
import { db } from "../db/client.js";
import { notes } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";

async function markFailed(noteId: string, aiSummary: string): Promise<void> {
  await db.update(notes)
    .set({ status: "failed", aiSummary, updatedAt: new Date() })
    .where(eq(notes.id, noteId))
    .catch((e) => console.error(`[pipeline] failed to mark note ${noteId} as failed:`, e));
}

async function markActiveNoAI(noteId: string): Promise<void> {
  await db.update(notes)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(notes.id, noteId))
    .catch((e) => console.error(`[pipeline] failed to mark note ${noteId} as active (no-AI):`, e));
}

// Pull the first http(s) URL out of free text, so pasted/shared links still get
// fetched even when the client didn't populate sourceUrl.
function extractFirstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"')\]]+/i);
  return m ? m[0] : null;
}

export async function processNote(
  noteId: string,
  userId: string,
  content: string,
  contentType: string,
  sourceUrl?: string | null,
  llmConfig?: LLMConfig,
): Promise<void> {
  const start = Date.now();
  console.log(`[pipeline] start noteId=${noteId} userId=${userId.slice(0, 8)} contentType=${contentType} contentLen=${content.length}`);
  try {
    const chatConfig = llmConfig ?? (await getUserChatConfig(userId));
    if (!isLLMConfigured(chatConfig)) {
      await markActiveNoAI(noteId);
      console.warn(`[pipeline] WARNING: LLM not configured — note ${noteId} saved as active without AI processing. Configure API Key in settings to enable AI features.`);
      console.log(`[pipeline] done noteId=${noteId} duration=${Date.now() - start}ms status=active reason=llm-not-configured`);
      return;
    }
    let effectiveContent = content;
    let effectiveContentType = contentType;

    const isMedia = contentType === "image" || contentType === "video";
    const linkSource = contentType === "mixed" ? extractFirstUrl(content) : (sourceUrl || extractFirstUrl(content));
    const fetchUrl = isMedia ? null : linkSource;
    const userText = fetchUrl ? content.replace(fetchUrl, "").trim() : content.trim();

    if (fetchUrl) {
      const fetchStart = Date.now();
      const fetched = await fetchUrlContent(fetchUrl);
      console.log(`[pipeline] url-fetch noteId=${noteId} url=${fetchUrl.slice(0, 80)} duration=${Date.now() - fetchStart}ms status=${fetched.error ? "error" : "ok"}`);
      if (!fetched.error && fetched.content) {
        if (contentType === "text" && userText.length === 0) {
          effectiveContentType = "link";
        }

        const meta: Record<string, unknown> = {
          contentType: effectiveContentType,
          rawContent: {
            fetchedUrl: fetched.url,
            fetchedTitle: fetched.title,
            fetchedContent: fetched.content,
            fetchedAt: new Date().toISOString(),
          },
        };
        if (!sourceUrl) meta.sourceUrl = fetchUrl;
        if (fetched.author) meta.author = sql`COALESCE(${notes.author}, ${fetched.author})`;
        if (fetched.siteName) meta.authorOrg = sql`COALESCE(${notes.authorOrg}, ${fetched.siteName})`;
        if (fetched.siteName) meta.sourceApp = sql`COALESCE(${notes.sourceApp}, ${fetched.siteName})`;

        await db.update(notes)
          .set(meta)
          .where(eq(notes.id, noteId));

        effectiveContent = userText.length > 0
          ? `用户笔记：${userText}\n\n来源页面「${fetched.title}」内容：\n${fetched.content}`
          : `来源页面「${fetched.title}」内容：\n${fetched.content}`;
      } else {
        console.error(`[pipeline] url-fetch-failed noteId=${noteId} url=${fetchUrl} error=${fetched.error}`);
        if (userText.length === 0) {
          await markFailed(noteId, "内容获取失败，请检查链接或重新输入");
          console.log(`[pipeline] done noteId=${noteId} duration=${Date.now() - start}ms status=failed reason=url-fetch-no-user-text`);
          return;
        }
        // Still proceed to AI processing with whatever user text we have
        effectiveContent = userText;
      }
    }

    const aiStart = Date.now();
    const results = await Promise.allSettled([
      tagNote(noteId, userId, effectiveContent, effectiveContentType, chatConfig),
      enrichNote(noteId, effectiveContent, effectiveContentType, chatConfig),
    ]);
    console.log(`[pipeline] ai-parallel noteId=${noteId} duration=${Date.now() - aiStart}ms tagging=${results[0].status} enrichment=${results[1].status}`);

    if (results[0].status === "rejected") {
      console.error(`[pipeline] tagging-failed noteId=${noteId}:`, results[0].reason);
    }
    if (results[1].status === "rejected") {
      console.error(`[pipeline] enrichment-failed noteId=${noteId}:`, results[1].reason);
    }

    console.log(`[pipeline] done noteId=${noteId} duration=${Date.now() - start}ms status=active`);
  } catch (err) {
    if (err instanceof LLMNotConfiguredError) {
      await markActiveNoAI(noteId);
      console.warn(`[pipeline] WARNING: LLM not configured — note ${noteId} saved as active without AI processing. Configure API Key in settings to enable AI features.`);
      console.log(`[pipeline] done noteId=${noteId} duration=${Date.now() - start}ms status=active reason=llm-not-configured`);
      return;
    }
    console.error(`[pipeline] unexpected-error noteId=${noteId} duration=${Date.now() - start}ms:`, err);
    await markFailed(noteId, "AI 处理失败");
  }
}
