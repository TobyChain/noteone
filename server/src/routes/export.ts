import { Router } from "express";
import archiver from "archiver";
import path from "node:path";
import fs from "node:fs";
import { db } from "../db/client.js";
import {
    users, notes, tags, noteTags, chatSessions, chatMessages, dailyReports, scheduledTasks,
    newlorePapers, newloreGithubRepos, newloreOfficialItems, newloreBlogPosts,
    newloreConferencePapers, newloreWechatArticles, farviewSnapshots,
} from "../db/schema.js";
import { eq, asc, inArray } from "drizzle-orm";
import { AuthRequest } from "../middleware/auth.js";
import { UPLOAD_DIR } from "./uploads.js";
import { getEffectiveConfig, type NewLoreConfig } from "../services/newlore/config.js";
import { getReportStorageRoots } from "../services/newlore/reports.js";

const router = Router();

const SCHEMA_VERSION = "1.3";
const ALLOWED_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "heic", "heif"]);
const UUID_BASENAME = /^[0-9a-fA-F-]{32,36}\.[a-z0-9]{1,8}$/;

/// Keys that carry real secrets (not just preferences). Omitted from the export unless the
/// caller explicitly opts in with ?secrets=1 (personal cross-device transfer).
const SENSITIVE_NEWLORE_KEYS = new Set([
    "llm_api_key", "github_token", "semantic_scholar_api_key", "wechat_auth_key",
]);

function stripNewLoreSecrets(config: NewLoreConfig, includeSecrets: boolean): Partial<NewLoreConfig> {
    if (includeSecrets) return { ...config };
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(config)) {
        if (SENSITIVE_NEWLORE_KEYS.has(k)) continue;
        out[k] = v;
    }
    return out as Partial<NewLoreConfig>;
}

function uploadBasenameFromUrl(sourceUrl: string | null | undefined): string | null {
    if (!sourceUrl) return null;
    let pathname: string;
    try {
        pathname = sourceUrl.startsWith("/") ? sourceUrl : new URL(sourceUrl).pathname;
    } catch {
        return null;
    }
    if (!pathname.startsWith("/uploads/")) return null;
    const basename = path.basename(pathname);
    if (!UUID_BASENAME.test(basename)) return null;
    const ext = basename.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXT.has(ext)) return null;
    return basename;
}

