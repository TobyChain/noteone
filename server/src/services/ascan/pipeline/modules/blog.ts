/**
 * Blog subscriptions module — RSS 抓取 + LLM 分析 + 日报片段生成.
 * TS port of ascan/src/blog_subs/ (rss_parser.py / analyzer.py / report.py / stages.py / models.py).
 */
import Parser from "rss-parser";
import { eq } from "drizzle-orm";
import { db } from "../../../../db/client.js";
import { ascanBlogPosts, ascanOfficialItems } from "../../../../db/schema.js";
import type { ModuleContext, ModuleResult } from "../types.js";
import { sleep, fetchWithTimeout, escapeHtml, DEFAULT_UA } from "../util.js";

const DAYS_RECENT = 30;

// ── models (port of models.py) ────────────────────────────────

interface BlogPost {
  source: string; // ruanyifeng / sebastian / lilianweng
  slug: string; // unique identifier
  url: string; // full URL
  title: string | null;
  date: string | null; // YYYY-MM-DD
  sourceLabel: string; // Chinese label like "阮一峰周刊"
  summary: string | null;
}

interface BlogAnalysis {
  oneLiner: string;
  summaryCn: string;
  relevance: string;
}

// ── RSS sources (port of rss_parser.py) ───────────────────────

const RSS_SOURCES: Array<{ name: string; url: string; label: string }> = [
  // ── 个人技术博客 ──
  { name: "ruanyifeng", url: "https://www.ruanyifeng.com/blog/atom.xml", label: "阮一峰周刊" },
  { name: "sebastian", url: "https://magazine.sebastianraschka.com/feed", label: "Sebastian Raschka" },
  { name: "lilianweng", url: "https://lilianweng.github.io/index.xml", label: "Lilian Weng" },
  { name: "huyenchip", url: "https://huyenchip.com/feed.xml", label: "Chip Huyen" },
  { name: "simonw", url: "https://simonwillison.net/atom/everything/", label: "Simon Willison" },
  { name: "eugeneyan", url: "https://eugeneyan.com/rss/", label: "Eugene Yan" },
  { name: "karpathy", url: "https://karpathy.github.io/feed.xml", label: "Andrej Karpathy" },
  // ── 学术机构 ──
  { name: "bair", url: "https://bair.berkeley.edu/blog/feed.xml", label: "BAIR (Berkeley AI)" },
  // ── AI 科技巨头 ──
  { name: "openai", url: "https://openai.com/news/rss.xml", label: "OpenAI Blog" },
  { name: "apple_ml", url: "https://machinelearning.apple.com/rss.xml", label: "Apple ML Research" },
  { name: "huggingface", url: "https://huggingface.co/blog/feed.xml", label: "HuggingFace Blog" },
  // ── AI 基础设施与工程 ──
  { name: "nvidia_tech", url: "https://developer.nvidia.com/blog/feed", label: "NVIDIA Tech Blog" },
  { name: "nvidia", url: "https://blogs.nvidia.com/feed/", label: "NVIDIA Blog" },
  { name: "aws_ml", url: "https://aws.amazon.com/blogs/machine-learning/feed/", label: "AWS ML Blog" },
  { name: "github_eng", url: "https://github.blog/engineering/feed/", label: "GitHub Engineering" },
  // ── AI 日报通讯 ──
  { name: "tldr_ai", url: "https://tldr.tech/api/rss/ai", label: "TLDR AI" },
  { name: "import_ai", url: "https://importai.substack.com/feed", label: "Import AI" },
  { name: "aws_china", url: "https://aws.amazon.com/cn/blogs/china/feed/", label: "AWS 中国博客" },
];

// ── date helpers ──────────────────────────────────────────────

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** Parse various date formats to YYYY-MM-DD (port of rss_parser._parse_date). */
function parseDate(dateStr: string): string | null {
  if (!dateStr) return null;
  // ISO 8601 first
  if (dateStr.includes("T")) return dateStr.slice(0, 10);
  // RFC 2822 (used by RSS 2.0), e.g. "Sat, 27 Jun 2026 10:00:00 GMT" —
  // extract wall-time date parts to avoid timezone shifting.
  const m = dateStr.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month) return `${m[3]}-${month}-${m[1].padStart(2, "0")}`;
  }
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  // Fallback: just take first 10 chars
  return dateStr.length >= 10 ? dateStr.slice(0, 10) : null;
}

