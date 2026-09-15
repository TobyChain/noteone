/**
 * Web search service for Notty's report generation.
 * Supports multiple search providers: duckduckgo (default, no API key), tavily, bing.
 * Results are returned as structured { title, url, snippet } items.
 */

import { config } from "../config.js";
import { fetchUrlContent } from "./web-fetch.js";
import * as cheerio from "cheerio";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchOptions {
  maxResults?: number;
  provider?: "duckduckgo" | "tavily" | "bing";
  signal?: AbortSignal;
}

type SearchProvider = "duckduckgo" | "tavily" | "bing";

export interface SearchResponse {
  provider: SearchProvider;
  results: SearchResult[];
  error?: string;
}

const DEFAULT_MAX_RESULTS = 5;

/**
 * Search the web for a query and return structured results.
 * Falls back gracefully if the configured provider fails.
 */
export async function searchWeb(
  query: string,
  options: SearchOptions = {},
): Promise<SearchResponse> {
  const provider = options.provider || config.search.provider;
  const maxResults = Math.max(1, Math.min(options.maxResults || DEFAULT_MAX_RESULTS, 10));
  const signal = options.signal;

  try {
    switch (provider) {
      case "tavily":
        return { provider, results: await searchTavily(query, maxResults, signal) };
      case "bing":
        return { provider, results: await searchBing(query, maxResults, signal) };
      case "duckduckgo":
      default:
        return await searchDuckDuckGo(query, maxResults, signal);
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    console.error(`[web-search] ${provider} search failed:`, err);
    // Fallback to DuckDuckGo if the primary provider fails
    if (provider !== "duckduckgo") {
      try {
        return await searchDuckDuckGo(query, maxResults, signal);
      } catch (fallbackErr) {
        if (signal?.aborted) throw fallbackErr;
        console.error("[web-search] DuckDuckGo fallback also failed:", fallbackErr);
      }
    }
    return {
      provider,
      results: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * DuckDuckGo Instant Answer API (no API key required).
 * Limited results but reliable for basic queries.
 */
async function searchDuckDuckGo(query: string, maxResults: number, externalSignal?: AbortSignal): Promise<SearchResponse> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  let primaryError: unknown;
  try {
    const signal = externalSignal
      ? AbortSignal.any([externalSignal, controller.signal])
      : controller.signal;
    const res = await fetch(url, {
      signal,
      headers: { "User-Agent": "NoteOne/0.1 (AI Knowledge Assistant)" },
    });

    if (!res.ok) {
      throw new Error(`DuckDuckGo API error: ${res.status}`);
    }

    const data: any = await res.json();
    const results: SearchResult[] = [];

    // Abstract (main answer)
    if (data.Abstract && data.AbstractURL) {
      results.push({
        title: data.Heading || query,
        url: data.AbstractURL,
        snippet: data.Abstract.slice(0, 300),
      });
    }

    // Related topics
    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics) {
        if (results.length >= maxResults) break;
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text.slice(0, 80),
            url: topic.FirstURL,
            snippet: topic.Text.slice(0, 300),
          });
        }
        // Handle nested topics (groups)
        if (topic.Topics) {
          for (const sub of topic.Topics) {
            if (results.length >= maxResults) break;
            if (sub.Text && sub.FirstURL) {
              results.push({
                title: sub.Text.slice(0, 80),
                url: sub.FirstURL,
                snippet: sub.Text.slice(0, 300),
              });
            }
          }
        }
      }
    }

    // Results section
    if (data.Results) {
      for (const r of data.Results) {
        if (results.length >= maxResults) break;
        if (r.Text && r.FirstURL) {
          results.push({
            title: r.Text.slice(0, 80),
            url: r.FirstURL,
            snippet: r.Text.slice(0, 300),
          });
        }
      }
    }

    if (results.length > 0) return { provider: "duckduckgo", results: results.slice(0, maxResults) };
  } catch (error) {
    if (externalSignal?.aborted) throw error;
    primaryError = error;
  } finally {
    clearTimeout(timeout);
  }

  try {
    const fallback = await searchPublicHtml(query, maxResults, externalSignal);
    if (fallback.results.length > 0 || primaryError === undefined) return fallback;
  } catch (fallbackError) {
    if (externalSignal?.aborted) throw fallbackError;
    if (primaryError === undefined) throw fallbackError;
  }
  throw primaryError;
}

