import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

// vi.mock factories are hoisted above imports, so we can't reference module-scope consts.
// Use vi.hoisted with inline requires to compute the temp dir before everything else.
const { tmpDir } = vi.hoisted(() => {
    const fsh = require("node:fs");
    const ph = require("node:path");
    const osh = require("node:os");
    const dir = fsh.mkdtempSync(ph.join(osh.tmpdir(), "noteone-upload-cleanup-"));
    return { tmpDir: dir as string };
});
vi.mock("../routes/uploads.js", () => ({
    UPLOAD_DIR: tmpDir,
}));

import { removeUploadedImagesForNotes } from "./upload-cleanup.js";

const VALID = "550e8400-e29b-41d4-a716-446655440000.png";

async function touch(name: string) {
    await fs.writeFile(path.join(tmpDir, name), "");
}

async function exists(name: string): Promise<boolean> {
    try {
        await fs.stat(path.join(tmpDir, name));
        return true;
    } catch {
        return false;
    }
}

describe("removeUploadedImagesForNotes", () => {
    beforeEach(async () => {
        // Reset directory between tests.
        await fs.rm(tmpDir, { recursive: true, force: true });
        await fs.mkdir(tmpDir, { recursive: true });
    });

    it("deletes files for image notes (absolute URL)", async () => {
        await touch(VALID);
        await removeUploadedImagesForNotes([
            { contentType: "image", sourceUrl: `http://localhost:3000/uploads/${VALID}` },
        ]);
        expect(await exists(VALID)).toBe(false);
    });

    it("deletes files for mixed notes (bare path)", async () => {
        await touch(VALID);
        await removeUploadedImagesForNotes([
            { contentType: "mixed", sourceUrl: `/uploads/${VALID}` },
        ]);
        expect(await exists(VALID)).toBe(false);
    });

    it("ignores text/link notes even if sourceUrl points at uploads", async () => {
        await touch(VALID);
        await removeUploadedImagesForNotes([
            { contentType: "text", sourceUrl: `/uploads/${VALID}` },
        ]);
        expect(await exists(VALID)).toBe(true);
    });

    it("ignores external sourceUrls", async () => {
        await touch("other.png");
        await removeUploadedImagesForNotes([
            { contentType: "image", sourceUrl: "https://example.com/photo.jpg" },
        ]);
        expect(await exists("other.png")).toBe(true);
    });

    it("rejects path traversal attempts", async () => {
        // Try to coax it into deleting outside UPLOAD_DIR — must be a no-op.
        const result = await removeUploadedImagesForNotes([
            { contentType: "image", sourceUrl: "/uploads/../../../etc/hosts" },
        ]);
        expect(result.removed).toBe(0);
    });

    it("rejects non-UUID basenames", async () => {
        await touch("evil.png");
        await removeUploadedImagesForNotes([
            { contentType: "image", sourceUrl: "/uploads/evil.png" },
        ]);
        expect(await exists("evil.png")).toBe(true);
    });

    it("tolerates missing files (idempotent cleanup)", async () => {
        const result = await removeUploadedImagesForNotes([
            { contentType: "image", sourceUrl: `/uploads/${VALID}` },
        ]);
        expect(result.removed).toBe(1); // fs.rm with force:true treats missing as success
    });

    it("handles batches", async () => {
        const a = "550e8400-e29b-41d4-a716-aaaaaaaaaaaa.png";
        const b = "550e8400-e29b-41d4-a716-bbbbbbbbbbbb.jpg";
        await touch(a);
        await touch(b);
        const result = await removeUploadedImagesForNotes([
            { contentType: "image", sourceUrl: `/uploads/${a}` },
            { contentType: "mixed", sourceUrl: `/uploads/${b}` },
        ]);
        expect(result.removed).toBe(2);
        expect(await exists(a)).toBe(false);
        expect(await exists(b)).toBe(false);
    });
});