/** Parse date strings like '2026-06-26' / '2026-06-26T00:00:00' (port of stages._parse_date_loose). */
function parseDateLoose(dateStr: string): Date | null {
  if (!dateStr) return null;
  const m = dateStr.trim().slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

// ── stage 1: fetch RSS feeds (port of rss_parser.py) ──────────

type RawItem = { title: string; url: string; date: string | null; summary: string };

type FeedItem = {
  title?: string;
  link?: string;
  pubDate?: string;
  content?: string;
  summary?: string;
  updated?: string;
  description?: string;
};

const rssParser: Parser<Record<string, unknown>, FeedItem> = new Parser({
  customFields: { item: ["summary", "updated", "description"] },
});

/** Fetch and parse a single RSS/Atom feed. Returns list of raw items. */
async function fetchRssFeed(url: string, log: (msg: string) => void): Promise<RawItem[]> {
  const resp = await fetchWithTimeout(url, { headers: { "User-Agent": DEFAULT_UA } });
  if (!resp.ok) {
    log(`RSS fetch failed: ${url} (HTTP ${resp.status})`);
    return [];
  }
  const body = await resp.text();

  const feed = await rssParser.parseString(body);

  const items: RawItem[] = [];
  for (const entry of feed.items ?? []) {
    const title = (entry.title || "").trim();
    const link = (entry.link || "").trim();
    if (!title || !link) continue;

    // Date: try published, then updated
    const dateStr = entry.pubDate || entry.updated || "";
    const published = dateStr.includes("T") ? dateStr.slice(0, 10) : parseDate(dateStr);

    // Summary (rss-parser maps RSS <description> to `content`)
    const summary = (entry.summary || entry.content || entry.description || "").slice(0, 300);

    items.push({ title, url: link, date: published, summary });
  }

  if (items.length === 0) log(`No entries found in RSS feed: ${url}`);
  return items;
}

/** Fetch all configured RSS feeds and return unified BlogPost list. */
async function fetchAllFeeds(maxPerSource: number, log: (msg: string) => void): Promise<BlogPost[]> {
  const allPosts: BlogPost[] = [];

  for (let i = 0; i < RSS_SOURCES.length; i++) {
    const source = RSS_SOURCES[i];
    log(`Fetching RSS: ${source.label} (${source.url})`);
    try {
      const items = await fetchRssFeed(source.url, log);
      for (const item of items.slice(0, maxPerSource)) {
        if (!item.url || !item.title) continue;

        // Create unique slug from URL path
        let slugPart: string;
        try {
          const path = new URL(item.url).pathname.replace(/\/+$/, "");
          slugPart = path ? path.split("/").pop() || item.title : item.title;
        } catch {
          slugPart = item.title;
        }
        const slug = `${source.name}:${slugPart}`;

        allPosts.push({
          source: source.name,
          slug,
          url: item.url,
          title: item.title,
          date: item.date,
          sourceLabel: source.label,
          summary: item.summary,
        });
      }
      log(`  ${source.label}: ${items.length} posts found`);
    } catch (e) {
      log(`  ${source.label}: fetch failed: ${e}`);
    }

    // Be polite between feeds
    if (i < RSS_SOURCES.length - 1) await sleep(500);
  }

  log(`All RSS feeds: ${allPosts.length} total posts`);
  return allPosts;
}

// ── DB helpers (port of BlogPostRepository) ───────────────────

async function getAllKnownSlugs(): Promise<Set<string>> {
  const rows = await db.select({ slug: ascanBlogPosts.slug }).from(ascanBlogPosts);
  return new Set(rows.map((r) => r.slug));
}

/** All URLs in official_items — cross-pipeline dedup (port of get_all_official_urls). */
async function getAllOfficialUrls(): Promise<Set<string>> {
  const rows = await db.select({ url: ascanOfficialItems.url }).from(ascanOfficialItems);
  return new Set(rows.map((r) => r.url));
}

/** Insert a newly discovered post; if the slug exists, only bump last_seen_date. */
async function upsertDiscovered(post: BlogPost, today: string): Promise<void> {
  await db
    .insert(ascanBlogPosts)
    .values({
      source: post.slug.split(":")[0],
      slug: post.slug,
      url: post.url,
      title: post.title || "",
      date: post.date || "",
      sourceLabel: post.sourceLabel,
      summary: post.summary || "",
      firstSeenDate: today,
      lastSeenDate: today,
      analyzed: false,
    })
    .onConflictDoUpdate({
      target: ascanBlogPosts.slug,
      set: { lastSeenDate: today, updatedAtTs: new Date() },
    });
}

async function saveAnalysis(slug: string, analysis: BlogAnalysis): Promise<void> {
  await db
    .update(ascanBlogPosts)
    .set({
      oneLiner: analysis.oneLiner,
      summaryCn: analysis.summaryCn,
      relevance: analysis.relevance,
      analyzed: true,
      updatedAtTs: new Date(),
    })
    .where(eq(ascanBlogPosts.slug, slug));
}

// ── stage 2: LLM analysis (port of analyzer.py) ───────────────

function buildBlogPrompt(post: BlogPost): string {
  const contentPreview = (post.summary || "").slice(0, 1500);

  return `你是一位技术内容编辑。请为以下技术博客文章生成中文摘要，输出JSON格式。

## 文章信息
- 标题：${post.title || "未知"}
- 日期：${post.date || "未知"}
- 来源：${post.sourceLabel}
- 摘要：${post.summary || ""}
- 内容摘要：${contentPreview}

## 输出要求
请输出严格的 JSON 对象，包含以下字段：
- one_liner: 用大白话说清这篇博客讲了什么（中文，≤30字）
- summary_cn: 中文摘要/翻译（2-3句）

只输出 JSON，不要其他内容。`;
}

/** Analyze a single post (retry/JSON repair handled by chatJsonRetry). */
async function analyzePost(ctx: ModuleContext, post: BlogPost): Promise<BlogAnalysis | null> {
  try {
    const data = await ctx.llm.chatJsonRetry<Record<string, any>>(buildBlogPrompt(post));
    return {
      oneLiner: data.one_liner ?? "",
      summaryCn: data.summary_cn ?? "",
      relevance: "一般",
    };
  } catch (e) {
    ctx.log(`LLM analysis failed for ${post.slug}: ${e}`);
    return null;
  }
}

// ── stage 3: rendering (port of report.py) ────────────────────

const HTML_TAG_RE = /<[^>]*>/g;

/** Strip HTML tags and truncate to a readable one-liner. */
function cleanSummary(text: string, maxLen = 120): string {
  let t = (text || "").replace(HTML_TAG_RE, "");
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > maxLen) {
    const cut = t.slice(0, maxLen);
    const idx = cut.lastIndexOf(" ");
    t = (idx > 0 ? cut.slice(0, idx) : cut) + "...";
  }
  return t;
}

