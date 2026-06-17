import { db } from "../db/client.js";
import { tags, noteTags } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

const MAX_LABEL_LEN = 32;

/**
 * Normalize a free-form source-app string into a stable tag label.
 * Returns null when the result would be empty (don't create `#""` tags).
 */
function normalizeSourceApp(raw: string | undefined | null): string | null {
    if (!raw) return null;
    // Trim, lowercase, collapse internal whitespace, drop characters that don't make sense in a tag.
    const cleaned = String(raw)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9_\-.]/g, "")
        .slice(0, MAX_LABEL_LEN);
    return cleaned.length > 0 ? cleaned : null;
}

/**
 * Find or create a `format`-dimension tag scoped to this user, then return its id.
 * Mirrors the dedup-by-(user, name, dimension) pattern used in `tagging.ts`.
 */
async function ensureFormatTag(userId: string, name: string): Promise<string> {
    const existing = await db.query.tags.findFirst({
        where: and(
            eq(tags.userId, userId),
            eq(tags.name, name),
            eq(tags.dimension, "format"),
        ),
    });
    if (existing) return existing.id;
    const [created] = await db.insert(tags).values({
        userId, name, dimension: "format",
    }).returning();
    return created.id;
}

/**
 * Attach `#prompt` (always) and `#{normalized_source_app}` (when present) to a note as
 * format-dimension tags scoped to the owning user. Idempotent — safe to call again.
 *
 * Used by the MCP `create_note` tool when external AI clients (Claude / Cursor / Codex …)
 * record their prompts as notes. Read-side (list_notes / get_note / search_notes) needs
 * no changes — these are just regular text notes with extra format tags.
 */
export async function attachPromptTags(
    noteId: string,
    userId: string,
    sourceApp: string | undefined | null,
): Promise<{ tagged: string[] }> {
    const labels: string[] = ["prompt"];
    const src = normalizeSourceApp(sourceApp);
    if (src && src !== "prompt") labels.push(src);

    const tagged: string[] = [];
    for (const label of labels) {
        const tagId = await ensureFormatTag(userId, label);
        await db.insert(noteTags).values({
            noteId, tagId, confidence: null, isManual: false,
        }).onConflictDoNothing();
        tagged.push(label);
    }
    return { tagged };
}
