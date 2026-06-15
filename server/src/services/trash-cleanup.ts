import { db } from "../db/client.js";
import { notes } from "../db/schema.js";
import { eq, and, lt } from "drizzle-orm";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

async function cleanupTrash() {
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);
  const deleted = await db.delete(notes)
    .where(and(eq(notes.status, "trashed"), lt(notes.deletedAt, cutoff)))
    .returning({ id: notes.id });

  if (deleted.length > 0) {
    console.log(`[trash-cleanup] Permanently deleted ${deleted.length} notes older than 30 days`);
  }
}

export function startTrashCleanup() {
  cleanupTrash().catch(console.error);
  setInterval(() => cleanupTrash().catch(console.error), ONE_HOUR_MS);
}