/** One-line summary for a post: LLM analysis first, RSS summary fallback. */
function summaryLine(post: BlogPost, analysis: BlogAnalysis | null | undefined): string {
  return analysis?.oneLiner || analysis?.summaryCn.slice(0, 80) || cleanSummary(post.summary || "");
}

function groupBySourceLabel(posts: BlogPost[]): Map<string, BlogPost[]> {
  const grouped = new Map<string, BlogPost[]>();
  for (const post of posts) {
    const list = grouped.get(post.sourceLabel) ?? [];
    list.push(post);
    grouped.set(post.sourceLabel, list);
  }
  return grouped;
}

function blogsToDailyHtml(posts: BlogPost[], analyses: Map<string, BlogAnalysis | null>): string {
  if (!posts.length) return '<p class="empty-state">今日无独立博客更新。</p>';

  const lines: string[] = [`<div class="report-list blog-list">`];
  lines.push(`<p class="section-note">共 ${posts.length} 篇新文章（30 天内）。</p>`);

  for (const [sourceLabel, srcPosts] of groupBySourceLabel(posts)) {
    lines.push(`<h3>${escapeHtml(sourceLabel)}</h3>`);
    for (const post of srcPosts) {
      const titleDisplay = (post.title || post.slug).slice(0, 120);
      const dateStr = post.date || "";
      const summary = summaryLine(post, analyses.get(post.slug));

      lines.push('<article class="card">');
      lines.push(`<h4><a href="${escapeHtml(post.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(titleDisplay)}</a></h4>`);
      const metaParts: string[] = [];
      metaParts.push(`<strong>来源：${escapeHtml(sourceLabel)}</strong>`);
      if (dateStr) metaParts.push(`日期：${escapeHtml(dateStr)}`);
      lines.push(`<p class="meta">${metaParts.join(" · ")}</p>`);
      if (summary) {
        lines.push(`<p>${escapeHtml(summary)}</p>`);
      }
      lines.push(`<p class="links"><a href="${escapeHtml(post.url)}" target="_blank" rel="noopener noreferrer">阅读原文</a></p>`);
      lines.push("</article>");
    }
  }

  lines.push("</div>");
  return lines.join("\n");
}

