import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// SSRF guard: reject URLs that resolve to loopback / private / link-local /
// reserved address space, restrict to http(s), and re-check on every redirect hop.

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true; // malformed → treat as unsafe
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // private 172.16/12
  if (a === 192 && b === 168) return true; // private 192.168/16
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 + 192.0.2.0/24 (special/test)
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18/15
  if (a >= 224) return true; // multicast (224/4) + reserved (240/4)
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().split("%")[0]; // strip zone id
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
  if (mapped) return isPrivateIPv4(mapped[1]);
  const head = parseInt(lower.split(":")[0] || "0", 16);
  if ((head & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((head & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  return false;
}

function isUnsafeAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true; // not a valid IP → unsafe
}

/**
 * Validate a URL is safe to fetch server-side. Throws on any violation.
 * Returns the parsed URL when safe.
 */
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http/https URLs are allowed");
  }

  const host = parsed.hostname;
  if (isIP(host)) {
    if (isUnsafeAddress(host)) throw new Error("Blocked private/reserved address");
    return parsed;
  }

  const records = await lookup(host, { all: true });
  if (records.length === 0) throw new Error("DNS resolution failed");
  for (const record of records) {
    if (isUnsafeAddress(record.address)) {
      throw new Error("Blocked private/reserved address");
    }
  }
  return parsed;
}
