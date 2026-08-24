import { describe, it, expect, vi, beforeEach } from "vitest";

// Make the SSRF guard always pass — we test web-fetch's redirect/limit logic in isolation here.
vi.mock("./url-guard.js", () => ({
    assertSafeUrl: vi.fn(async (raw: string) => new URL(raw)),
}));

import { fetchUrlContent } from "./web-fetch.js";

function htmlBody(html: string): Response {
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(html));
            controller.close();
        },
    });
    return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
    });
}

function redirectTo(location: string): Response {
    return new Response(null, { status: 301, headers: { location } });
}

describe("fetchUrlContent", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    beforeEach(() => {
        fetchSpy.mockReset();
    });

    it("strips html, extracts title and meta", async () => {
        fetchSpy.mockResolvedValueOnce(htmlBody(`
      <html><head>
        <title>Hello World</title>
        <meta name="author" content="Alice">
        <meta property="og:site_name" content="Example Co">
        <meta property="article:published_time" content="2026-01-02">
      </head><body><p>Body text</p></body></html>
    `));

        const result = await fetchUrlContent("http://example.com/article");
        expect(result.error).toBeUndefined();
        expect(result.title).toBe("Hello World");
        expect(result.author).toBe("Alice");
        expect(result.siteName).toBe("Example Co");
        expect(result.publishedDate).toBe("2026-01-02");
        expect(result.content).toContain("Body text");
    });

    it("follows redirects up to 5 hops", async () => {
        for (let i = 0; i < 5; i++) {
            fetchSpy.mockResolvedValueOnce(redirectTo(`http://example.com/hop${i + 1}`));
        }
        fetchSpy.mockResolvedValueOnce(htmlBody("<title>Final</title>"));
        const result = await fetchUrlContent("http://example.com/start");
        expect(result.error).toBeUndefined();
        expect(result.title).toBe("Final");
        // 5 redirects + 1 final
        expect(fetchSpy).toHaveBeenCalledTimes(6);
    });

    it("gives up after too many redirects", async () => {
        // 7 redirects -> exceeds MAX_REDIRECTS=5, never resolves
        for (let i = 0; i < 7; i++) {
            fetchSpy.mockResolvedValueOnce(redirectTo(`http://example.com/hop${i + 1}`));
        }
        const result = await fetchUrlContent("http://example.com/start");
        expect(result.error).toMatch(/redirect/i);
    });

    it("rejects non-text content types", async () => {
        fetchSpy.mockResolvedValueOnce(new Response("binary", {
            status: 200,
            headers: { "content-type": "application/octet-stream" },
        }));
        const result = await fetchUrlContent("http://example.com/binary");
        expect(result.error).toMatch(/Unsupported/);
    });

    it("returns error for non-2xx responses", async () => {
        fetchSpy.mockResolvedValueOnce(new Response("nope", {
            status: 404,
            headers: { "content-type": "text/html" },
        }));
        const result = await fetchUrlContent("http://example.com/404");
        expect(result.error).toBe("HTTP 404");
    });

    it("truncates to maxLength", async () => {
        const big = "<html><body>" + "x".repeat(200) + "</body></html>";
        fetchSpy.mockResolvedValueOnce(htmlBody(big));
        const result = await fetchUrlContent("http://example.com/big", 50);
        expect(result.content.length).toBeLessThan(big.length);
        expect(result.content).toContain("truncated");
    });
});