// GET /api/export
// Streams a zip with the caller's notes / tags / chat sessions as JSON, plus a copy of every
// uploaded image referenced by their image/mixed notes. Sensitive fields (apiKey) are stripped
// from the user record. Designed for App Store / GDPR data-portability requirements.
router.get("/", async (req: AuthRequest, res) => {
    const userId = req.userId!;
    const includeSecrets = req.query.secrets === "1" || req.query.secrets === "true";

    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
    }
    // Never include the LLM apiKey unless the caller explicitly opted in with ?secrets=1.
    const userSettings = (user.settings ?? {}) as any;
    const safeSettings = { ...userSettings };
    if (safeSettings.llm) {
        const { apiKey: _omit, ...rest } = safeSettings.llm;
        safeSettings.llm = rest;
        if (includeSecrets && userSettings.llm?.apiKey) {
            safeSettings.llm.apiKey = userSettings.llm.apiKey;
        }
    }
    const safeUser = {
        id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl,
        settings: safeSettings,
        createdAt: user.createdAt, updatedAt: user.updatedAt,
    };

    // NewLore / WeChat pipeline config (lives in newlore/.env, not the DB). Strip secrets
    // unless opted in so a default export never leaks tokens.
    const newloreConfig = stripNewLoreSecrets(await getEffectiveConfig(req.userId), includeSecrets);

    const userNotes = await db.query.notes.findMany({
        where: eq(notes.userId, userId),
        orderBy: [asc(notes.createdAt)],
    });
    const userTags = await db.query.tags.findMany({
        where: eq(tags.userId, userId),
        orderBy: [asc(tags.createdAt)],
    });
    const noteIdList = userNotes.map((n) => n.id);
    const links = noteIdList.length === 0 ? [] : await db.select({
        noteId: noteTags.noteId,
        tagId: noteTags.tagId,
        confidence: noteTags.confidence,
        isManual: noteTags.isManual,
    }).from(noteTags).where(inArray(noteTags.noteId, noteIdList));

    const sessions = await db.query.chatSessions.findMany({
        where: eq(chatSessions.userId, userId),
        orderBy: [asc(chatSessions.createdAt)],
    });
    const sessionIds = sessions.map((s) => s.id);
    const messages = sessionIds.length === 0 ? [] : await db.query.chatMessages.findMany({
        where: inArray(chatMessages.sessionId, sessionIds),
        orderBy: [asc(chatMessages.createdAt)],
    });
    const reports = await db.query.dailyReports.findMany({
        where: eq(dailyReports.userId, userId),
        orderBy: [asc(dailyReports.createdAt)],
    });
    const tasks = await db.query.scheduledTasks.findMany({
        where: eq(scheduledTasks.userId, userId),
        orderBy: [asc(scheduledTasks.createdAt)],
    });
    const [papers, githubRepos, officialItems, blogPosts, conferencePapers, wechatArticles, farview] = await Promise.all([
        db.select().from(newlorePapers), db.select().from(newloreGithubRepos),
        db.select().from(newloreOfficialItems), db.select().from(newloreBlogPosts),
        db.select().from(newloreConferencePapers), db.select().from(newloreWechatArticles),
        db.select().from(farviewSnapshots),
    ]);

    const exportPayload = {
        schemaVersion: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        includeSecrets,
        user: safeUser,
        newloreConfig,
        notes: userNotes.map((n) => ({
            id: n.id, contentType: n.contentType, title: n.title, content: n.content,
            sourceUrl: n.sourceUrl, sourceApp: n.sourceApp, author: n.author, authorOrg: n.authorOrg,
            aiSummary: n.aiSummary, status: n.status,
            // Note: embedding is intentionally omitted (large + opaque + per-provider); users can
            // re-derive it after re-import. rawContent is kept for archival fidelity.
            rawContent: n.rawContent,
            deletedAt: n.deletedAt, createdAt: n.createdAt, updatedAt: n.updatedAt,
        })),
        tags: userTags.map((t) => ({
            id: t.id, name: t.name, dimension: t.dimension, parentId: t.parentId,
            description: t.description, createdAt: t.createdAt,
        })),
        noteTags: links,
        chatSessions: sessions.map((s) => ({
            id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt,
            messages: messages
                .filter((m) => m.sessionId === s.id)
                .map((m) => ({
                    id: m.id, role: m.role, content: m.content, isSummary: m.isSummary,
                    toolCalls: m.toolCalls, toolCallId: m.toolCallId,
                    createdAt: m.createdAt,
                })),
        })),
        dailyReports: reports,
        scheduledTasks: tasks,
        newloreHistory: { papers, githubRepos, officialItems, blogPosts, conferencePapers, wechatArticles },
        farviewSnapshots: farview,
    };

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    res.status(200);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="noteone-export-${stamp}.zip"`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("warning", (err) => console.warn("[export] archive warning:", err));
    archive.on("error", (err) => {
        console.error("[export] archive error:", err);
        if (!res.headersSent) res.status(500);
        res.end();
    });
    archive.pipe(res);

    archive.append(JSON.stringify(exportPayload, null, 2), { name: "noteone-export.json" });
    archive.append(buildReadme(exportPayload), { name: "README.txt" });
    for (const note of userNotes) {
        if (note.contentType !== "image" && note.contentType !== "mixed") continue;
        const basename = uploadBasenameFromUrl(note.sourceUrl);
        if (!basename) continue;
        const local = path.resolve(UPLOAD_DIR, basename);
        // Refuse anything that escapes UPLOAD_DIR (defense in depth).
        if (path.relative(UPLOAD_DIR, local).startsWith("..")) continue;
        if (!fs.existsSync(local)) continue;
        archive.file(local, { name: `uploads/${basename}` });
    }
    const exportedReportNames = new Set<string>();
    for (const root of getReportStorageRoots()) {
        if (!fs.existsSync(root)) continue;
        for (const name of fs.readdirSync(root)) {
            if (!/^(NewLore|NewSee|Ascan)-\d{8}\.(html|md|summary)$/.test(name)) continue;
            if (exportedReportNames.has(name)) continue;
            exportedReportNames.add(name);
            archive.file(path.join(root, name), { name: `newlore-reports/${name}` });
        }
    }

    await archive.finalize();
});

function buildReadme(payload: { schemaVersion: string; exportedAt: string; includeSecrets?: boolean }): string {
    const hasSecrets = payload.includeSecrets;
    return [
        "NoteOne Data Export",
        "===================",
        "",
        `schemaVersion: ${payload.schemaVersion}`,
        `exportedAt:    ${payload.exportedAt}`,
        `secrets:       ${hasSecrets ? "INCLUDED (LLM apiKey, tokens, WeChat auth key)" : "omitted (re-enter on import)"}`,
        "",
        "Files:",
        "  noteone-export.json    Notes, tags, chats, daily reports, scheduled tasks, user settings, and NewLore/WeChat config.",
        "  uploads/               Image files referenced by your image/mixed notes.",
        "  README.txt             This file.",
        "",
        "Notes:",
        "  - Embeddings are omitted (re-derivable after import).",
        "  - NewLore pipeline + WeChat MP config is included so it migrates to the target device.",
        hasSecrets
            ? "  - This archive CONTAINS secrets (API keys / tokens). Treat it as sensitive."
            : "  - API keys / tokens are stripped; re-enter them on the target device.",
        "  - Soft-deleted notes (status=trashed) are included.",
        "",
    ].join("\n");
}

export { router as exportRouter };
