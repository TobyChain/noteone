import { Router } from "express";
import { db } from "../db/client.js";
import {
    users, notes, scheduledTasks, wechatSessions, ascanPapers, ascanGithubRepos, ascanOfficialItems,
    ascanBlogPosts, ascanConferencePapers, ascanWechatArticles,
} from "../db/schema.js";
import { eq, and, inArray } from "drizzle-orm";
import { AuthRequest } from "../middleware/auth.js";
import { removeUploadedImagesForNotes } from "../services/upload-cleanup.js";
import { stopJobs } from "../services/scheduler.js";
import { ASCAN_DOCS, ASCAN_LOGS, ASCAN_ENV } from "../services/ascan/config.js";
import { UPLOAD_DIR } from "./uploads.js";
import fs from "node:fs/promises";
import path from "node:path";

const router = Router();

// DELETE /api/account
// Clear all data owned by this installation's internal local user. The route
// name is retained for API compatibility; the app presents this as "Clear
// Local Data", not as account deletion.
//
// Cascade:
//   users (this row) → notes / tags / chat_sessions all use ON DELETE CASCADE,
//   note_tags / chat_messages cascade from notes / chat_sessions in turn.
// We additionally walk image/mixed notes and unlink their uploaded files so the local
// filesystem doesn't accumulate orphans.
router.delete("/", async (req: AuthRequest, res) => {
    const userId = req.userId!;

    // Snapshot file references BEFORE deleting the user — once cascade fires the rows are gone.
    const userImageNotes = await db.select({
        id: notes.id,
        contentType: notes.contentType,
        sourceUrl: notes.sourceUrl,
    }).from(notes)
        .where(and(eq(notes.userId, userId), inArray(notes.contentType, ["image", "mixed"])));
    const userTasks = await db.select({ id: scheduledTasks.id }).from(scheduledTasks)
        .where(eq(scheduledTasks.userId, userId));

    const result = await db.transaction(async (tx) => {
        const removed = await tx.delete(users).where(eq(users.id, userId)).returning({ id: users.id });
        if (removed.length === 0) return { removed, isLastUser: false };
        const remainingUser = await tx.query.users.findFirst({ columns: { id: true } });
        const isLastUser = !remainingUser;
        // NewSee history and WeChat sessions are installation-scoped legacy tables. NoteOne is
        // single-user, so clear them when the installation has no other owner.
        if (isLastUser) {
            await tx.delete(ascanWechatArticles);
            await tx.delete(ascanConferencePapers);
            await tx.delete(ascanBlogPosts);
            await tx.delete(ascanOfficialItems);
            await tx.delete(ascanGithubRepos);
            await tx.delete(ascanPapers);
            await tx.delete(wechatSessions);
        }
        return { removed, isLastUser };
    });
    if (result.removed.length === 0) {
        // Token was valid but the user row is already gone — treat as idempotent success.
        res.status(204).end();
        return;
    }
    stopJobs(userTasks.map((task) => task.id));
    await removeUploadedImagesForNotes(userImageNotes);

    if (result.isLastUser) {
        for (const dir of [ASCAN_DOCS, ASCAN_LOGS]) {
            const entries = await fs.readdir(dir).catch(() => []);
            await Promise.all(entries.map((name) =>
                fs.rm(path.join(dir, name), { recursive: true, force: true })
                    .catch((error) => console.error("[local-data] failed to remove", path.join(dir, name), error)),
            ));
        }
        await fs.rm(ASCAN_ENV, { force: true }).catch(() => {});
        const orphanUploads = await fs.readdir(UPLOAD_DIR).catch(() => []);
        await Promise.all(orphanUploads.map((name) =>
            fs.rm(path.join(UPLOAD_DIR, name), { force: true })
                .catch((error) => console.error("[local-data] failed to remove", path.join(UPLOAD_DIR, name), error)),
        ));
    }

    console.log(`[local-data] cleared owner ${userId}, removed ${userImageNotes.length} image refs`);
    res.status(204).end();
});

export { router as accountRouter };
