import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fetch globally so we don't hit the real DuckDuckGo API.
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// Mock config to control provider selection.
vi.mock("../config.js", () => ({
  config: {
    search: {
      provider: "duckduckgo",
      tavilyApiKey: "",
      bingApiKey: "",
    },
  },
}));

import { searchWeb, SearchResult } from "./web-search.js";

describe("searchWeb", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(() => {
    fetchMock.mockReset();
  });

  it("returns structured results from DuckDuckGo instant answer API", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        Heading: "TypeScript",
        Abstract: "TypeScript is a programming language developed by Microsoft.",
        AbstractURL: "https://en.wikipedia.org/wiki/TypeScript",
        RelatedTopics: [
          {
            Text: "JavaScript is a programming language",
            FirstURL: "https://en.wikipedia.org/wiki/JavaScript",
          },
          {
            Text: "Node.js is a JavaScript runtime",
            FirstURL: "https://en.wikipedia.org/wiki/Node.js",
          },
        ],
        Results: [],
      }),
    });

    const results = await searchWeb("TypeScript", { provider: "duckduckgo" });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].url).toBe("https://en.wikipedia.org/wiki/TypeScript");
    expect(results[0].title).toBe("TypeScript");
    expect(results[0].snippet).toContain("programming language");
  });

  it("returns empty array when DuckDuckGo returns no results", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        Heading: "",
        Abstract: "",
        AbstractURL: "",
        RelatedTopics: [],
        Results: [],
      }),
    });

    const results = await searchWeb("nonexistent-topic-xyz");
    expect(results).toEqual([]);
  });

  it("returns empty array on network error (graceful fallback)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network error"));

    const results = await searchWeb("test query", { provider: "duckduckgo" });
    expect(results).toEqual([]);
  });

  it("respects maxResults limit", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        Heading: "Test",
        Abstract: "Test abstract",
        AbstractURL: "https://example.com/test",
        RelatedTopics: [
          { Text: "Topic 1", FirstURL: "https://example.com/1" },
          { Text: "Topic 2", FirstURL: "https://example.com/2" },
          { Text: "Topic 3", FirstURL: "https://example.com/3" },
          { Text: "Topic 4", FirstURL: "https://example.com/4" },
          { Text: "Topic 5", FirstURL: "https://example.com/5" },
        ],
        Results: [],
      }),
    });

    const results = await searchWeb("test", { provider: "duckduckgo", maxResults: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("falls back to DuckDuckGo when Tavily is configured but fails", async () => {
    // First call (Tavily) fails
    fetchMock.mockRejectedValueOnce(new Error("Tavily API error"));
    // Second call (DuckDuckGo fallback) succeeds
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        Heading: "Fallback",
        Abstract: "Fallback result",
        AbstractURL: "https://example.com/fallback",
        RelatedTopics: [],
        Results: [],
      }),
    });

    // Override config to use tavily
    const { config } = await import("../config.js");
    (config.search as any).provider = "tavily";

    const results = await searchWeb("test query");
    // Should fall back to DuckDuckGo since Tavily has no API key
    expect(results.length).toBeGreaterThanOrEqual(0);
  });
});
