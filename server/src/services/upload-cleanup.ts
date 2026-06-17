import fs from "node:fs/promises";
import path from "node:path";
import { UPLOAD_DIR } from "../routes/uploads.js";

// Strict allow-list of file extensions we ever serve, mirrors `uploads.ts`.
const ALLOWED_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "bin"]);
const UUID_BASENAME = /^[0-9a-fA-F-]{32,36}\.[a-z0-9]{1,8}$/;

/**
 * Resolve a note's `sourceUrl` to a safe local path inside `UPLOAD_DIR`, or `null` if it
 * doesn't reference an uploaded file (external link, malformed, or path-traversal attempt).
 */
function resolveLocalUploadPath(sourceUrl: string | null | undefined): string | null {
    if (!sourceUrl) return null;
    // Accept both absolute (`http://host/uploads/<file>`) and bare (`/uploads/<file>`) forms.
    let pathname: string;
    try {
        pathname = sourceUrl.startsWith("/")
            ? sourceUrl
            : new URL(sourceUrl).pathname;
    } catch {
        return null;
    }
    if (!pathname.startsWith("/uploads/")) return null;

    const basename = path.basename(pathname);
    // Defense-in-depth against path traversal: the basename must look like our UUID.ext naming.
    if (!UUID_BASENAME.test(basename)) return null;
    const ext = basename.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXT.has(ext)) return null;

    const resolved = path.resolve(UPLOAD_DIR, basename);
    // Must stay within UPLOAD_DIR — refuse anything that escapes after resolution.
    if (path.relative(UPLOAD_DIR, resolved).startsWith("..")) return null;
    return resolved;
}

/**
 * Best-effort delete for the local files referenced by these notes' `sourceUrl`s.
 * Missing files are ignored; other errors are logged but never thrown.
 */
export async function removeUploadedImagesForNotes(
    notes: Array<{ contentType: string; sourceUrl: string | null }>,
): Promise<{ removed: number }> {
    let removed = 0;
    for (const note of notes) {
        if (note.contentType !== "image" && note.contentType !== "mixed") continue;
        const local = resolveLocalUploadPath(note.sourceUrl);
        if (!local) continue;
        try {
            await fs.rm(local, { force: true });
            removed += 1;
        } catch (err) {
            console.error("[upload-cleanup] failed to remove", local, err);
        }
    }
    return { removed };
}
