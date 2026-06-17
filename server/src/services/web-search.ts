/**
 * Web search service for Notty's report generation.
 * Supports multiple search providers: duckduckgo (default, no API key), tavily, bing.
 * Results are returned as structured { title, url, snippet } items.
 */

import { config } from "../config.js";
import { fetchUrlContent } from "./web-fetch.js";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchOptions {
  maxResults?: number;
  provider?: "duckduckgo" | "tavily" | "bing";
}

const DEFAULT_MAX_RESULTS = 5;

/**
 * Search the web for a query and return structured results.
 * Falls back gracefully if the configured provider fails.
 */
export async function searchWeb(
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const provider = options.provider || config.search.provider;
  const maxResults = options.maxResults || DEFAULT_MAX_RESULTS;

  try {
    switch (provider) {
      case "tavily":
        return await searchTavily(query, maxResults);
      case "bing":
        return await searchBing(query, maxResults);
      case "duckduckgo":
      default:
        return await searchDuckDuckGo(query, maxResults);
    }
  } catch (err) {
    console.error(`[web-search] ${provider} search failed:`, err);
    // Fallback to DuckDuckGo if the primary provider fails
    if (provider !== "duckduckgo") {
      try {
        return await searchDuckDuckGo(query, maxResults);
      } catch (fallbackErr) {
        console.error("[web-search] DuckDuckGo fallback also failed:", fallbackErr);
      }
    }
    return [];
  }
}

/**
 * DuckDuckGo Instant Answer API (no API key required).
 * Limited results but reliable for basic queries.
 */
async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
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

    return results.slice(0, maxResults);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Tavily Search API (designed for AI agents).
 * Requires TAVILY_API_KEY.
 */
async function searchTavily(query: string, maxResults: number): Promise<SearchResult[]> {
  const apiKey = config.search.tavilyApiKey;
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY not configured");
  }

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
async function searchBing(query: string, maxResults: number): Promise<SearchResult[]> {
  const apiKey = config.search.bingApiKey;
  if (!apiKey) {
    throw new Error("BING_SEARCH_API_KEY not configured");
  }

  const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
  const res = await fetch(url, {
    headers: { "Ocp-Apim-Subscription-Key": apiKey },
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
