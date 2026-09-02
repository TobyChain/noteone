import { afterEach, describe, expect, it, vi } from "vitest";
import { apiEndpoint, llmFetch } from "./llm.js";

const cfg = { apiKey: "test", baseUrl: "http://test", model: "test" };

afterEach(() => vi.unstubAllGlobals());

describe("llmFetch", () => {
  it("joins API paths without duplicate slashes", () => {
    expect(apiEndpoint("https://example.com/v1/", "/chat/completions"))
      .toBe("https://example.com/v1/chat/completions");
  });
  it("rejects a successful HTTP response with a non-JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream malformed", { status: 200 })));
    await expect(llmFetch("http://test/chat/completions", cfg, {}))
      .rejects.toThrow(/non-JSON response: upstream malformed/);
  });

  it("propagates an external abort signal to fetch", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.signal?.aborted).toBe(true);
      throw new DOMException("aborted", "AbortError");
    });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();
    await expect(llmFetch("http://test/chat/completions", cfg, {}, controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
  });

  it("retries transient gateway errors", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(llmFetch("http://test/chat/completions", cfg, {}))
      .resolves.toMatchObject({ choices: [{ message: { content: "ok" } }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
