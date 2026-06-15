import { tagNote } from "./tagging.js";
import { enrichNote } from "./enrichment.js";
import { LLMConfig } from "./llm.js";
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
  try {
    // Use the note owner's custom chat model if configured, else the global default.
    const chatConfig = llmConfig ?? (await getUserChatConfig(userId));
    let effectiveContent = content;
    let effectiveContentType = contentType;

    // For link/text notes we go "inside" the link: fetch the page so that the
    // title / summary / tags describe the actual article, not the bare URL.
    // image/video notes point at the media itself, so they are never fetched.
    const isMedia = contentType === "image" || contentType === "video";
    // For "mixed" notes the sourceUrl is an uploaded image (not a fetchable page), so only
    // consider a real link found inside the user's text; for text/link notes use sourceUrl too.
    const linkSource = contentType === "mixed" ? extractFirstUrl(content) : (sourceUrl || extractFirstUrl(content));
    const fetchUrl = isMedia ? null : linkSource;
    // The note is "essentially a link" when its body is just the URL (no commentary).
    const userText = fetchUrl ? content.replace(fetchUrl, "").trim() : content.trim();

    if (fetchUrl) {
      const fetched = await fetchUrlContent(fetchUrl);
      if (!fetched.error && fetched.content) {
        // A bare-link note is really a link: reclassify so the format tag + UI match.
        if (contentType === "text" && userText.length === 0) {
          effectiveContentType = "link";
        }

        // Backfill source/author metadata for citations, only where not already set.
        const meta: Record<string, unknown> = {
          contentType: effectiveContentType,
          rawContent: {
            fetchedUrl: fetched.url,
            fetchedTitle: fetched.title,
            fetchedContent: fetched.content,
            fetchedAt: new Date().toISOString(),
          },
        };
        // Record the link we actually fetched if the note didn't carry one.
        if (!sourceUrl) meta.sourceUrl = fetchUrl;
        if (fetched.author) meta.author = sql`COALESCE(${notes.author}, ${fetched.author})`;
        if (fetched.siteName) meta.authorOrg = sql`COALESCE(${notes.authorOrg}, ${fetched.siteName})`;
        if (fetched.siteName) meta.sourceApp = sql`COALESCE(${notes.sourceApp}, ${fetched.siteName})`;

        await db.update(notes)
          .set(meta)
          .where(eq(notes.id, noteId));

        // Page content leads so the LLM titles/summarizes/tags the article itself;
        // any user commentary is kept as secondary context.
        effectiveContent = userText.length > 0
          ? `用户笔记：${userText}\n\n来源页面「${fetched.title}」内容：\n${fetched.content}`
          : `来源页面「${fetched.title}」内容：\n${fetched.content}`;
      } else {
        console.error(`[pipeline] URL fetch failed for ${fetchUrl}:`, fetched.error);
        // A note that is nothing but an unreachable link has no salvageable content.
        if (userText.length < 10) {
          await markFailed(noteId, "内容获取失败，请检查链接或重新输入");
          return;
        }
      }
    }

    const results = await Promise.allSettled([
      tagNote(noteId, userId, effectiveContent, effectiveContentType, chatConfig),
      enrichNote(noteId, effectiveContent, effectiveContentType, chatConfig),
    ]);

    // Enrichment is the critical step (it sets status -> active). If it failed, the note failed.
    if (results[1].status === "rejected") {
      console.error(`[pipeline] enrichment failed for note ${noteId}:`, results[1].reason);
      await markFailed(noteId, "AI 处理失败");
      return;
    }

    // Tagging failure is non-fatal — the note is still usable.
    if (results[0].status === "rejected") {
      console.error(`[pipeline] tagging failed for note ${noteId}:`, results[0].reason);
    } else {
      console.log(`[pipeline] Note ${noteId} processed successfully`);
    }
  } catch (err) {
    console.error(`[pipeline] unexpected error for note ${noteId}:`, err);
    await markFailed(noteId, "AI 处理失败");
  }
}
