import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the LLM and DB so we can poke `tagNote` without any external dependency.
// vi.mock factories are hoisted; use vi.hoisted for any shared state we want to reach.
const llmHoist = vi.hoisted(() => ({ chatCompletion: vi.fn() }));
vi.mock("./llm.js", () => ({ chatCompletion: llmHoist.chatCompletion }));
const chatCompletionMock = llmHoist.chatCompletion;

// Minimal in-memory shim for drizzle calls used by tagging.ts.
const stubDb = vi.hoisted(() => {
    const inserted: any[] = [];
    return {
        inserted,
        db: {
            query: { tags: { findFirst: vi.fn(async () => undefined) } },
            insert: vi.fn(() => ({
                values: vi.fn((row: any) => ({
                    returning: vi.fn(async () => [{ id: "tag-id-" + row.name, ...row }]),
                    onConflictDoNothing: vi.fn(async () => {
                        inserted.push(row);
                    }),
                })),
            })),
        },
    };
});
vi.mock("../db/client.js", () => ({ db: stubDb.db }));

import { tagNote } from "./tagging.js";

describe("tagNote — model output validation", () => {
    beforeEach(() => {
        chatCompletionMock.mockReset();
        stubDb.inserted.length = 0;
        (stubDb.db.query.tags.findFirst as any).mockReset();
        (stubDb.db.query.tags.findFirst as any).mockResolvedValue(undefined);
    });

    it("returns [] when model emits non-JSON", async () => {
        chatCompletionMock.mockResolvedValueOnce("oh hi I'm not json");
        const result = await tagNote("note1", "user1", "...", "text");
        expect(result).toEqual([]);
    });

    it("strips ```json fences before parsing", async () => {
        chatCompletionMock.mockResolvedValueOnce(
            "```json\n[{\"dimension\":\"format\",\"name\":\"\u6587\u672c\",\"confidence\":0.9}]\n```",
        );
        const result = await tagNote("note1", "user1", "x", "text");
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ dimension: "format", name: "\u6587\u672c" });
    });

    it("filters out items with invalid dimension", async () => {
        chatCompletionMock.mockResolvedValueOnce(JSON.stringify([
            { dimension: "format", name: "\u6587\u672c", confidence: 0.9 },
            { dimension: "evil", name: "drop tables", confidence: 1 },
            { dimension: "topic", name: "\u79d1\u6280", confidence: 0.7 },
        ]));
        const result = await tagNote("note1", "user1", "x", "text");
        expect(result).toHaveLength(2);
        expect(result.every((t) => ["format", "topic"].includes(t.dimension))).toBe(true);
    });

    it("filters out items with empty name", async () => {
        chatCompletionMock.mockResolvedValueOnce(JSON.stringify([
            { dimension: "format", name: "  ", confidence: 0.9 },
            { dimension: "topic", name: "", confidence: 0.5 },
            { dimension: "domain", name: "AI", confidence: 0.8 },
        ]));
        const result = await tagNote("note1", "user1", "x", "text");
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("AI");
    });

    it("returns [] when model outputs a non-array", async () => {
        chatCompletionMock.mockResolvedValueOnce(JSON.stringify({ not: "an array" }));
        const result = await tagNote("note1", "user1", "x", "text");
        expect(result).toEqual([]);
    });
});