/** The Instant Answer API is sparse for current topics; HTML results provide normal links. */
async function searchPublicHtml(
  query: string,
  maxResults: number,
  externalSignal?: AbortSignal,
): Promise<SearchResponse> {
  try {
    const results = await searchDuckDuckGoHtml(query, maxResults, externalSignal);
    if (results.length > 0) return { provider: "duckduckgo", results };
  } catch (error) {
    if (externalSignal?.aborted) throw error;
  }
  return { provider: "bing", results: await searchBingHtml(query, maxResults, externalSignal) };
}

async function searchDuckDuckGoHtml(
  query: string,
  maxResults: number,
  externalSignal?: AbortSignal,
): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  const signal = externalSignal
    ? AbortSignal.any([externalSignal, controller.signal])
    : controller.signal;
  try {
    const res = await fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query), {
      signal,
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
    });
    if (!res.ok) throw new Error("DuckDuckGo HTML error: " + res.status);
    const $ = cheerio.load(await res.text());
    const results: SearchResult[] = [];
    $(".result").each((_index, element) => {
      if (results.length >= maxResults) return false;
      const anchor = $(element).find(".result__a").first();
      const rawUrl = anchor.attr("href") || "";
      const url = decodeDuckDuckGoRedirect(rawUrl);
      const title = anchor.text().trim();
      const snippet = $(element).find(".result__snippet").first().text().replace(/\s+/g, " ").trim();
      if (title && /^https?:\/\//.test(url)) results.push({ title, url, snippet });
      return undefined;
    });
    return results;
  } finally {
    clearTimeout(timeout);
  }
}

async function searchBingHtml(
  query: string,
  maxResults: number,
  externalSignal?: AbortSignal,
): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  const signal = externalSignal
    ? AbortSignal.any([externalSignal, controller.signal])
    : controller.signal;
  try {
    const res = await fetch("https://www.bing.com/search?q=" + encodeURIComponent(query), {
      signal,
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
    });
    if (!res.ok) throw new Error("Bing HTML error: " + res.status);
    const $ = cheerio.load(await res.text());
    const results: SearchResult[] = [];
    $("li.b_algo").each((_index, element) => {
      if (results.length >= maxResults) return false;
      const anchor = $(element).find("h2 a").first();
      const url = anchor.attr("href") || "";
      const title = anchor.text().trim();
      const snippet = $(element).find(".b_caption p").first().text().replace(/\s+/g, " ").trim();
      if (title && /^https?:\/\//.test(url)) results.push({ title, url, snippet });
      return undefined;
    });
    return results;
  } finally {
    clearTimeout(timeout);
  }
}

function decodeDuckDuckGoRedirect(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl, "https://duckduckgo.com");
    return parsed.searchParams.get("uddg") || parsed.href;
  } catch {
    return rawUrl;
  }
}

/**
 * Tavily Search API (designed for AI agents).
 * Requires TAVILY_API_KEY.
 */
async function searchTavily(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const apiKey = config.search.tavilyApiKey;
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY not configured");
  }

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      include_answer: false,
    }),
  });

  if (!res.ok) {
    throw new Error(`Tavily API error: ${res.status} ${await res.text()}`);
  }

  const data: any = await res.json();
  return (data.results || []).map((r: any) => ({
    title: r.title || "",
    url: r.url || "",
    snippet: (r.content || "").slice(0, 300),
  }));
}

/**
 * Bing Web Search API v7.
 * Requires BING_SEARCH_API_KEY.
 */
async function searchBing(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const apiKey = config.search.bingApiKey;
  if (!apiKey) {
    throw new Error("BING_SEARCH_API_KEY not configured");
  }

  const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
  const res = await fetch(url, {
    headers: { "Ocp-Apim-Subscription-Key": apiKey },
    signal,
  });

  if (!res.ok) {
    throw new Error(`Bing API error: ${res.status} ${await res.text()}`);
  }

  const data: any = await res.json();
  return (data.webPages?.value || []).map((r: any) => ({
    title: r.name || "",
    url: r.url || "",
    snippet: (r.snippet || "").slice(0, 300),
  }));
}

/**
 * Fetch the full content of a search result URL.
 * Reuses the existing web-fetch pipeline with SSRF protection.
 */
export async function fetchSearchResult(url: string): Promise<string> {
  const result = await fetchUrlContent(url);
  if (result.error) {
    return `获取失败: ${result.error}`;
  }
  return `标题: ${result.title}\n\n${result.content}`;
}
