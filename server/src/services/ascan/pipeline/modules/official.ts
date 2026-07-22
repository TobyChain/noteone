/**
 * Official tracker module — TS port of ascan/src/official_tracker/
 * (fetcher.py + analyzer.py + report.py + stages.py + models.py).
 *
 * Fetches official-source sitemaps (Anthropic Research / DeepMind Blog),
 * dedups against the DB (official_items), scrapes article bodies, runs LLM
 * analysis with cache, and renders the HTML/MD fragments for the unified
 * daily report.
 */
import * as cheerio from "cheerio";
import { eq, isNotNull, and } from "drizzle-orm";
import { db } from "../../../../db/client.js";
import { ascanOfficialItems } from "../../../../db/schema.js";
import type { ModuleContext, ModuleResult } from "../types.js";
import { sleep, fetchWithTimeout, escapeHtml, DEFAULT_UA } from "../util.js";

// ── constants (fetcher.py / settings.py defaults) ─────────────

const RETRY_DELAYS = [5, 10]; // seconds, matches fetcher.py RETRY_DELAYS

const DAYS_RECENT = 30;
// settings.py defaults (not part of the TS AscanConfig surface)
const ANTHROPIC_SITEMAP_URL = "https://www.anthropic.com/sitemap.xml";
const DEEPMIND_SITEMAP_URL = "https://deepmind.google/sitemap.xml";
const OFFICIAL_SCRAPE_DELAY_MS = 1000; // official_scrape_delay = 1.0s
const OFFICIAL_MAX_PER_SOURCE = 3; // official_max_per_source

// ── models (models.py) ────────────────────────────────────────

interface OfficialItem {
  source: string; // anthropic / openai / deepmind
  slug: string; // unique identifier ("source:slug")
  url: string;
  title: string | null;
  date: string | null; // YYYY-MM-DD
  category: string | null;
  summary: string | null;
  content: string | null; // first 2000 chars of article body
  sitemapLastmod: string | null;
}

interface OfficialAnalysis {
  one_liner: string;
  summary_cn: string;
  core_insight: string;
  relevance: string;
}

interface SitemapEntry {
  slug: string;
  url: string;
  lastmod: string;
}

// ── HTTP helpers (fetcher.py) ─────────────────────────────────

async function httpGet(url: string): Promise<Response> {
  return fetchWithTimeout(url, {
    headers: { "User-Agent": DEFAULT_UA },
    redirect: "follow",
  });
}

