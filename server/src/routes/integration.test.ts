import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import jwt from "jsonwebtoken";
import { eq, and, inArray } from "drizzle-orm";

import { integrationEnabled, getTestDb, closeTestDb, resetTables } from "../test/db.js";

// Pin UPLOAD_DIR to a per-suite temp directory so test runs never touch real uploads/.
// Use vi.hoisted because vi.mock is hoisted above imports.
const { tmpUploadDir } = vi.hoisted(() => {
  const fsh = require("node:fs");
  const ph = require("node:path");
  const osh = require("node:os");
  const dir = fsh.mkdtempSync(ph.join(osh.tmpdir(), "noteone-it-"));
  return { tmpUploadDir: dir as string };
});
vi.mock("./uploads.js", async () => {
  const actual = await vi.importActual<any>("./uploads.js");
  return { ...actual, UPLOAD_DIR: tmpUploadDir };
});
// upload-cleanup.ts and export.ts also import UPLOAD_DIR from "./uploads.js"; mocking the
// route module above is enough since both consumers resolve through that re-export.

import { db } from "../db/client.js";
import { config } from "../config.js";
import { users, notes, tags, noteTags, chatSessions, chatMessages } from "../db/schema.js";
import { accountRouter } from "./account.js";
import { exportRouter } from "./export.js";
import { tagsRouter } from "./tags.js";
import { notesRouter } from "./notes.js";
import { requireAuth } from "../middleware/auth.js";
import { mcpCreateNote } from "../mcp.js";

// We can't use the real `pipeline.processNote` (calls LLM); stub at import boundary
// by overriding the export via require cache trick. Simpler: in these tests we just
// observe the as-inserted state — the pipeline kicks off async and we don't await it.

function makeAuthHeader(userId: string): string {
  const token = jwt.sign({ userId }, config.jwtSecret, { expiresIn: "1h" });
  return `Bearer ${token}`;
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/notes", requireAuth, notesRouter);
  app.use("/api/tags", requireAuth, tagsRouter);
  app.use("/api/account", requireAuth, accountRouter);
  app.use("/api/export", requireAuth, exportRouter);
  return app;
}

const VALID_PNG = "550e8400-e29b-41d4-a716-446655440000.png";

