import { describe, it, expect, vi, beforeEach } from "vitest";

// We stub the DB so this stays a pure unit test. The shim records every insert into
// `inserted.tags` / `inserted.noteTags` so assertions can verify normalization and dedup.
const stubDb = vi.hoisted(() => {
    const tags: any[] = [];
    const noteTags: any[] = [];

    // findFirst lookups go through this shared state, simulating uniqueness by name + dimension.
    let lastFindQuery: { userId?: string; name?: string; dimension?: string } = {};

    return {
        inserted: { tags, noteTags },
        lastFindQuery,
        db: {
            query: {
                tags: {
                    findFirst: vi.fn(async () => {
                        const q = lastFindQuery;
                        return tags.find(
                            (t) => t.userId === q.userId && t.name === q.name && t.dimension === q.dimension,
                        );
                    }),
                },
            },
            insert: vi.fn((table: any) => ({
                values: vi.fn((row: any) => {
                    // We don't know which table without inspecting; tagging stores into `tags`,
                    // noteTags into `noteTags`. Discriminate by row shape (tags have `dimension`).
                    if ("dimension" in row) {
                        return {
                            returning: vi.fn(async () => {
                                const created = { id: `tag-${tags.length}`, ...row };
                                tags.push(created);
                                return [created];
                            }),
                        };
                    }
                    return {
                        onConflictDoNothing: vi.fn(async () => {
                            const exists = noteTags.find(
                                (n) => n.noteId === row.noteId && n.tagId === row.tagId,
                            );
                            if (!exists) noteTags.push(row);
                        }),
                    };
                }),
            })),
        },
        // Allow tests to set the expected next find query
        setNextFind(q: { userId?: string; name?: string; dimension?: string }) {
            Object.assign(lastFindQuery, q);
        },
    };
});

// Intercept drizzle's `eq` to capture the values used in the next findFirst lookup.
vi.mock("drizzle-orm", async () => {
    const actual = await vi.importActual<any>("drizzle-orm");
    return {
        ...actual,
        eq: (col: any, value: any) => {
            // Column object has a `.name` property in drizzle-orm; we use it to route the value.
            const colName: string = col?.name ?? "";
            if (colName === "user_id") stubDb.setNextFind({ userId: value });
            if (colName === "name") stubDb.setNextFind({ name: value });
            if (colName === "dimension") stubDb.setNextFind({ dimension: value });
            return { __eq: true, col, value };
        },
        and: (...args: any[]) => ({ __and: args }),
    };
});

vi.mock("../db/client.js", () => ({ db: stubDb.db }));

import { attachPromptTags } from "./prompt-tagging.js";

describe("attachPromptTags", () => {
    beforeEach(() => {
        stubDb.inserted.tags.length = 0;
        stubDb.inserted.noteTags.length = 0;
        (stubDb.db.query.tags.findFirst as any).mockClear();
    });

    it("attaches #prompt + #claude (lowercased) for source_app=Claude", async () => {
        const result = await attachPromptTags("note-1", "user-1", "Claude");
        expect(result.tagged).toEqual(["prompt", "claude"]);
        expect(stubDb.inserted.tags.map((t) => t.name).sort()).toEqual(["claude", "prompt"]);
        expect(stubDb.inserted.noteTags).toHaveLength(2);
        expect(stubDb.inserted.tags.every((t) => t.dimension === "format")).toBe(true);
        expect(stubDb.inserted.tags.every((t) => t.userId === "user-1")).toBe(true);
    });

    it("normalizes whitespace and special chars in source_app", async () => {
        const result = await attachPromptTags("note-2", "user-1", "  GPT-4o  Mini! ");
        // spaces -> '-', '!' stripped, lowercased
        expect(result.tagged).toEqual(["prompt", "gpt-4o-mini"]);
    });

    it("attaches only #prompt when source_app is empty/whitespace", async () => {
        const result = await attachPromptTags("note-3", "user-1", "   ");
        expect(result.tagged).toEqual(["prompt"]);
    });

    it("attaches only #prompt when source_app normalizes to 'prompt' (no duplicate)", async () => {
        const result = await attachPromptTags("note-4", "user-1", "Prompt");
        expect(result.tagged).toEqual(["prompt"]);
    });

    it("is idempotent on repeated calls (no duplicate note_tags)", async () => {
        await attachPromptTags("note-5", "user-1", "Cursor");
        await attachPromptTags("note-5", "user-1", "Cursor");
        expect(stubDb.inserted.noteTags).toHaveLength(2); // prompt + cursor, not 4
        // tags table should also dedup
        expect(stubDb.inserted.tags.filter((t) => t.name === "cursor")).toHaveLength(1);
    });

    it("truncates long source_app to <=32 chars", async () => {
        const long = "Very-Long-AI-Client-Name-" + "x".repeat(50);
        const result = await attachPromptTags("note-6", "user-1", long);
        expect(result.tagged[1].length).toBeLessThanOrEqual(32);
    });

    it("attaches only #prompt when source_app is null/undefined", async () => {
        const a = await attachPromptTags("note-7", "user-1", null);
        expect(a.tagged).toEqual(["prompt"]);
        const b = await attachPromptTags("note-8", "user-1", undefined);
        expect(b.tagged).toEqual(["prompt"]);
    });
});
