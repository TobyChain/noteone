import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub DNS lookup so tests are deterministic and offline. Each test sets the next
// resolution result by calling `setLookupResult`.
let nextLookup: { address: string }[] | Error = [];

vi.mock("node:dns/promises", () => ({
    lookup: vi.fn(async () => {
        if (nextLookup instanceof Error) throw nextLookup;
        return nextLookup;
    }),
}));

import { assertSafeUrl } from "./url-guard.js";

function setLookupResult(addrs: string[] | Error) {
    nextLookup = addrs instanceof Error ? addrs : addrs.map((a) => ({ address: a }));
}

describe("assertSafeUrl", () => {
    beforeEach(() => {
        setLookupResult([]);
    });

    describe("protocol restrictions", () => {
        it("rejects file:// urls", async () => {
            await expect(assertSafeUrl("file:///etc/passwd")).rejects.toThrow(/http/i);
        });

        it("rejects ftp:// urls", async () => {
            await expect(assertSafeUrl("ftp://example.com")).rejects.toThrow(/http/i);
        });

        it("rejects malformed urls", async () => {
            await expect(assertSafeUrl("not a url")).rejects.toThrow(/Invalid URL/);
        });
    });

    describe("IPv4 in URL hostname (no DNS lookup)", () => {
        it("rejects loopback 127.0.0.1", async () => {
            await expect(assertSafeUrl("http://127.0.0.1/")).rejects.toThrow(/private|reserved/i);
        });

        it("rejects 0.0.0.0 / this-network", async () => {
            await expect(assertSafeUrl("http://0.0.0.0/")).rejects.toThrow(/private|reserved/i);
        });

        it("rejects 10.0.0.1 (private)", async () => {
            await expect(assertSafeUrl("http://10.0.0.1/")).rejects.toThrow();
        });

        it("rejects 192.168.1.1 (private)", async () => {
            await expect(assertSafeUrl("http://192.168.1.1/")).rejects.toThrow();
        });

        it("rejects 172.16.0.1 (private 172.16/12)", async () => {
            await expect(assertSafeUrl("http://172.16.0.1/")).rejects.toThrow();
        });

        it("rejects 169.254.169.254 (cloud metadata link-local)", async () => {
            await expect(assertSafeUrl("http://169.254.169.254/")).rejects.toThrow();
        });

        it("rejects 100.64.0.1 (CGNAT)", async () => {
            await expect(assertSafeUrl("http://100.64.0.1/")).rejects.toThrow();
        });

        it("rejects multicast 224.0.0.1", async () => {
            await expect(assertSafeUrl("http://224.0.0.1/")).rejects.toThrow();
        });

        it("allows public IPv4 8.8.8.8", async () => {
            await expect(assertSafeUrl("http://8.8.8.8/")).resolves.toBeDefined();
        });
    });

    describe("IPv6 in URL hostname", () => {
        it("rejects ::1 (loopback)", async () => {
            await expect(assertSafeUrl("http://[::1]/")).rejects.toThrow();
        });

        it("rejects fc00::/7 (unique local)", async () => {
            await expect(assertSafeUrl("http://[fc00::1]/")).rejects.toThrow();
        });

        it("rejects fe80::/10 (link-local)", async () => {
            await expect(assertSafeUrl("http://[fe80::1]/")).rejects.toThrow();
        });

        it("rejects IPv4-mapped IPv6 to private space", async () => {
            await expect(assertSafeUrl("http://[::ffff:127.0.0.1]/")).rejects.toThrow();
        });
    });

    describe("hostname requiring DNS resolution", () => {
        it("rejects when DNS resolves to a private IP", async () => {
            setLookupResult(["10.0.0.42"]);
            await expect(assertSafeUrl("http://example.internal/")).rejects.toThrow(
                /private|reserved/i,
            );
        });

        it("rejects if ANY resolved IP is private (multi-record)", async () => {
            setLookupResult(["8.8.8.8", "127.0.0.1"]);
            await expect(assertSafeUrl("http://example.com/")).rejects.toThrow();
        });

        it("rejects when DNS lookup fails", async () => {
            setLookupResult(new Error("ENOTFOUND"));
            await expect(assertSafeUrl("http://nonexistent.example/")).rejects.toThrow();
        });

        it("rejects when DNS returns empty result", async () => {
            setLookupResult([]);
            await expect(assertSafeUrl("http://nothing.example/")).rejects.toThrow(/DNS/i);
        });

        it("allows when all resolved IPs are public", async () => {
            setLookupResult(["8.8.8.8", "1.1.1.1"]);
            const url = await assertSafeUrl("http://example.com/path");
            expect(url.hostname).toBe("example.com");
        });
    });
});
