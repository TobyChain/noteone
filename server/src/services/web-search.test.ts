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

import { searchWeb } from "./web-search.js";

describe("searchWeb", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    return import("../config.js").then(({ config }) => {
      (config.search as any).provider = "duckduckgo";
      (config.search as any).tavilyApiKey = "";
    });
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

    const response = await searchWeb("TypeScript", { provider: "duckduckgo" });

    expect(response.provider).toBe("duckduckgo");
    expect(response.results.length).toBeGreaterThanOrEqual(1);
    expect(response.results[0].url).toBe("https://en.wikipedia.org/wiki/TypeScript");
    expect(response.results[0].title).toBe("TypeScript");
    expect(response.results[0].snippet).toContain("programming language");
  });

  it("returns an empty result set when DuckDuckGo returns no results", async () => {
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
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "<html><body></body></html>",
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "<html><body></body></html>",
    });

    const response = await searchWeb("nonexistent-topic-xyz");
    expect(response.results).toEqual([]);
  });

  it("falls back to DuckDuckGo HTML results for current-topic queries", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ Heading: "", Abstract: "", AbstractURL: "", RelatedTopics: [], Results: [] }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "<div class='result'><a class='result__a' href='//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fnews'>Current result</a><a class='result__snippet'>Fresh source summary</a></div>",
    });

    const response = await searchWeb("current agent news");

    expect(response.provider).toBe("duckduckgo");
    expect(response.results).toEqual([{
      title: "Current result",
      url: "https://example.com/news",
      snippet: "Fresh source summary",
    }]);
  });

  it("returns an explicit error on network failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network error"));

    const response = await searchWeb("test query", { provider: "duckduckgo" });
    expect(response.results).toEqual([]);
    expect(response.error).toBe("Network error");
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

    const response = await searchWeb("test", { provider: "duckduckgo", maxResults: 3 });
    expect(response.results.length).toBeLessThanOrEqual(3);
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
    (config.search as any).tavilyApiKey = "test-key";

    const response = await searchWeb("test query");
    // Should fall back to DuckDuckGo since Tavily has no API key
    expect(response.provider).toBe("duckduckgo");
    expect(response.results.length).toBeGreaterThanOrEqual(0);
  });

  it("propagates user cancellation without degrading to an empty result", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(async (_url, init) => {
      controller.abort();
      throw (init.signal as AbortSignal).reason ?? new DOMException("aborted", "AbortError");
    });

    await expect(searchWeb("cancel me", { provider: "duckduckgo", signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
  });
});
