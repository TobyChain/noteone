import { Router } from "express";
import express from "express";
import AdmZip from "adm-zip";
import path from "node:path";
import fs from "node:fs";
import { db } from "../db/client.js";
import {
    notes, tags, noteTags, chatSessions, chatMessages,
} from "../db/schema.js";
import { eq } from "drizzle-orm";
import { AuthRequest } from "../middleware/auth.js";
import { UPLOAD_DIR } from "./uploads.js";
import { generateEmbedding, isLLMConfigured } from "../services/llm.js";
import { getUserChatConfig } from "../services/user-config.js";

const router = Router();

interface ImportPayload {
    schemaVersion: string;
    notes: any[];
    tags: any[];
    noteTags: any[];
    chatSessions: any[];
}

function toDate(v: any): Date | null {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
}

// The archive arrives as a raw request body (application/zip). The client just uploads the
// file bytes — no multipart boundary wrangling.
router.post("/", express.raw({ type: "*/*", limit: "500mb" }), async (req: AuthRequest, res) => {
    const userId = req.userId!;
    const buffer = req.body;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        res.status(400).json({ error: "No zip body received" });
        return;
    }

    let zip: AdmZip;
    try {
        zip = new AdmZip(buffer);
    } catch {
        res.status(400).json({ error: "Could not read zip archive" });
        return;
    }

    const jsonEntry = zip.getEntries().find((e) => e.entryName === "noteone-export.json");
    if (!jsonEntry) {
        res.status(400).json({ error: "noteone-export.json not found in archive" });
        return;
    }

    let payload: ImportPayload;
    try {
        payload = JSON.parse(jsonEntry.getData().toString("utf8"));
    } catch {
        res.status(400).json({ error: "noteone-export.json is not valid JSON" });
        return;
    }

    if (!payload.notes || !payload.tags || !payload.noteTags || !payload.chatSessions) {
        res.status(400).json({ error: "Export payload is missing required sections" });
        return;
    }

    // Restore uploaded images referenced by image/mixed notes. Path traversal is rejected;
    // only basenames matching the upload naming convention are written.
    let imagesRestored = 0;
    for (const entry of zip.getEntries()) {
        const name = entry.entryName;
        if (!name.startsWith("uploads/")) continue;
        const basename = path.basename(name);
        if (basename.includes("..") || path.isAbsolute(basename)) continue;
        const local = path.resolve(UPLOAD_DIR, basename);
        if (path.relative(UPLOAD_DIR, local).startsWith("..")) continue;
        try {
            fs.writeFileSync(local, entry.getData());
            imagesRestored++;
        } catch (err) {
            console.warn(`[import] failed to restore image ${basename}:`, err);
        }
    }

    try {
        const counts = await db.transaction(async (tx) => {
            // Tags — upsert by id, claimed by the current user.
            if (payload.tags.length > 0) {
                await tx.insert(tags).values(
                    payload.tags.map((t) => ({
                        id: t.id,
                        userId,
                        name: t.name,
                        dimension: t.dimension ?? "topic",
                        parentId: t.parentId ?? null,
                        description: t.description ?? null,
                        createdAt: toDate(t.createdAt) ?? new Date(),
                    })),
                ).onConflictDoNothing();
            }

            // Notes — insert by source id. On a fresh device there are no collisions; if a
            // note with the same id already exists (re-import, or same-DB different account)
            // we skip it rather than overwrite, so one user's import can never clobber another's.
            if (payload.notes.length > 0) {
                await tx.insert(notes).values(
                    payload.notes.map((n) => ({
                        id: n.id,
                        userId,
                        contentType: n.contentType ?? "text",
                        title: n.title ?? null,
                        content: n.content ?? "",
                        rawContent: n.rawContent ?? null,
                        sourceUrl: n.sourceUrl ?? null,
                        sourceApp: n.sourceApp ?? null,
                        author: n.author ?? null,
                        authorOrg: n.authorOrg ?? null,
                        aiSummary: n.aiSummary ?? null,
                        status: n.status ?? "active",
                        deletedAt: toDate(n.deletedAt),
                        createdAt: toDate(n.createdAt) ?? new Date(),
                        updatedAt: toDate(n.updatedAt) ?? new Date(),
                    })),
                ).onConflictDoNothing();
            }

            // Note↔tag links.
            if (payload.noteTags.length > 0) {
                await tx.insert(noteTags).values(
                    payload.noteTags.map((l) => ({
                        noteId: l.noteId,
                        tagId: l.tagId,
                        confidence: l.confidence ?? null,
                        isManual: l.isManual ?? false,
                    })),
                ).onConflictDoNothing();
            }

            // Chat sessions + messages. Messages are nested under their session in the export;
            // flatten them with the parent sessionId attached.
            const allMessages = payload.chatSessions.flatMap((s) =>
                (s.messages ?? []).map((m: any) => ({ ...m, sessionId: s.id })),
            );
            if (payload.chatSessions.length > 0) {
                await tx.insert(chatSessions).values(
                    payload.chatSessions.map((s) => ({
                        id: s.id,
                        userId,
                        title: s.title ?? null,
                        createdAt: toDate(s.createdAt) ?? new Date(),
                        updatedAt: toDate(s.updatedAt) ?? new Date(),
                    })),
                ).onConflictDoNothing();
            }
            if (allMessages.length > 0) {
                await tx.insert(chatMessages).values(
                    allMessages.map((m) => ({
                        id: m.id,
                        sessionId: m.sessionId,
                        role: m.role,
                        content: m.content ?? "",
                        isSummary: m.isSummary ?? false,
                        toolCalls: m.toolCalls ?? null,
                        toolCallId: m.toolCallId ?? null,
                        createdAt: toDate(m.createdAt) ?? new Date(),
                    })),
                ).onConflictDoNothing();
            }

            return {
                notes: payload.notes.length,
                tags: payload.tags.length,
                noteTags: payload.noteTags.length,
                chatSessions: payload.chatSessions.length,
                chatMessages: allMessages.length,
                images: imagesRestored,
            };
        });

        // Re-derive embeddings asynchronously for imported notes that lack one. Fire-and-forget
        // so the API returns immediately; only runs when an embedding-capable LLM is configured.
        const chatConfig = await getUserChatConfig(userId).catch(() => null);
        if (chatConfig && isLLMConfigured(chatConfig)) {
            reindexImportedNotes(payload.notes.map((n) => n.id), chatConfig).catch((err) => {
                console.error("[import] background reindex failed:", err);
            });
        }

        res.json({ ok: true, imported: counts });
    } catch (err) {
        console.error("[import] failed:", err);
        res.status(500).json({
            error: err instanceof Error ? err.message : "Import failed",
        });
    }
});

/// Regenerates embeddings for the given note ids (those just imported without one), with
/// bounded concurrency so we don't hammer the embedding provider.
async function reindexImportedNotes(noteIds: string[], _llmConfig: any): Promise<void> {
    const CONCURRENCY = 4;
    let cursor = 0;
    async function worker() {
        while (cursor < noteIds.length) {
            const id = noteIds[cursor++];
            try {
                const note = await db.query.notes.findFirst({ where: eq(notes.id, id) });
                if (!note || note.embedding) continue;
                if (!note.content?.trim()) continue;
                const embedding = await generateEmbedding(note.content);
                await db.update(notes).set({ embedding }).where(eq(notes.id, id));
            } catch (err) {
                console.warn(`[import] reindex failed for note ${id}:`, err);
            }
        }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    console.log(`[import] background reindex done for ${noteIds.length} notes`);
}

export { router as importRouter };
