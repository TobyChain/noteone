import { Router } from "express";
import { db } from "../db/client.js";
import { users, notes } from "../db/schema.js";
import { eq, and, inArray } from "drizzle-orm";
import { AuthRequest } from "../middleware/auth.js";
import { removeUploadedImagesForNotes } from "../services/upload-cleanup.js";

const router = Router();

// DELETE /api/account
// Hard-delete the authenticated user and all of their data. Apple App Review 5.1.1(v) and
// GDPR both require an in-app "delete my account" path; this is intentionally irrevocable
// so we don't leave a "soft" delete that would silently fail compliance audits.
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

    await removeUploadedImagesForNotes(userImageNotes);

    const deleted = await db.delete(users).where(eq(users.id, userId)).returning({ id: users.id });
    if (deleted.length === 0) {
        // Token was valid but the user row is already gone — treat as idempotent success.
        res.status(204).end();
        return;
    }

    console.log(`[account] hard-deleted user ${userId}, removed ${userImageNotes.length} image refs`);
    res.status(204).end();
});

export { router as accountRouter };