async function touchUpload(name: string) {
  await fs.writeFile(path.join(tmpUploadDir, name), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
}

describe.skipIf(!integrationEnabled)("integration: tags multi-tenant + account + export", () => {
  beforeAll(async () => {
    // Trigger the lazy DB connection to mirror what the app uses (same DATABASE_URL).
    getTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
    await fs.rm(tmpUploadDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetTables();
    await fs.rm(tmpUploadDir, { recursive: true, force: true });
    await fs.mkdir(tmpUploadDir, { recursive: true });
  });

  describe("tags tenant isolation", () => {
    it("user B cannot list or delete user A's tag", async () => {
      const [a] = await db.insert(users).values({ appleId: "it-a", name: "A" }).returning();
      const [b] = await db.insert(users).values({ appleId: "it-b", name: "B" }).returning();

      // A creates a tag.
      const create = await request(buildApp())
        .post("/api/tags")
        .set("Authorization", makeAuthHeader(a.id))
        .send({ name: "AI", dimension: "topic" });
      expect(create.status).toBe(201);
      const tagId = create.body.tag.id;

      // B's GET must not see A's tag.
      const list = await request(buildApp())
        .get("/api/tags")
        .set("Authorization", makeAuthHeader(b.id));
      expect(list.status).toBe(200);
      expect(list.body.tags.find((t: any) => t.id === tagId)).toBeUndefined();

      // B's DELETE must 404; A's tag must still be there.
      const del = await request(buildApp())
        .delete(`/api/tags/${tagId}`)
        .set("Authorization", makeAuthHeader(b.id));
      expect(del.status).toBe(404);

      const stillThere = await db.query.tags.findFirst({ where: eq(tags.id, tagId) });
      expect(stillThere).toBeDefined();
    });
  });

  describe("DELETE /api/account", () => {
    it("hard-deletes the user, cascades all rows, and removes uploaded files", async () => {
      const [a] = await db.insert(users).values({ appleId: "it-acct-a", name: "A" }).returning();
      const [b] = await db.insert(users).values({ appleId: "it-acct-b", name: "B" }).returning();

      // A's data: a note (image), a tag, a chat session+message; image file on disk.
      await touchUpload(VALID_PNG);
      const [aNote] = await db.insert(notes).values({
        userId: a.id, content: "hi", contentType: "image",
        sourceUrl: `/uploads/${VALID_PNG}`,
        status: "active",
      }).returning();
      const [aTag] = await db.insert(tags).values({
        userId: a.id, name: "AI", dimension: "topic",
      }).returning();
      await db.insert(noteTags).values({ noteId: aNote.id, tagId: aTag.id });
      const [aSess] = await db.insert(chatSessions).values({ userId: a.id, title: "x" }).returning();
      await db.insert(chatMessages).values({ sessionId: aSess.id, role: "user", content: "hello" });

      // B's data: should remain intact.
      const [bTag] = await db.insert(tags).values({
        userId: b.id, name: "Untouched", dimension: "topic",
      }).returning();

      const res = await request(buildApp())
        .delete("/api/account")
        .set("Authorization", makeAuthHeader(a.id));
      expect(res.status).toBe(204);

      // A is gone; cascade should have removed every dependent row.
      expect(await db.query.users.findFirst({ where: eq(users.id, a.id) })).toBeUndefined();
      expect(await db.query.notes.findFirst({ where: eq(notes.userId, a.id) })).toBeUndefined();
      expect(await db.query.tags.findFirst({ where: eq(tags.userId, a.id) })).toBeUndefined();
      const aNoteTags = await db.select().from(noteTags).where(eq(noteTags.noteId, aNote.id));
      expect(aNoteTags).toHaveLength(0);
      expect(await db.query.chatSessions.findFirst({ where: eq(chatSessions.userId, a.id) })).toBeUndefined();
      const aMsgs = await db.select().from(chatMessages).where(eq(chatMessages.sessionId, aSess.id));
      expect(aMsgs).toHaveLength(0);

      // The local image file should be gone.
      await expect(fs.stat(path.join(tmpUploadDir, VALID_PNG))).rejects.toThrow();

      // B's tag is still there.
      expect(await db.query.tags.findFirst({ where: eq(tags.id, bTag.id) })).toBeDefined();
    });
  });

  describe("GET /api/export", () => {
    it("includes only the caller's notes/tags/chats and uploads, with apiKey stripped", async () => {
      const [a] = await db.insert(users).values({
        appleId: "it-exp-a", name: "A",
        settings: { llm: { apiKey: "SHOULD-NOT-LEAK", baseUrl: "https://x" } },
      }).returning();
      const [b] = await db.insert(users).values({ appleId: "it-exp-b", name: "B" }).returning();

      await touchUpload(VALID_PNG);
      const [aNote] = await db.insert(notes).values({
        userId: a.id, content: "alpha", contentType: "image",
        sourceUrl: `/uploads/${VALID_PNG}`,
        status: "active",
      }).returning();
      const [bNote] = await db.insert(notes).values({
        userId: b.id, content: "bravo", contentType: "text", status: "active",
      }).returning();

      const res = await request(buildApp())
        .get("/api/export")
        .set("Authorization", makeAuthHeader(a.id))
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on("data", (c: Buffer) => chunks.push(c));
          response.on("end", () => callback(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/zip/);
      const body = res.body as Buffer;
      expect(body.length).toBeGreaterThan(0);
      // ZIP magic number "PK\x03\x04"
      expect(body.slice(0, 4).toString("hex")).toBe("504b0304");

      // Lightweight check: the JSON entry contains alpha but never bravo, and apiKey is gone.
      const text = body.toString("latin1");
      expect(text).toContain("noteone-export.json");
      expect(text).toContain(`uploads/${VALID_PNG}`);
      expect(text).not.toContain("SHOULD-NOT-LEAK");
      // Note titles aren't unique per user but content strings are good enough here.
      expect(text).toContain("alpha");
      expect(text).not.toContain("bravo");
    });
  });

  describe("mcpCreateNote with source_app", () => {
    it("creates a note and synchronously attaches #prompt + #{source_app} format tags", async () => {
      const [u] = await db.insert(users).values({ appleId: "it-mcp-a", name: "P" }).returning();

      const { id } = await mcpCreateNote(u.id, {
        content: "你是一个资深的 Swift 工程师…",
        source_app: "Claude",
      });

      // Note row should have sourceApp + contentType=text.
      const note = await db.query.notes.findFirst({ where: eq(notes.id, id) });
      expect(note).toBeDefined();
      expect(note?.contentType).toBe("text");
      expect(note?.sourceApp).toBe("Claude");

      // Two format-dimension tags must be attached, scoped to this user.
      const attached = await db.select({ name: tags.name, dimension: tags.dimension })
        .from(noteTags)
        .innerJoin(tags, eq(noteTags.tagId, tags.id))
        .where(eq(noteTags.noteId, id));
      const names = attached.map((t) => t.name).sort();
      expect(names).toEqual(["claude", "prompt"]);
      expect(attached.every((t) => t.dimension === "format")).toBe(true);
    });

    it("creates a regular text note when source_app is omitted (no extra tags)", async () => {
      const [u] = await db.insert(users).values({ appleId: "it-mcp-b", name: "Q" }).returning();

      const { id } = await mcpCreateNote(u.id, { content: "plain note" });
      const attached = await db.select({ name: tags.name })
        .from(noteTags)
        .innerJoin(tags, eq(noteTags.tagId, tags.id))
        .where(eq(noteTags.noteId, id));
      // No synchronous format tags attached (pipeline AI tagging is async and not awaited here).
      expect(attached.filter((t) => t.name === "prompt")).toHaveLength(0);
    });
  });
});