function blogsToDailyMd(posts: BlogPost[], analyses: Map<string, BlogAnalysis | null>): string {
  if (!posts.length) return "_今日无独立博客更新。_";

  const lines: string[] = [];
  lines.push(`共 ${posts.length} 篇新文章（30 天内）。`);
  lines.push("");

  for (const [sourceLabel, srcPosts] of groupBySourceLabel(posts)) {
    lines.push(`### ${sourceLabel}`);
    lines.push("");
    for (const post of srcPosts) {
      const dateStr = post.date || "";
      const titleDisplay = (post.title || post.slug).slice(0, 120);
      const summary = summaryLine(post, analyses.get(post.slug));

      lines.push(`#### [${titleDisplay}](${post.url})`);
      lines.push("");
      const metaParts: string[] = [`**来源：** ${sourceLabel}`];
      if (dateStr) metaParts.push(`**日期：** ${dateStr}`);
      lines.push(metaParts.join(" · "));
      if (summary) lines.push(`> ${summary}`);
      lines.push(`**链接：** [阅读原文](${post.url})`);
      lines.push("");
      lines.push("---");
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ── module entry point (port of stages.py) ────────────────────

export async function run(ctx: ModuleContext): Promise<ModuleResult> {
  // ── Stage 1: Fetch ──────────────────────────────────────────
  const [knownSlugs, officialUrls] = await Promise.all([
    getAllKnownSlugs(),
    getAllOfficialUrls(),
  ]);
  const today = ctx.dateCompact;
  const cutoff = new Date(Date.now() - DAYS_RECENT * 24 * 60 * 60 * 1000);

  const maxPerSource = ctx.config.blog_max_per_source || 2;
  const allPosts = await fetchAllFeeds(maxPerSource, ctx.log);

  // Filter: new + within 30 days + not in official tracker
  const newPosts: BlogPost[] = [];
  let skippedOld = 0;
  let skippedDup = 0;
  for (const post of allPosts) {
    if (knownSlugs.has(post.slug)) continue;
    if (officialUrls.has(post.url)) {
      skippedDup++;
      continue;
    }
    const postDate = parseDateLoose(post.date || "");
    if (postDate && postDate < cutoff) {
      skippedOld++;
      continue;
    }
    newPosts.push(post);
  }

  if (skippedOld) ctx.log(`跳过了 ${skippedOld} 篇超过 ${DAYS_RECENT} 天的旧文章`);
  if (skippedDup) ctx.log(`跳过了 ${skippedDup} 篇与官方动态重复的博客文章`);

  // Upsert new posts to DB
  for (const post of newPosts) {
    await upsertDiscovered(post, today);
  }

  if (newPosts.length > 0) {
    ctx.log(`发现 ${newPosts.length} 篇新博客文章（共 ${allPosts.length} 篇已知）`);
  } else {
    ctx.log(`无新博客文章（${allPosts.length} 篇全部已读）`);
  }

  // ── Stage 3 (empty-state short-circuit) ─────────────────────
  if (newPosts.length === 0) {
    ctx.log("无博客帖子，使用占位符");
    return {
      html: '<p class="empty-state">今日无独立博客更新。</p>',
      md: "_今日无独立博客更新。_",
      count: 0,
    };
  }

  // ── Stage 2: Analyze (LLM) ──────────────────────────────────
  const analyses = new Map<string, BlogAnalysis | null>();
  const toAnalyze = newPosts; // 全部为新条目，无缓存可恢复
  ctx.log(`Analyze: ${toAnalyze.length} posts need LLM`);

  if (!ctx.llm.isConfigured) {
    ctx.log("LLM 未配置，跳过博客分析（使用 RSS 摘要兜底）");
  } else {
    const results = await ctx.llm.mapConcurrent(
      toAnalyze,
      async (post) => ({ slug: post.slug, analysis: await analyzePost(ctx, post) }),
      (post) => ({ slug: post.slug, analysis: null as BlogAnalysis | null }),
      (done, total) => ctx.log(`博客分析进度 ${done}/${total}`),
    );

    for (const { slug, analysis } of results) {
      analyses.set(slug, analysis);
      if (analysis) {
        try {
          await saveAnalysis(slug, analysis);
        } catch (e) {
          ctx.log(`Failed to save analysis for ${slug}: ${e}`);
        }
      }
    }
  }

  let successCount = 0;
  for (const a of analyses.values()) if (a) successCount++;
  ctx.log(`Analysis done: ${successCount}/${newPosts.length} (${toAnalyze.length} LLM calls)`);

  // ── Stage 3: Build Fragment ─────────────────────────────────
  const html = blogsToDailyHtml(newPosts, analyses);
  const md = blogsToDailyMd(newPosts, analyses);
  ctx.log(`博客 HTML+MD 片段已生成 (HTML: ${html.length} chars, ${newPosts.length} 篇)`);

  return { html, md, count: newPosts.length };
}
