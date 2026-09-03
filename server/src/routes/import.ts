import { Router } from "express";
import express from "express";
import AdmZip from "adm-zip";
import path from "node:path";
import fs from "node:fs";
import { db } from "../db/client.js";
import {
    users, notes, tags, noteTags, chatSessions, chatMessages, dailyReports, scheduledTasks,
    ascanPapers, ascanGithubRepos, ascanOfficialItems, ascanBlogPosts,
    ascanConferencePapers, ascanWechatArticles,
} from "../db/schema.js";
import { eq, inArray } from "drizzle-orm";
import { AuthRequest } from "../middleware/auth.js";
import { UPLOAD_DIR } from "./uploads.js";
import { generateEmbedding, isLLMConfigured } from "../services/llm.js";
import { getUserChatConfig } from "../services/user-config.js";
import { updateEffectiveConfig, sanitizeConfigUpdates } from "../services/ascan/config.js";
import { ASCAN_DOCS } from "../services/ascan/config.js";
import { restoreTasks } from "../services/scheduler.js";

const router = Router();

interface ImportPayload {
    schemaVersion: string;
    user?: { settings?: any };
    ascanConfig?: Record<string, any>;
    notes: any[];
    tags: any[];
    noteTags: any[];
    chatSessions: any[];
    dailyReports?: any[];
    scheduledTasks?: any[];
    ascanHistory?: {
        papers?: any[]; githubRepos?: any[]; officialItems?: any[]; blogPosts?: any[];
        conferencePapers?: any[]; wechatArticles?: any[];
    };
}

const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;
const IMPORT_UPLOAD_NAME = /^[0-9a-fA-F-]{32,36}\.(png|jpe?g|gif|webp|heic|heif)$/;
const IMPORT_REPORT_NAME = /^Ascan-\d{8}\.(html|md|summary)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toDate(v: any): Date | null {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
}

function normalizeHistoryRow(row: Record<string, any>): Record<string, any> {
    const { id: _id, ...normalized } = row;
    for (const key of ["processedAt", "createdAt", "updatedAt", "createdAtTs", "updatedAtTs"]) {
        if (key in normalized) normalized[key] = toDate(normalized[key]);
    }
    return normalized;
}

function removeRestoredFiles(files: string[]): void {
    for (const file of files) {
        try { fs.unlinkSync(file); } catch { /* best-effort rollback */ }
    }
}

async function validateImportOwnership(payload: ImportPayload, userId: string): Promise<string | null> {
    const noteIds = payload.notes.map((n) => n?.id).filter((id): id is string => typeof id === "string");
    const tagIds = payload.tags.map((t) => t?.id).filter((id): id is string => typeof id === "string");
    const sessionIds = payload.chatSessions.map((s) => s?.id).filter((id): id is string => typeof id === "string");
    const reportIds = (payload.dailyReports ?? []).map((r) => r?.id).filter((id): id is string => typeof id === "string");
    const taskIds = (payload.scheduledTasks ?? []).map((t) => t?.id).filter((id): id is string => typeof id === "string");
    const requiredIds = [
        ["note", payload.notes, noteIds], ["tag", payload.tags, tagIds],
        ["chat session", payload.chatSessions, sessionIds],
        ["daily report", payload.dailyReports ?? [], reportIds],
        ["scheduled task", payload.scheduledTasks ?? [], taskIds],
    ] as const;
    for (const [label, rows, ids] of requiredIds) {
        if (rows.length !== ids.length || ids.some((id) => !UUID.test(id))) {
            return `Archive contains an invalid ${label} id`;
        }
    }

    const checks: Array<[string, string[], any]> = [
        ["note", noteIds, notes], ["tag", tagIds, tags], ["chat session", sessionIds, chatSessions],
        ["daily report", reportIds, dailyReports], ["scheduled task", taskIds, scheduledTasks],
    ];
    for (const [label, ids, table] of checks) {
        if (ids.length === 0) continue;
        const existing = await db.select({ id: table.id, userId: table.userId })
            .from(table).where(inArray(table.id, ids));
        if (existing.some((row: any) => row.userId !== userId)) {
            return `Archive ${label} id conflicts with data owned by another user`;
        }
    }

    const noteSet = new Set(noteIds);
    const tagSet = new Set(tagIds);
    if (payload.tags.some((tag) => tag?.parentId && !tagSet.has(tag.parentId))) {
        return "Archive contains a tag parent relationship outside its own data set";
    }
    if (payload.noteTags.some((link) => !noteSet.has(link?.noteId) || !tagSet.has(link?.tagId))) {
        return "Archive contains a note-tag relationship outside its own data set";
    }
    return null;
}

