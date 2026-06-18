import { assertSafeUrl } from "./url-guard.js";

export interface FetchResult {
  url: string;
  title: string;
  content: string;
  author?: string;
  siteName?: string;
  publishedDate?: string;
  error?: string;
}

const MAX_REDIRECTS = 5;
const MAX_BYTES = 2 * 1024 * 1024; // hard cap on response body read into memory

async function readBodyLimited(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (total + value.length > maxBytes) {
      chunks.push(value.slice(0, maxBytes - total));
      await reader.cancel();
      break;
    }
    chunks.push(value);
    total += value.length;
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export async function fetchUrlContent(url: string, maxLength = 15000): Promise<FetchResult> {
  const start = Date.now();
  try {
    let currentUrl = url;
    let res: Response | undefined;

    // Follow redirects manually so every hop is re-validated against the SSRF guard.
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const safe = await assertSafeUrl(currentUrl);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        res = await fetch(safe, {
          signal: controller.signal,
          headers: {
            "User-Agent": "NoteOne/0.1 (AI Knowledge Assistant)",
            "Accept": "text/html,text/plain,application/xhtml+xml",
          },
          redirect: "manual",
        });
      } finally {
        clearTimeout(timeout);
      }

      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        currentUrl = new URL(location, safe).toString();
        continue;
      }
      break;
    }

    if (!res) {
      return { url, title: "", content: "", error: "No response" };
    }
    if (res.status >= 300 && res.status < 400) {
      return { url, title: "", content: "", error: "Too many redirects" };
    }
    if (!res.ok) {
      return { url, title: "", content: "", error: `HTTP ${res.status}` };
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/") && !contentType.includes("html") && !contentType.includes("xml") && !contentType.includes("json")) {
      return { url, title: "", content: "", error: `Unsupported content type: ${contentType}` };
    }

    const html = await readBodyLimited(res, MAX_BYTES);

    const title = extractTitle(html);
    const content = htmlToText(html, maxLength);
    const author = extractMeta(html, ["author", "article:author", "byl", "twitter:creator"]);
    const siteName = extractMeta(html, ["og:site_name", "application-name"]);
    const publishedDate = extractMeta(html, [
      "article:published_time", "datePublished", "date", "og:published_time",
    ]);

    return { url, title, content, author, siteName, publishedDate };
  } catch (err: any) {
    const msg = err.name === "AbortError" ? "Timeout after 10s" : err.message;
    console.log(`[web-fetch] url=${url.slice(0, 80)} duration=${Date.now() - start}ms status=error error=${msg}`);
    return { url, title: "", content: "", error: msg };
  }
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? decodeEntities(match[1].trim()) : "";
}

// Extract a <meta> content value by name or property (first match wins).
function extractMeta(html: string, keys: string[]): string | undefined {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]*content=["']([^"']+)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:name|property)=["']${escaped}["']`, "i"),
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m && m[1].trim()) return decodeEntities(m[1].trim());
    }
  }
  return undefined;
}

function htmlToText(html: string, maxLength: number): string {
  let text = html;

  // Remove script, style, nav, header, footer blocks
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<header[\s\S]*?<\/header>/gi, "");
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, "");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  // Convert block elements to newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[^>]*>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  text = decodeEntities(text);

  // Collapse whitespace
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.trim();

  if (text.length > maxLength) {
    text = text.slice(0, maxLength) + "\n...(truncated)";
  }

  return text;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
