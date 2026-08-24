import { db } from "../db/client.js";
import { notes } from "../db/schema.js";
import { eq, and, lt } from "drizzle-orm";
import { removeUploadedImagesForNotes } from "./upload-cleanup.js";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

async function cleanupTrash() {
  const start = Date.now();
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);

  const expiring = await db.select({
    id: notes.id,
    contentType: notes.contentType,
    sourceUrl: notes.sourceUrl,
  }).from(notes)
    .where(and(eq(notes.status, "trashed"), lt(notes.deletedAt, cutoff)));

  if (expiring.length === 0) {
    console.log(`[trash-cleanup] run duration=${Date.now() - start}ms deleted=0`);
    return;
  }

  await removeUploadedImagesForNotes(expiring);

  const deleted = await db.delete(notes)
    .where(and(eq(notes.status, "trashed"), lt(notes.deletedAt, cutoff)))
    .returning({ id: notes.id });

  console.log(`[trash-cleanup] run duration=${Date.now() - start}ms deleted=${deleted.length} imagesScanned=${expiring.length}`);
}

export function startTrashCleanup() {
  cleanupTrash().catch(console.error);
  setInterval(() => cleanupTrash().catch(console.error), ONE_HOUR_MS);
}