/// Deep-merge two settings objects. Import values win EXCEPT for absent apiKey: if the
/// export omitted the LLM apiKey (secrets stripped), the target device keeps its own.
function deepMergeSettings(current: any, incoming: any): any {
    const out: any = { ...current };
    for (const [k, v] of Object.entries(incoming ?? {})) {
        if (v && typeof v === "object" && !Array.isArray(v)) {
            out[k] = deepMergeSettings(out[k] ?? {}, v);
        } else if (v !== undefined && v !== null) {
            out[k] = v;
        }
    }
    // Preserve an existing apiKey if the import payload didn't carry one.
    if (current?.llm?.apiKey && !out.llm?.apiKey) {
        out.llm = { ...(out.llm ?? {}), apiKey: current.llm.apiKey };
    }
    return out;
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
    const entries = zip.getEntries();
    const uncompressedBytes = entries.reduce((sum, entry) => sum + entry.header.size, 0);
    if (entries.length > MAX_ARCHIVE_ENTRIES || uncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
        res.status(413).json({ error: "Archive expands beyond the allowed size" });
        return;
    }

    const jsonEntry = entries.find((e) => e.entryName === "noteone-export.json");
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

    if (!payload || typeof payload !== "object"
        || !Array.isArray(payload.notes) || !Array.isArray(payload.tags)
        || !Array.isArray(payload.noteTags) || !Array.isArray(payload.chatSessions)) {
        res.status(400).json({ error: "Export payload is missing required sections" });
        return;
    }
    const ownershipError = await validateImportOwnership(payload, userId);
    if (ownershipError) {
        res.status(409).json({ error: ownershipError });
        return;
    }

    // Restore uploaded images referenced by image/mixed notes. Path traversal is rejected;
    // only basenames matching the upload naming convention are written.
    let imagesRestored = 0;
    const restoredFiles: string[] = [];
    for (const entry of entries) {
        const name = entry.entryName;
        if (!name.startsWith("uploads/")) continue;
        const basename = path.basename(name);
        if (!IMPORT_UPLOAD_NAME.test(basename)) continue;
        const local = path.resolve(UPLOAD_DIR, basename);
        if (path.relative(UPLOAD_DIR, local).startsWith("..")) continue;
        const importedData = entry.getData();
        if (fs.existsSync(local)) {
            if (!fs.readFileSync(local).equals(importedData)) {
                removeRestoredFiles(restoredFiles);
                res.status(409).json({ error: `Archive upload conflicts with existing file: ${basename}` });
                return;
            }
            continue;
        }
        try {
            fs.writeFileSync(local, importedData, { flag: "wx" });
            restoredFiles.push(local);
            imagesRestored++;
        } catch (err: any) {
            if (err?.code === "EEXIST") continue;
            console.warn(`[import] failed to restore image ${basename}:`, err);
        }
    }
    for (const entry of entries) {
        if (!entry.entryName.startsWith("ascan-reports/")) continue;
        const basename = path.basename(entry.entryName);
        if (!IMPORT_REPORT_NAME.test(basename)) continue;
        const local = path.resolve(ASCAN_DOCS, basename);
        const importedData = entry.getData();
        if (fs.existsSync(local)) {
            if (!fs.readFileSync(local).equals(importedData)) {
                removeRestoredFiles(restoredFiles);
                res.status(409).json({ error: `Archive report conflicts with existing file: ${basename}` });
                return;
            }
            continue;
        }
        try {
            fs.writeFileSync(local, importedData, { flag: "wx" });
            restoredFiles.push(local);
        } catch (err: any) {
            if (err?.code !== "EEXIST") console.warn(`[import] failed to restore report ${basename}:`, err);
        }
    }

    try {
        const insertedCounts = {
            notes: 0, tags: 0, noteTags: 0, chatSessions: 0, chatMessages: 0,
            dailyReports: 0, scheduledTasks: 0,
        };
        const counts = await db.transaction(async (tx) => {
            // Tags — upsert by id, claimed by the current user.
            if (payload.tags.length > 0) {
                const insertedTags = await tx.insert(tags).values(
                    payload.tags.map((t) => ({
                        id: t.id,
                        userId,
                        name: t.name,
                        dimension: t.dimension ?? "topic",
                        parentId: t.parentId ?? null,
                        description: t.description ?? null,
                        createdAt: toDate(t.createdAt) ?? new Date(),
                    })),
                ).onConflictDoNothing().returning({ id: tags.id });
                insertedCounts.tags = insertedTags.length;
            }

            // Notes — insert by source id. On a fresh device there are no collisions; if a
            // note with the same id already exists (re-import, or same-DB different account)
            // we skip it rather than overwrite, so one user's import can never clobber another's.
            if (payload.notes.length > 0) {
                const insertedNotes = await tx.insert(notes).values(
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
                ).onConflictDoNothing().returning({ id: notes.id });
                insertedCounts.notes = insertedNotes.length;
            }

            // Note↔tag links.
            if (payload.noteTags.length > 0) {
                const insertedLinks = await tx.insert(noteTags).values(
                    payload.noteTags.map((l) => ({
                        noteId: l.noteId,
                        tagId: l.tagId,
                        confidence: l.confidence ?? null,
                        isManual: l.isManual ?? false,
                    })),
                ).onConflictDoNothing().returning({ noteId: noteTags.noteId });
                insertedCounts.noteTags = insertedLinks.length;
            }

            // Chat sessions + messages. Messages are nested under their session in the export;
            // flatten them with the parent sessionId attached.
            const allMessages = payload.chatSessions.flatMap((s) =>
                (s.messages ?? []).map((m: any) => ({ ...m, sessionId: s.id })),
            );
            if (payload.chatSessions.length > 0) {
                const insertedSessions = await tx.insert(chatSessions).values(
                    payload.chatSessions.map((s) => ({
                        id: s.id,
                        userId,
                        title: s.title ?? null,
                        createdAt: toDate(s.createdAt) ?? new Date(),
                        updatedAt: toDate(s.updatedAt) ?? new Date(),
                    })),
                ).onConflictDoNothing().returning({ id: chatSessions.id });
                insertedCounts.chatSessions = insertedSessions.length;
            }
            if (allMessages.length > 0) {
                const insertedMessages = await tx.insert(chatMessages).values(
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
                ).onConflictDoNothing().returning({ id: chatMessages.id });
                insertedCounts.chatMessages = insertedMessages.length;
            }

            const reports = Array.isArray(payload.dailyReports) ? payload.dailyReports : [];
            if (reports.length > 0) {
                const insertedReports = await tx.insert(dailyReports).values(reports.map((r) => ({
                    id: r.id, userId, date: r.date, style: r.style ?? "minimal",
                    depth: r.depth ?? "brief", status: r.status ?? "completed",
                    htmlContent: r.htmlContent ?? null, sourceNoteIds: r.sourceNoteIds ?? [],
                    errorMessage: r.errorMessage ?? null,
                    createdAt: toDate(r.createdAt) ?? new Date(), updatedAt: toDate(r.updatedAt) ?? new Date(),
                }))).onConflictDoNothing().returning({ id: dailyReports.id });
                insertedCounts.dailyReports = insertedReports.length;
            }

            const tasks = Array.isArray(payload.scheduledTasks) ? payload.scheduledTasks : [];
            if (tasks.length > 0) {
                const insertedTasks = await tx.insert(scheduledTasks).values(tasks.map((t) => ({
                    id: t.id, userId, name: t.name, cronExpression: t.cronExpression,
                    action: t.action, actionParams: t.actionParams ?? {}, enabled: t.enabled ?? true,
                    lastRunAt: toDate(t.lastRunAt), createdAt: toDate(t.createdAt) ?? new Date(),
                    updatedAt: toDate(t.updatedAt) ?? new Date(),
                }))).onConflictDoNothing().returning({ id: scheduledTasks.id });
                insertedCounts.scheduledTasks = insertedTasks.length;
            }

            const history = payload.ascanHistory ?? {};
            const historyTables: Array<[any, any[]]> = [
                [ascanPapers, history.papers ?? []],
                [ascanGithubRepos, history.githubRepos ?? []],
                [ascanOfficialItems, history.officialItems ?? []],
                [ascanBlogPosts, history.blogPosts ?? []],
                [ascanConferencePapers, history.conferencePapers ?? []],
                [ascanWechatArticles, history.wechatArticles ?? []],
            ];
            for (const [table, rows] of historyTables) {
                if (Array.isArray(rows) && rows.length > 0) {
                    // Let the destination database allocate serial ids; natural unique keys
                    // provide deduplication and its sequences remain valid after import.
                    const withoutIds = rows.map(normalizeHistoryRow);
                    await tx.insert(table).values(withoutIds).onConflictDoNothing();
                }
            }

            return {
                notes: insertedCounts.notes,
                tags: insertedCounts.tags,
                noteTags: insertedCounts.noteTags,
                chatSessions: insertedCounts.chatSessions,
                chatMessages: insertedCounts.chatMessages,
                dailyReports: insertedCounts.dailyReports,
                scheduledTasks: insertedCounts.scheduledTasks,
                images: imagesRestored,
            };
        });

        // Restore NewSee / WeChat pipeline config (lives in ascan/.env). sanitizeConfigUpdates
        // drops unknown keys and "***" placeholders, so a secrets-stripped export simply leaves
        // existing sensitive values untouched on the target device.
        let configRestored = false;
        if (payload.ascanConfig && Object.keys(payload.ascanConfig).length > 0) {
            try {
                await updateEffectiveConfig(req.userId, sanitizeConfigUpdates(payload.ascanConfig));
                configRestored = true;
            } catch (err) {
                console.warn("[import] ascan config restore failed:", err);
            }
        }

        // Merge user settings (LLM provider/baseUrl/model/apiKey, etc.) into the current user.
        // Deep-merge so an import without secrets doesn't clobber an existing apiKey.
        let settingsRestored = false;
        if (payload.user?.settings) {
            try {
                const current = await db.query.users.findFirst({ where: eq(users.id, userId) });
                if (current) {
                    const merged = deepMergeSettings(current.settings ?? {}, payload.user.settings);
                    await db.update(users).set({ settings: merged, updatedAt: new Date() }).where(eq(users.id, userId));
                    settingsRestored = true;
                }
            } catch (err) {
                console.warn("[import] user settings restore failed:", err);
            }
        }

        // Re-derive embeddings asynchronously for imported notes that lack one. Fire-and-forget
        // so the API returns immediately; only runs when an embedding-capable LLM is configured.
        const chatConfig = await getUserChatConfig(userId).catch(() => null);
        if (chatConfig && isLLMConfigured(chatConfig)) {
            reindexImportedNotes(payload.notes.map((n) => n.id), chatConfig).catch((err) => {
                console.error("[import] background reindex failed:", err);
            });
        }
        if (counts.scheduledTasks > 0) await restoreTasks();

        res.json({ ok: true, imported: counts, configRestored, settingsRestored });
    } catch (err) {
        removeRestoredFiles(restoredFiles);
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
                const embedding = await generateEmbedding(note.content, _llmConfig);
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