/** GET with retry on errors — port of OfficialFetcher._get_with_retry. */
async function getWithRetry(url: string, label: string, log: (m: string) => void): Promise<string> {
  let lastError: unknown = null;
  const delays = [0, ...RETRY_DELAYS];
  for (let attempt = 0; attempt < delays.length; attempt++) {
    const delay = delays[attempt];
    if (delay) {
      log(`${label} 重试 (第${attempt}次, ${delay}s)...`);
      await sleep(delay * 1000);
    }
    try {
      const resp = await httpGet(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
      return await resp.text();
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

// ── sitemap fetchers (fetcher.py) ─────────────────────────────

function parseSitemapUrls(xml: string): Array<{ loc: string; lastmod: string }> {
  const $ = cheerio.load(xml, { xmlMode: true });
  const out: Array<{ loc: string; lastmod: string }> = [];
  $("url").each((_, el) => {
    const loc = $(el).find("loc").first().text().trim();
    const lastmod = $(el).find("lastmod").first().text().trim().slice(0, 10);
    out.push({ loc, lastmod });
  });
  return out;
}

function lastSegment(loc: string): string {
  const trimmed = loc.replace(/\/+$/, "");
  const parts = trimmed.split("/");
  return parts[parts.length - 1] ?? "";
}

/** Parse Anthropic sitemap, filter /research/ URLs. */
async function fetchAnthropicSitemap(log: (m: string) => void, sitemapUrl = ANTHROPIC_SITEMAP_URL): Promise<SitemapEntry[]> {
  const xml = await getWithRetry(sitemapUrl, "Anthropic", log);
  const items: SitemapEntry[] = [];
  for (const { loc, lastmod } of parseSitemapUrls(xml)) {
    // Only /research/ articles, exclude listing page and team pages
    if (!loc.includes("/research/")) continue;
    if (loc.replace(/\/+$/, "").endsWith("/research") || loc.includes("/research/team/")) continue;
    const slug = loc ? lastSegment(loc) : "";
    if (!slug) continue;
    const fullUrl = loc.startsWith("http") ? loc : `https://www.anthropic.com${loc}`;
    items.push({ slug: `anthropic:${slug}`, url: fullUrl, lastmod });
  }
  log(`Anthropic sitemap: ${items.length} research articles found`);
  return items;
}

/** Parse DeepMind sitemap, filter /blog/ URLs. */
async function fetchDeepmindSitemap(log: (m: string) => void, sitemapUrl = DEEPMIND_SITEMAP_URL): Promise<SitemapEntry[]> {
  const xml = await getWithRetry(sitemapUrl, "DeepMind", log);
  const items: SitemapEntry[] = [];
  for (const { loc, lastmod } of parseSitemapUrls(xml)) {
    if (!loc.includes("/blog/")) continue;
    const slug = loc ? lastSegment(loc) : "";
    if (!slug || slug === "blog") continue;
    const fullUrl = loc.startsWith("http") ? loc : `https://deepmind.google${loc}`;
    items.push({ slug: `deepmind:${slug}`, url: fullUrl, lastmod });
  }
  log(`DeepMind sitemap: ${items.length} blog articles found`);
  return items;
}

// ── article content scraping (fetcher.py) ─────────────────────

/** Mimic BeautifulSoup get_text(separator="\n", strip=True). */
function textWithNewlines($: cheerio.CheerioAPI, el: any): string {
  const parts: string[] = [];
  const walk = (node: any) => {
    if (node.type === "text") {
      const t = String(node.data ?? "").trim();
      if (t) parts.push(t);
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  for (const node of $(el).toArray()) walk(node);
  return parts.join("\n");
}

/** Fetch and parse a single article page. Returns {title, summary, content} or null. */
async function scrapeArticleContent(url: string, log: (m: string) => void): Promise<{ title?: string; summary?: string; content?: string } | null> {
  const resp = await httpGet(url);
  if (resp.status !== 200) {
    log(`Failed to fetch ${url}: HTTP ${resp.status}`);
    return null;
  }
  const html = await resp.text();
  const $ = cheerio.load(html);

  // Remove noise
  $("script, style, nav, footer, header").remove();

  // Find main content area
  let main = $("article").first();
  if (!main.length) main = $("main").first();
  if (!main.length) {
    main = $("div")
      .filter((_, el) => {
        const c = $(el).attr("class") || "";
        return !!c && (c.includes("content") || c.includes("post") || c.includes("article"));
      })
      .first();
  }
  if (!main.length) main = $("body").first();
  if (!main.length) return null;

  const result: { title?: string; summary?: string; content?: string } = {};

  // Title
  let h1 = main.find("h1").first();
  if (!h1.length) h1 = $("h1").first();
  if (h1.length) result.title = h1.text().trim();

  // First paragraph as summary
  const firstP = main.find("p").first();
  if (firstP.length) result.summary = firstP.text().trim().slice(0, 300);

  // Full content (first 2000 chars)
  result.content = textWithNewlines($, main).slice(0, 2000);

  return result;
}

/** Scrape content for multiple articles with delay between requests. */
async function scrapeArticlesBatch(items: OfficialItem[], delayMs: number, log: (m: string) => void): Promise<OfficialItem[]> {
  const results: OfficialItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      const content = await scrapeArticleContent(item.url, log);
      if (content) {
        results.push({
          ...item,
          title: content.title || item.title,
          summary: content.summary || item.summary,
          content: content.content ?? null,
        });
      } else {
        results.push(item);
      }
    } catch (e) {
      log(`Scrape failed for ${item.url}: ${e}`);
      results.push(item);
    }
    if (i < items.length - 1 && delayMs > 0) await sleep(delayMs);
  }
  return results;
}

// ── DB repository (OfficialItemRepository semantics) ──────────

type OfficialRow = typeof ascanOfficialItems.$inferSelect;

async function getBySlug(slug: string): Promise<OfficialRow | undefined> {
  const rows = await db.select().from(ascanOfficialItems).where(eq(ascanOfficialItems.slug, slug)).limit(1);
  return rows[0];
}

/** Returns {slug: sitemap_lastmod} for incremental dedup. */
async function getAllKnownSlugs(): Promise<Map<string, string | null>> {
  const rows = await db
    .select({ slug: ascanOfficialItems.slug, sitemapLastmod: ascanOfficialItems.sitemapLastmod })
    .from(ascanOfficialItems);
  return new Map(rows.map((r) => [r.slug, r.sitemapLastmod]));
}

/** Insert a newly discovered item (callers pre-filter against known slugs). */
async function upsertDiscovered(entry: SitemapEntry, today: string): Promise<void> {
  await db
    .insert(ascanOfficialItems)
    .values({
      source: entry.slug.split(":")[0], // 格式 "source:actual_slug"
      slug: entry.slug,
      url: entry.url,
      title: "",
      date: "",
      category: "",
      itemType: "article",
      summary: "",
      sitemapLastmod: entry.lastmod || null,
      firstSeenDate: today,
      lastSeenDate: today,
      analyzed: false,
    })
    .onConflictDoNothing({ target: ascanOfficialItems.slug });
}

async function saveScrapedContent(item: OfficialItem): Promise<void> {
  const existing = await getBySlug(item.slug);
  if (!existing) return;
  await db
    .update(ascanOfficialItems)
    .set({
      title: item.title || existing.title,
      date: item.date || existing.date,
      category: item.category || existing.category,
      summary: item.summary || existing.summary,
      content: item.content,
      updatedAtTs: new Date(),
    })
    .where(eq(ascanOfficialItems.slug, item.slug));
}

async function saveAnalysis(slug: string, analysis: OfficialAnalysis): Promise<void> {
  await db
    .update(ascanOfficialItems)
    .set({
      oneLiner: analysis.one_liner,
      summaryCn: analysis.summary_cn,
      coreInsight: analysis.core_insight,
      relevance: analysis.relevance,
      analyzed: true,
      updatedAtTs: new Date(),
    })
    .where(eq(ascanOfficialItems.slug, slug));
}

/** Slugs that already have a stored analysis (analyzed AND one_liner set). */
async function getAllAnalyzedSlugs(): Promise<Set<string>> {
  const rows = await db
    .select({ slug: ascanOfficialItems.slug })
    .from(ascanOfficialItems)
    .where(and(eq(ascanOfficialItems.analyzed, true), isNotNull(ascanOfficialItems.oneLiner)));
  return new Set(rows.map((r) => r.slug));
}

// ── LLM analysis (analyzer.py) ────────────────────────────────

function buildArticlePrompt(item: OfficialItem, language: "zh" | "en"): string {
  const contentPreview = (item.content || item.summary || "").slice(0, 1500);

  if (language === "en") {
    return `You are a tech content editor. Generate a summary for the following technical article, output in JSON format.

## Article Info
- Title: ${item.title || "Unknown"}
- Date: ${item.date || "Unknown"}
- Source: ${item.source}
- Summary: ${item.summary || ""}
- Content preview (first 1500 chars): ${contentPreview}

## Output Requirements
Output a strict JSON object with the following fields:
- one_liner: plain English explanation of what this research/update is about (max 30 words)
- summary_cn: English summary (2-3 sentences)
- core_insight: core technical insight or contribution (English, 2-3 sentences)

Output JSON only, no other content.`;
  }

  return `你是一位技术内容编辑。请为以下技术文章生成中文摘要，输出JSON格式。

## 文章信息
- 标题：${item.title || "未知"}
- 日期：${item.date || "未知"}
- 来源：${item.source}
- 摘要：${item.summary || ""}
- 内容摘要（前1500字）：${contentPreview}

## 输出要求
请输出严格的 JSON 对象，包含以下字段：
- one_liner: 用大白话说清这篇研究/更新讲了什么（中文，≤30字）
- summary_cn: 中文摘要（2-3句）
- core_insight: 核心技术洞察或贡献（中文，2-3句）

只输出 JSON，不要其他内容。`;
}

/** Analyze a single article (retry/JSON repair handled by chatJsonRetry). */
async function analyzeItem(ctx: ModuleContext, item: OfficialItem): Promise<OfficialAnalysis | null> {
  try {
    const lang = ctx.language || "zh";
    const data = await ctx.llm.chatJsonRetry<Record<string, unknown>>(buildArticlePrompt(item, lang));
    return {
      one_liner: String(data.one_liner ?? ""),
      summary_cn: String(data.summary_cn ?? ""),
      core_insight: String(data.core_insight ?? ""),
      relevance: "一般",
    };
  } catch (e) {
    ctx.log(`LLM analysis failed for ${item.slug}: ${e}`);
    return null;
  }
}

// ── report rendering (report.py) ──────────────────────────────

const SRC_LABEL: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", deepmind: "DeepMind" };

function officialsToDailyHtml(items: OfficialItem[], analyses: Map<string, OfficialAnalysis | null>, language: "zh" | "en" = "zh"): string {
  const L = language === "en"
    ? {
        note: (n: number, srcs: string) => `Found ${n} official updates (within 30 days), from ${srcs}.`,
        quickView: "Quick View",
        headers: ["Source", "Title", "Date", "Summary"],
        oneLiner: "Summary:",
        coreInsight: "Core Insight:",
        empty: "No official updates today.",
      }
    : {
        note: (n: number, srcs: string) => `共发现 ${n} 条官方动态（30 天内），来自 ${srcs}。`,
        quickView: "文章速览",
        headers: ["来源", "标题", "日期", "一句话"],
        oneLiner: "一句话：",
        coreInsight: "核心洞察：",
        empty: "今日无官方动态更新。",
      };

  const articles: Array<[OfficialItem, OfficialAnalysis | null]> = items.map((item) => [item, analyses.get(item.slug) ?? null]);

  // Count by source
  const sourceCounts = new Map<string, number>();
  for (const [item] of articles) {
    sourceCounts.set(item.source, (sourceCounts.get(item.source) ?? 0) + 1);
  }

  const lines: string[] = [];
  lines.push(
    `<p class="meta-note">${escapeHtml(L.note(items.length, [...sourceCounts.keys()].join("、")))}</p>`,
  );

  // Summary table for analyzed articles — round-robin across sources
  const analyzed = articles.filter((pair): pair is [OfficialItem, OfficialAnalysis] => pair[1] !== null);
  if (analyzed.length) {
    lines.push('<div class="summary-table-wrapper"><table class="summary-table">');
    lines.push(`<thead><tr>${L.headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>`);
    lines.push("<tbody>");
    // Round-robin: take up to 8 per source
    const bySource = new Map<string, Array<[OfficialItem, OfficialAnalysis]>>();
    for (const [item, a] of analyzed) {
      if (!bySource.has(item.source)) bySource.set(item.source, []);
      bySource.get(item.source)!.push([item, a]);
    }
    const tableRows: Array<[OfficialItem, OfficialAnalysis]> = [];
    for (const src of ["anthropic", "openai", "deepmind"]) {
      for (const pair of (bySource.get(src) ?? []).slice(0, 8)) tableRows.push(pair);
    }
    for (const [item, a] of tableRows) {
      const sourceLabel = SRC_LABEL[item.source] ?? item.source;
      const dateStr = item.date || "";
      lines.push(
        `<tr><td>${escapeHtml(sourceLabel)}</td>` +
        `<td><a href="${escapeHtml(item.url)}" target="_blank">${escapeHtml((item.title || item.slug).slice(0, 60))}</a></td>` +
        `<td>${escapeHtml(dateStr)}</td><td>${escapeHtml(a.one_liner)}</td></tr>`,
      );
    }
    lines.push("</tbody></table></div>");
  }

  // Detailed cards
  lines.push('<div class="detail-cards">');
  for (const [item, a] of articles) {
    if (a === null) continue;

    const sourceLabel = SRC_LABEL[item.source] ?? item.source;
    const categoryTag = item.category
      ? `<span class="tag tag-${escapeHtml(item.source)}">${escapeHtml(item.category || sourceLabel)}</span>`
      : "";

    lines.push('<div class="card">');
    lines.push(`<h3><a href="${escapeHtml(item.url)}" target="_blank">${escapeHtml(item.title || item.slug)}</a></h3>`);
    lines.push(`<p class="meta-list">${categoryTag}<span>📅 ${escapeHtml(item.date || "")}</span></p>`);

    if (a.one_liner) lines.push(`<p class="lead"><strong>${escapeHtml(L.oneLiner)}</strong>${escapeHtml(a.one_liner)}</p>`);
    if (a.summary_cn) lines.push(`<div class="abstract-cn"><p>${escapeHtml(a.summary_cn)}</p></div>`);
    if (a.core_insight) lines.push(`<p><strong>${escapeHtml(L.coreInsight)}</strong>${escapeHtml(a.core_insight)}</p>`);

    lines.push("</div>");
  }
  lines.push("</div>");

  return lines.join("\n");
}

function officialsToDailyMd(items: OfficialItem[], analyses: Map<string, OfficialAnalysis | null>, language: "zh" | "en" = "zh"): string {
  const L = language === "en"
    ? {
        note: (n: number) => `Found ${n} official updates (within 30 days).`,
        quickView: "Quick View",
        headers: ["Source", "Title", "Date", "Summary"],
        deepAnalysis: "Deep Analysis",
        source: "Source:",
        date: "Date:",
        category: "Category:",
        oneLiner: "Summary:",
        coreInsight: "Core Insight:",
        empty: "No official updates today.",
      }
    : {
        note: (n: number) => `共发现 ${n} 条官方动态（30 天内）。`,
        quickView: "文章速览",
        headers: ["来源", "标题", "日期", "一句话"],
        deepAnalysis: "深度解析",
        source: "来源：",
        date: "日期：",
        category: "分类：",
        oneLiner: "一句话：",
        coreInsight: "核心洞察：",
        empty: "今日无官方动态更新。",
      };

  const lines: string[] = [];
  lines.push(L.note(items.length));
  lines.push("");

  const analyzed: Array<[OfficialItem, OfficialAnalysis]> = [];
  for (const item of items) {
    const a = analyses.get(item.slug);
    if (a != null) analyzed.push([item, a]);
  }

  // Summary table
  if (analyzed.length) {
    lines.push(`#### ${L.quickView}`);
    lines.push("");
    lines.push(`| ${L.headers[0]} | ${L.headers[1]} | ${L.headers[2]} | ${L.headers[3]} |`);
    lines.push("|------|------|------|--------|");
    const bySource = new Map<string, Array<[OfficialItem, OfficialAnalysis]>>();
    for (const [item, a] of analyzed) {
      if (!bySource.has(item.source)) bySource.set(item.source, []);
      bySource.get(item.source)!.push([item, a]);
    }
    for (const src of ["anthropic", "openai", "deepmind"]) {
      for (const [item, a] of (bySource.get(src) ?? []).slice(0, 8)) {
        const sourceLabel = SRC_LABEL[item.source] ?? item.source;
        const dateStr = item.date || "";
        lines.push(`| ${sourceLabel} | [${(item.title || item.slug).slice(0, 40)}](${item.url}) | ${dateStr} | ${a.one_liner} |`);
      }
    }
    lines.push("");
  }

  // Detailed analysis
  if (analyzed.length) {
    lines.push(`#### ${L.deepAnalysis}`);
    lines.push("");
    for (const [item, a] of analyzed) {
      const sourceLabel = SRC_LABEL[item.source] ?? item.source;
      lines.push(`##### [${item.title || item.slug}](${item.url})`);
      lines.push("");
      lines.push(`**${L.source}** ${sourceLabel} | **${L.date}** ${item.date || ""}`);
      if (item.category) lines.push(`**${L.category}** ${item.category}`);
      lines.push("");
      lines.push(`**${L.oneLiner}** ${a.one_liner}`);
      lines.push("");
      lines.push(`> ${a.summary_cn}`);
      lines.push("");
      lines.push(`**${L.coreInsight}** ${a.core_insight}`);
      lines.push("");
      lines.push("---");
      lines.push("");
    }
  }

  if (!analyzed.length) {
    lines.push(`_${L.empty}_`);
  }

  return lines.join("\n");
}

// ── module entry (stages.py pipeline flow) ────────────────────

export async function run(ctx: ModuleContext): Promise<ModuleResult> {
  const { log } = ctx;
  const today = ctx.dateCompact;

  // ── Stage 1: Fetch — sitemaps, dedup against DB, 30d filter ──
  const knownSlugs = await getAllKnownSlugs();

  const allItemsData: SitemapEntry[] = [];

  // Source 1: Anthropic Research
  try {
    const anthItems = await fetchAnthropicSitemap(log);
    allItemsData.push(...anthItems);
    log(`Anthropic: ${anthItems.length} articles from sitemap`);
  } catch (e) {
    log(`Anthropic fetch failed: ${e}`);
  }

  // Source 2: Google DeepMind Blog
  try {
    const dmItems = await fetchDeepmindSitemap(log);
    allItemsData.push(...dmItems);
    log(`DeepMind: ${dmItems.length} articles from sitemap`);
  } catch (e) {
    log(`DeepMind fetch failed: ${e}`);
  }

  // Dedup: keep only articles not already seen in DB
  const newItemsData = allItemsData.filter((d) => !knownSlugs.has(d.slug));

  // Build OfficialItem list from NEW items only
  const officialItems: OfficialItem[] = newItemsData.map((d) => ({
    source: d.slug.split(":")[0],
    slug: d.slug,
    url: d.url,
    title: null,
    date: d.lastmod ? d.lastmod.slice(0, 10) : null,
    category: null,
    summary: null,
    content: null,
    sitemapLastmod: d.lastmod || null,
  }));

  // Filter by 30-day recency (keep items with unparseable dates)
  const cutoff = new Date(Date.now() - DAYS_RECENT * 24 * 3600 * 1000);
  const recentItems: OfficialItem[] = [];
  let skippedOld = 0;
  for (const item of officialItems) {
    const itemDate = (item.date || item.sitemapLastmod || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(itemDate)) {
      const dt = new Date(`${itemDate}T00:00:00`);
      if (!isNaN(dt.getTime()) && dt < cutoff) {
        skippedOld++;
        continue;
      }
    }
    recentItems.push(item);
  }
  if (skippedOld) log(`跳过了 ${skippedOld} 篇超过 ${DAYS_RECENT} 天的旧文章`);

  // Take up to N latest per source (sorted by date desc)
  const dateKey = (it: OfficialItem) => (it.date || it.sitemapLastmod || "").slice(0, 10);
  const bySource = new Map<string, OfficialItem[]>();
  for (const item of recentItems) {
    if (!bySource.has(item.source)) bySource.set(item.source, []);
    bySource.get(item.source)!.push(item);
  }
  const filtered: OfficialItem[] = [];
  for (const items of bySource.values()) {
    items.sort((a, b) => (dateKey(a) < dateKey(b) ? 1 : dateKey(a) > dateKey(b) ? -1 : 0));
    filtered.push(...items.slice(0, OFFICIAL_MAX_PER_SOURCE));
  }

  // Insert selected items to DB (so they won't reappear tomorrow)
  if (filtered.length) {
    const selectedSlugs = new Set(filtered.map((it) => it.slug));
    const toUpsert = newItemsData.filter((d) => selectedSlugs.has(d.slug));
    for (const entry of toUpsert) {
      await upsertDiscovered(entry, today);
    }
    log(`Upserted ${toUpsert.length} new items`);
  }

  const analyzedSlugs = await getAllAnalyzedSlugs();
  log(`Fetch done: ${filtered.length} new items (每源≤${OFFICIAL_MAX_PER_SOURCE}篇), ${analyzedSlugs.size} already analyzed`);

  // ── Stage 2: Enrich — scrape article bodies ──
  let items = filtered;
  if (items.length) {
    const toScrape = items.filter((item) => !item.content);
    if (toScrape.length) {
      log(`Scraping content for ${toScrape.length} articles...`);
      const enriched = await scrapeArticlesBatch(toScrape, OFFICIAL_SCRAPE_DELAY_MS, log);

      // Save scraped content to DB
      for (const item of enriched) {
        if (item.content) await saveScrapedContent(item);
      }

      const slugMap = new Map(enriched.map((it) => [it.slug, it]));
      items = items.map((item) => slugMap.get(item.slug) ?? item);
      log(`Enrich done: ${toScrape.length} articles scraped`);
    } else {
      log("No articles to scrape, skipping");
    }
  }

  // ── Stage 3: Analyze — restore cached analyses, LLM for the rest ──
  const analyses = new Map<string, OfficialAnalysis | null>();
  if (items.length) {
    // Pass 1: restore already-analyzed from DB
    let cachedCount = 0;
    for (const item of items) {
      if (!analyzedSlugs.has(item.slug)) continue;
      const row = await getBySlug(item.slug);
      if (row && row.analyzed && row.oneLiner) {
        analyses.set(item.slug, {
          one_liner: row.oneLiner || "",
          summary_cn: row.summaryCn || "",
          core_insight: row.coreInsight || "",
          relevance: row.relevance || "一般",
        });
        cachedCount++;
      }
    }

    // Pass 2: LLM 并发分析
    const toAnalyze = items.filter((item) => !analyses.has(item.slug));
    log(`Analyze: ${items.length} total, ${cachedCount} cached, ${toAnalyze.length} need LLM`);

    if (toAnalyze.length) {
      if (!ctx.llm.isConfigured) {
        log("LLM not configured, skipping analysis");
      } else {
        const results = await ctx.llm.mapConcurrent(
          toAnalyze,
          async (item) => ({ slug: item.slug, analysis: await analyzeItem(ctx, item) }),
          (item) => ({ slug: item.slug, analysis: null as OfficialAnalysis | null }),
        );
        for (const { slug, analysis } of results) {
          analyses.set(slug, analysis);
          if (analysis) {
            try {
              await saveAnalysis(slug, analysis);
            } catch (e) {
              log(`Failed to save analysis for ${slug}: ${e}`);
            }
          }
        }
      }
    }

    const successCount = [...analyses.values()].filter((a) => a !== null).length;
    log(`Analysis done: ${successCount}/${items.length} (${cachedCount} cached, ${toAnalyze.length} new LLM calls)`);
  }

  // ── Stage 4: Build fragment ──
  const lang = ctx.language || "zh";
  if (!items.length) {
    log("No items for official report, using placeholder");
    return {
      html: lang === "en"
        ? '<p class="empty-state">No new Anthropic Research or DeepMind articles today.</p>'
        : '<p class="empty-state">今日无 Anthropic Research 或 DeepMind 新文章。</p>',
      md: lang === "en"
        ? "_No new Anthropic Research or DeepMind articles today._"
        : "_今日无 Anthropic Research 或 DeepMind 新文章。_",
      count: 0,
    };
  }

  const html = officialsToDailyHtml(items, analyses, lang);
  const md = officialsToDailyMd(items, analyses, lang);
  log(`Official HTML+MD 片段已生成 (HTML: ${html.length} chars)`);

  return { html, md, count: items.length };
}
