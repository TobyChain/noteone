import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  generateEmbedding: vi.fn(),
  getUserChatConfig: vi.fn(),
}));
vi.mock("../db/client.js", () => ({ db: { execute: mocks.execute }, rowsOf: (v: any) => v }));
vi.mock("./llm.js", () => ({
  generateEmbedding: mocks.generateEmbedding,
  isLLMConfigured: (cfg: any) => Boolean(cfg.apiKey && cfg.baseUrl && cfg.model),
}));
vi.mock("./user-config.js", () => ({ getUserChatConfig: mocks.getUserChatConfig }));

import { searchNotes } from "./note-search.js";

describe("searchNotes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses text search when no LLM is configured", async () => {
    mocks.getUserChatConfig.mockResolvedValue({ apiKey: "", baseUrl: "", model: "" });
    mocks.execute.mockResolvedValue([{ id: "n1", similarity: null }]);
    const result = await searchNotes("user-1", "literal % query");
    expect(result.mode).toBe("text");
    expect(result.results).toHaveLength(1);
    expect(mocks.generateEmbedding).not.toHaveBeenCalled();
  });

  it("falls back to text when embedding generation fails", async () => {
    mocks.getUserChatConfig.mockResolvedValue({ apiKey: "key", baseUrl: "https://llm", model: "m" });
    mocks.generateEmbedding.mockRejectedValue(new Error("unsupported"));
    mocks.execute.mockResolvedValue([{ id: "n1", similarity: null }]);
    const result = await searchNotes("user-1", "query");
    expect(result.mode).toBe("text");
    expect(result.results).toHaveLength(1);
  });
});
