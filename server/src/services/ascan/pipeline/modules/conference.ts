/**
 * Conference paper tracking module — TS port of ascan/src/conf_tracker/
 * (fetcher.py + analyzer.py + report.py + stages.py + models.py).
 *
 * Data sources:
 * - papers.cool (primary): https://papers.cool/venue/{Name}.{Year}?show={count}
 *   Rich fields: title, authors, keywords, abstract, PDF, type (Oral/Poster).
 * - DBLP (fallback): https://dblp.org/search/publ/api
 *   Fields: title, authors, DOI, URL (no abstract, no keywords).
 *
 * Flow: load CCF conference config → fetch papers.cool + DBLP → merge +
 * topic filter → cross-module DOI dedup + recency filter → DB upsert →
 * LLM analysis (DB-cached) → HTML/MD fragment.
 */
import { readFile } from "fs/promises";
import { createHash } from "crypto";
import * as cheerio from "cheerio";
import { parse as parseYaml } from "yaml";
import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { db } from "../../../../db/client.js";
import { ascanConferencePapers, ascanPapers } from "../../../../db/schema.js";
import { sleep, fetchWithTimeout, escapeHtml, DEFAULT_UA } from "../util.js";
import { RECOMMENDATION_ORDER } from "../scoring.js";
import type { ModuleContext, ModuleResult } from "../types.js";

// ── constants (fetcher.py) ────────────────────────────────────

const DBLP_BASE = "https://dblp.org/search/publ/api";
const PAPERS_COOL_BASE = "https://papers.cool/venue";

const CCF_YAML_URL = process.env.ASCAN_DATA_DIR
  ? new URL(`file://${process.env.ASCAN_DATA_DIR}/ccf_conferences.yaml`)
  : new URL("../data/ccf_conferences.yaml", import.meta.url);

// Defaults mirroring ascan/src/config/settings.py (these keys are not part of
// the shared config.schema.json surface, so they are fixed constants here).
const DEFAULT_TOPICS = [
  "large language model", "LLM", "transformer",
  "agent", "multi-agent", "agentic",
  "reasoning", "planning", "chain of thought",
  "retrieval augmented", "RAG", "memory",
  "tool calling", "function calling", "MCP",
  "alignment", "safety", "multimodal",
  "scaling", "fine-tuning", "reinforcement learning",
];
const DEFAULT_MAX_PAPERS_PER_VENUE = 50;
const DEFAULT_MAX_TOTAL = 20;
const DEFAULT_DAYS_RECENT = 90;

// ── models (models.py) ────────────────────────────────────────

interface ConferencePaper {
  paperKey: string;
  title: string;
  authors: string[];
  abstract: string | null;
  keywords: string;
  paperType: string;
  venue: string;
  venueFullName: string;
  rank: string;
  category: string;
  year: number | null;
  publicationDate: string | null;
  doi: string | null;
  url: string | null;
  pdfUrl: string | null;
  citationCount: number;
  tldr: string | null;
  source: string;
}

interface ConferenceAnalysis {
  oneLiner: string;
  summaryCn: string;
  keywords: string[];
  coreRecommendation: string;
  relevance: string;
}

interface ConferenceConfig {
  name: string;
  full_name?: string;
  rank: string;
  category?: string;
  dblp_key: string;
  papers_cool_venue?: string;
}

// ── conference config loading (fetcher.load_ccf_conferences) ──

async function loadCcfConferences(
  rankFilter: string[],
  categoryFilter: string[],
): Promise<ConferenceConfig[]> {
  const raw = await readFile(CCF_YAML_URL, "utf-8");
  const data = parseYaml(raw) as { conferences?: ConferenceConfig[] } | null;
  let conferences = data?.conferences ?? [];
  if (rankFilter.length) {
    conferences = conferences.filter((c) => rankFilter.includes(c.rank));
  }
  if (categoryFilter.length) {
    conferences = conferences.filter((c) => categoryFilter.includes(c.category ?? ""));
  }
  return conferences;
}

function makePaperKey(doi: string | null, title: string): string {
  if (doi) return `doi:${doi.toLowerCase()}`;
  const hash = createHash("md5").update(title.toLowerCase().trim()).digest("hex").slice(0, 16);
  return `hash:${hash}`;
}

// ── papers.cool (fetcher.fetch_papers_cool) ───────────────────

/** Collect the direct child text nodes (XPath `text()` semantics) of a selection, in order. */
function directTextNodes(sel: cheerio.Cheerio<any>): string[] {
  const out: string[] = [];
  sel.each((_, el) => {
    for (const node of (el as any).children ?? []) {
      if (node.type === "text" && typeof node.data === "string") out.push(node.data);
    }
  });
  return out;
}

async function fetchPapersCool(
  conf: ConferenceConfig,
  year: number,
  maxPapers: number,
  log: (msg: string) => void,
): Promise<ConferencePaper[]> {
  const venueName = conf.papers_cool_venue || conf.name;
  const url = `${PAPERS_COOL_BASE}/${venueName}.${year}?show=${maxPapers}`;

  try {
    const resp = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": DEFAULT_UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (resp.status !== 200) {
      log(`papers.cool ${conf.name} ${year}: HTTP ${resp.status}`);
      return [];
    }
    const text = await resp.text();

    // Detect corporate proxy block (域名拦截 page is < 2KB)
    if (text.length < 5000 && text.includes("域名拦截")) {
      log(`papers.cool blocked by corporate proxy for ${conf.name}`);
      return [];
    }

    const $ = cheerio.load(text);
    const container = $('[class="papers"]').first();
    if (!container.length) {
      log(`papers.cool ${conf.name} ${year}: no papers container found`);
      return [];
    }

    const papers: ConferencePaper[] = [];
    container.children().each((_, childEl) => {
      const child = $(childEl);

      const titleTexts = directTextNodes(child.find('h2[class="title"] a'));
      const title = (titleTexts[0] ?? "").trim();
      if (!title) return;

      const authors = child
        .find('p[class*="metainfo"][class*="authors"] a')
        .map((_, a) => $(a).text().trim())
        .get()
        .filter((a) => a);

      const keywords = child.attr("keywords") ?? "";

      const absTexts = directTextNodes(child.find('p[class*="summary"]'));
      const abstract = (absTexts[0] ?? "").trim();

      const pdfUrl = child.find('h2[class="title"] a[class*="title-pdf"]').first().attr("data") ?? null;
      const absUrl = child.find('h2[class="title"] a').first().attr("href") ?? null;

      const paperType = child.find('p[class*="metainfo"][class*="subjects"] a').first().text().trim();

      let doi: string | null = null;
      if (absUrl && absUrl.includes("doi.org")) {
        const parts = absUrl.split("doi.org/");
        doi = parts[parts.length - 1];
      }

      papers.push({
        paperKey: makePaperKey(doi, title),
        title,
        authors,
        abstract: abstract || null,
        keywords,
        paperType,
        venue: conf.name,
        venueFullName: conf.full_name ?? "",
        rank: conf.rank,
        category: conf.category ?? "",
        year,
        publicationDate: `${year}`,
        doi,
        url: absUrl,
        pdfUrl,
        citationCount: 0,
        tldr: null,
        source: "papers_cool",
      });
    });

    log(`papers.cool ${conf.name} ${year}: ${papers.length} papers found`);
    return papers;
  } catch (e) {
    log(`papers.cool error for ${conf.name} ${year}: ${e}`);
    return [];
  }
}

// ── DBLP (fetcher.fetch_dblp) ─────────────────────────────────

async function fetchDblp(
  conf: ConferenceConfig,
  year: number,
  log: (msg: string) => void,
): Promise<ConferencePaper[]> {
  const dblpKey = conf.dblp_key;
  const yearsToQuery = [year, year - 1];

  const allPapers: ConferencePaper[] = [];
  for (const y of yearsToQuery) {
    const params = new URLSearchParams({
      q: `toc:db/conf/${dblpKey}/${dblpKey}${y}.bht:`,
      format: "json",
      h: "500",
    });
    try {
      const resp = await fetchWithTimeout(`${DBLP_BASE}?${params}`, { headers: { "User-Agent": DEFAULT_UA } });
      if (resp.status !== 200) {
        log(`DBLP ${conf.name} ${y}: HTTP ${resp.status}`);
        continue;
      }

      const data: any = await resp.json();
      const hits: any[] = data?.result?.hits?.hit ?? [];
      for (const hit of hits) {
        const info = hit?.info ?? {};
        const title = String(info.title ?? "").trim();
        if (!title) continue;

        const doi: string | null = info.doi ?? null;
        const paperKey = makePaperKey(doi, title);

        let authorsRaw = info.authors?.author ?? [];
        if (!Array.isArray(authorsRaw)) authorsRaw = [authorsRaw];
        const authors = authorsRaw.map((a: any) =>
          a && typeof a === "object" ? String(a.text ?? a) : String(a),
        );

        let ee = info.ee;
        if (Array.isArray(ee)) ee = ee.length ? ee[0] : null;

        allPapers.push({
          paperKey,
          title,
          authors,
          abstract: null,
          keywords: "",
          paperType: "",
          venue: conf.name,
          venueFullName: conf.full_name ?? "",
          rank: conf.rank,
          category: conf.category ?? "",
          year: y,
          publicationDate: `${y}`,
          doi,
          url: ee || (doi ? `https://doi.org/${doi}` : null),
          pdfUrl: null,
          citationCount: 0,
          tldr: null,
          source: "dblp",
        });
      }
      log(`DBLP ${conf.name} ${y}: ${hits.length} papers`);
    } catch (e) {
      log(`DBLP error for ${conf.name} ${y}: ${e}`);
    }
  }

  log(`DBLP ${conf.name} total: ${allPapers.length} papers`);
  return allPapers;
}

// ── merge + topic filter (fetcher.py) ─────────────────────────

function mergeSources(
  pcPapers: ConferencePaper[],
  dblpPapers: ConferencePaper[],
  log: (msg: string) => void,
): ConferencePaper[] {
  // papers.cool preferred (has abstracts).
  const seen = new Map<string, ConferencePaper>();
  for (const p of pcPapers) seen.set(p.paperKey, p);
  for (const p of dblpPapers) {
    if (!seen.has(p.paperKey)) seen.set(p.paperKey, p);
  }
  log(`Merge: papers.cool=${pcPapers.length}, DBLP=${dblpPapers.length}, unique=${seen.size}`);
  return [...seen.values()];
}

function filterByTopics(papers: ConferencePaper[], topics: string[]): ConferencePaper[] {
  if (!topics.length) return papers;
  const topicsLower = topics.map((t) => t.toLowerCase());
  return papers.filter((p) => {
    const text = `${p.title} ${p.abstract ?? ""} ${p.keywords}`.toLowerCase();
    return topicsLower.some((t) => text.includes(t));
  });
}

async function fetchAllConferences(
  conferences: ConferenceConfig[],
  log: (msg: string) => void,
): Promise<ConferencePaper[]> {
  const maxPerVenue = DEFAULT_MAX_PAPERS_PER_VENUE;
  const topics = DEFAULT_TOPICS;
  const currentYear = new Date().getFullYear();

  const allPc: ConferencePaper[] = [];
  const allDblp: ConferencePaper[] = [];

  // Phase 1: papers.cool (primary, rich data) — current year only
  for (const conf of conferences) {
    const pcPapers = await fetchPapersCool(conf, currentYear, maxPerVenue * 10, log);
    allPc.push(...pcPapers);
    await sleep(300);
  }

  // Phase 2: DBLP (fallback, for conferences not covered by papers.cool)
  const pcVenues = new Set(allPc.map((p) => p.venue));
  for (let i = 0; i < conferences.length; i++) {
    const conf = conferences[i];
    if (pcVenues.has(conf.name) && allPc.length) continue; // already have papers.cool data
    const dblpPapers = await fetchDblp(conf, currentYear, log);
    allDblp.push(...dblpPapers);
    if (i < conferences.length - 1) await sleep(500);
  }

  const merged = mergeSources(allPc, allDblp, log);
  const filtered = filterByTopics(merged, topics);
  log(`Conference papers: ${merged.length} total → ${filtered.length} after topic filter`);

  return filtered.slice(0, DEFAULT_MAX_TOTAL);
}

// ── LLM analysis (analyzer.py) ────────────────────────────────

const PROMPT_TEMPLATE_ZH = `你是一位 AI 领域的学术论文分析专家。请分析以下会议论文，生成中文摘要和评估。

论文信息：
- 标题：{title}
- 会议：{venue} ({rank}类, {category})
- 作者：{authors}
- 摘要：{abstract}

请严格输出 JSON（不要包含 markdown 代码块标记）：
{
  "one_liner": "一句话中文概括（20字以内）",
  "summary_cn": "中文摘要翻译+核心贡献（150字以内）",
  "keywords": ["关键词1", "关键词2", "关键词3"],
  "core_recommendation": "核心推荐语，说明为什么值得关注和与AI前沿的关联（50字以内）",
  "relevance": "极度推荐/很推荐/推荐/一般推荐/不推荐"
}

relevance 判断标准：
- 极度推荐：突破性成果，对大模型/Agent/智能体架构有重大影响
- 很推荐：重要创新，对AI前沿有显著贡献
- 推荐：有价值的研究，有一定参考价值
- 一般推荐：相关性较低或增量改进
- 不推荐：与关注方向无关`;

const PROMPT_TEMPLATE_EN = `You are an expert academic paper analyst in the AI field. Analyze the following conference paper and generate a summary and assessment.

Paper info:
- Title: {title}
- Venue: {venue} (Rank {rank}, {category})
- Authors: {authors}
- Abstract: {abstract}

Output strictly as JSON (no markdown code block markers):
{
  "one_liner": "one-liner summary (max 20 words)",
  "summary_cn": "English summary + core contribution (max 150 words)",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "core_recommendation": "why it's worth attention and its relevance to AI frontier (max 50 words)",
  "relevance": "Highly Recommended/Recommended/Worth Reading/Moderately Recommended/Not Recommended"
}

relevance criteria:
- Highly Recommended: breakthrough results, major impact on LLM/Agent/Agent Architecture
- Recommended: important innovation, significant contribution to AI frontier
- Worth Reading: valuable research, some reference value
- Moderately Recommended: lower relevance or incremental improvement
- Not Recommended: unrelated to focus areas`;

const FAILED_ANALYSIS: ConferenceAnalysis = {
  oneLiner: "[分析失败]",
  summaryCn: "",
  keywords: [],
  coreRecommendation: "",
  relevance: "不推荐",
};

function buildPrompt(paper: ConferencePaper, language: "zh" | "en"): string {
  const template = language === "en" ? PROMPT_TEMPLATE_EN : PROMPT_TEMPLATE_ZH;
  const authors = paper.authors.slice(0, 5).join(", ") + (paper.authors.length > 5 ? "..." : "");
  return template
    .replace("{title}", paper.title)
    .replace("{venue}", paper.venue)
    .replace("{rank}", paper.rank)
    .replace("{category}", paper.category)
    .replace("{authors}", authors)
    .replace("{abstract}", paper.abstract || (language === "en" ? "(No abstract)" : "（无摘要）"));
}

async function analyzePapersBatch(
  papers: ConferencePaper[],
  ctx: ModuleContext,
): Promise<Map<string, ConferenceAnalysis>> {
  const lang = ctx.language || "zh";
  const results = await ctx.llm.mapConcurrent<ConferencePaper, [string, ConferenceAnalysis]>(
    papers,
    async (paper) => {
      const data = await ctx.llm.chatJsonRetry<any>(buildPrompt(paper, lang));
      return [paper.paperKey, {
        oneLiner: data?.one_liner ?? "",
        summaryCn: data?.summary_cn ?? "",
        keywords: Array.isArray(data?.keywords) ? data.keywords : [],
        coreRecommendation: data?.core_recommendation ?? "",
        relevance: data?.relevance ?? "一般推荐",
      }];
    },
    (paper, err) => {
      ctx.log(`LLM analysis failed for ${paper.paperKey}: ${err}`);
      return [paper.paperKey, { ...FAILED_ANALYSIS }];
    },
  );

  const analyses = new Map<string, ConferenceAnalysis>(results);
  const success = [...analyses.values()].filter((a) => a.oneLiner !== "[分析失败]").length;
  ctx.log(`Conference analysis: ${success}/${papers.length} succeeded`);
  return analyses;
}

// ── report rendering (report.py) ──────────────────────────────

function sortPapers(
  papers: ConferencePaper[],
  analyses: Map<string, ConferenceAnalysis>,
): ConferencePaper[] {
  const sortKey = (p: ConferencePaper): number => {
    const a = analyses.get(p.paperKey);
    return a ? (RECOMMENDATION_ORDER[a.relevance] ?? 0) : 0;
  };
  // Stable sort by recommendation level (descending).
  return [...papers].sort((a, b) => sortKey(b) - sortKey(a));
}

function authorsLabel(paper: ConferencePaper): string {
  let s = paper.authors.slice(0, 5).join(", ");
  if (paper.authors.length > 5) s += ` 等 (${paper.authors.length} 人)`;
  return s;
}

function confPapersToHtml(
  papers: ConferencePaper[],
  analyses: Map<string, ConferenceAnalysis>,
  dateCompact: string,
  language: "zh" | "en" = "zh",
): string {
  if (!papers.length) return language === "en" ? '<p class="empty-state">No recent conference papers.</p>' : '<p class="empty-state">近期无新会议论文。</p>';

  const L = language === "en"
    ? {
        total: (n: number) => `${n} papers`,
        classA: (n: number) => `Class A ${n}`,
        classB: (n: number) => `Class B ${n}`,
        authors: "Authors:",
        oneLiner: "Summary:",
        summary: "Abstract",
        generating: "Abstract generating...",
        coreRec: "Core Recommendation:",
      }
    : {
        total: (n: number) => `共 ${n} 篇论文`,
        classA: (n: number) => `A 类 ${n} 篇`,
        classB: (n: number) => `B 类 ${n} 篇`,
        authors: "作者：",
        oneLiner: "一句话总结：",
        summary: "中文摘要",
        generating: "中文摘要生成中...",
        coreRec: "核心推荐：",
      };

  const sortedPapers = sortPapers(papers, analyses);

  const aCount = papers.filter((p) => p.rank === "A").length;
  const bCount = papers.filter((p) => p.rank === "B").length;

  const parts: string[] = [
    '<div class="conf-stats">' +
      `<span class="stat-chip">${L.total(papers.length)}</span>` +
      `<span class="stat-chip stat-a">${L.classA(aCount)}</span>` +
      `<span class="stat-chip stat-b">${L.classB(bCount)}</span>` +
      "</div>",
    `<div class="report-list conf-list" data-date="${dateCompact}">`,
  ];

  sortedPapers.forEach((paper, i) => {
    const idx = i + 1;
    const analysis = analyses.get(paper.paperKey);
    const oneLiner = analysis?.oneLiner ?? "";
    const summaryCn = analysis?.summaryCn ?? "";
    const keywords = analysis?.keywords?.length ? analysis.keywords : [];
    const coreRec = analysis?.coreRecommendation ?? "";
    const relevance = analysis?.relevance ?? "";

    const authorsStr = authorsLabel(paper);

    // Venue + rank + type badges
    const badges = [`<span class="tag tag-venue">${escapeHtml(paper.venue)} ${paper.year ?? ""}</span>`];
    if (paper.rank === "A") {
      badges.push('<span class="tag tag-rank-a">CCF-A</span>');
    } else {
      badges.push('<span class="tag tag-rank-b">CCF-B</span>');
    }
    if (paper.paperType) {
      badges.push(`<span class="tag tag-type">${escapeHtml(paper.paperType)}</span>`);
    }
    if (relevance && relevance !== "不推荐") {
      badges.push(`<span class="tag tag-relevance">${escapeHtml(relevance)}</span>`);
    }

    // Keyword tags
    let kwTags = "";
    if (keywords.length) {
      kwTags =
        '<div class="tags">' +
        keywords.slice(0, 5).map((kw) => `<span class="tag">${escapeHtml(kw)}</span>`).join("") +
        "</div>";
    }

    // Links
    const links: string[] = [];
    if (paper.url) {
      links.push(`<a href="${escapeHtml(paper.url)}" target="_blank" rel="noopener noreferrer">Abstract</a>`);
    }
    if (paper.pdfUrl) {
      links.push(`<a href="${escapeHtml(paper.pdfUrl)}" target="_blank" rel="noopener noreferrer">PDF</a>`);
    }
    const linksHtml = links.join(" · ");

    // Summary block (Chinese abstract)
    const summaryBlock = summaryCn
      ? '<section class="summary-block">' +
        `<h4>${L.summary}</h4>` +
        `<p>${escapeHtml(summaryCn)}</p>` +
        "</section>"
      : '<section class="summary-block">' +
        `<h4>${L.summary}</h4>` +
        `<p class="muted">${L.generating}</p>` +
        "</section>";

    // Core recommendation
    const recHtml = coreRec
      ? `<p class="recommendation"><strong>${L.coreRec}</strong>${escapeHtml(coreRec)}</p>`
      : "";

    parts.push(
      '<article class="card paper-card">' +
        `<h3>${idx}. ${escapeHtml(paper.title)}</h3>` +
        `<p class="meta"><strong>${L.authors}</strong>${escapeHtml(authorsStr)}</p>` +
        `<div class="tags">${badges.join("")}</div>` +
        kwTags +
        `<p><strong>${L.oneLiner}</strong>${escapeHtml(oneLiner)}</p>` +
        (linksHtml ? `<p class="links">${linksHtml}</p>` : "") +
        summaryBlock +
        recHtml +
        "</article>",
    );
  });

  parts.push("</div>");
  return parts.join("\n");
}

function confPapersToMd(
  papers: ConferencePaper[],
  analyses: Map<string, ConferenceAnalysis>,
  _dateCompact: string,
  language: "zh" | "en" = "zh",
): string {
  if (!papers.length) return language === "en" ? "_No recent conference papers._" : "_近期无新会议论文。_";

  const L = language === "en"
    ? { total: (n: number) => `${n} papers`, classA: (n: number) => `Class A ${n}`, classB: (n: number) => `Class B ${n}`, authors: "Authors:", venue: "Venue:", keywords: "Keywords:", oneLiner: "Summary:", links: "Links:", generating: "Abstract generating...", coreRec: "Core Recommendation:" }
    : { total: (n: number) => `共 ${n} 篇`, classA: (n: number) => `A 类 ${n} 篇`, classB: (n: number) => `B 类 ${n} 篇`, authors: "作者：", venue: "会议：", keywords: "关键词：", oneLiner: "一句话总结：", links: "链接：", generating: "中文摘要生成中...", coreRec: "核心推荐：" };

  const sortedPapers = sortPapers(papers, analyses);

  const aCount = papers.filter((p) => p.rank === "A").length;
  const bCount = papers.filter((p) => p.rank === "B").length;

  const lines: string[] = [`> ${L.total(papers.length)} | ${L.classA(aCount)} | ${L.classB(bCount)}`, ""];

  sortedPapers.forEach((paper, i) => {
    const idx = i + 1;
    const analysis = analyses.get(paper.paperKey);
    const oneLiner = analysis?.oneLiner ?? "";
    const summaryCn = analysis?.summaryCn ?? "";
    const keywords = analysis?.keywords?.length ? analysis.keywords : [];
    const coreRec = analysis?.coreRecommendation ?? "";

    const authorsStr = authorsLabel(paper);

    lines.push(`### ${idx}. ${paper.title}`);
    lines.push("");
    lines.push(`**${L.authors}** ${authorsStr}`);
    lines.push(
      `**${L.venue}** ${paper.venue} ${paper.year ?? ""} (${paper.rank})` +
        (paper.paperType ? ` · ${paper.paperType}` : ""),
    );
    if (keywords.length) {
      const kwStr = keywords.slice(0, 5).map((kw) => `\`${kw}\``).join(" ");
      lines.push(`**${L.keywords}** ${kwStr}`);
    }
    if (oneLiner) {
      lines.push(`**${L.oneLiner}** ${oneLiner}`);
    }

    const links: string[] = [];
    if (paper.url) links.push(`[Abstract](${paper.url})`);
    if (paper.pdfUrl) links.push(`[PDF](${paper.pdfUrl})`);
    if (links.length) lines.push(`**${L.links}** ${links.join(" · ")}`);

    lines.push("");
    lines.push(summaryCn ? `> ${summaryCn}` : `> _${L.generating}_`);

    if (coreRec) lines.push(`> **${L.coreRec}** ${coreRec}`);

    lines.push("");
    lines.push("---");
    lines.push("");
  });

  return lines.join("\n");
}

// ── DB helpers (repositories.py semantics) ────────────────────

async function getAnalyzedKeys(): Promise<Set<string>> {
  const rows = await db
    .select({ paperKey: ascanConferencePapers.paperKey })
    .from(ascanConferencePapers)
    .where(and(eq(ascanConferencePapers.analyzed, true), isNotNull(ascanConferencePapers.oneLiner)));
  return new Set(rows.map((r) => r.paperKey));
}

/** PaperRepository.get_all_dois — all DOIs already in the arxiv papers table. */
async function getArxivDois(): Promise<Set<string>> {
  const rows = await db
    .select({ doi: ascanPapers.doi })
    .from(ascanPapers)
    .where(and(isNotNull(ascanPapers.doi), ne(ascanPapers.doi, "")));
  return new Set(rows.map((r) => r.doi).filter((d): d is string => !!d));
}

/** ConferencePaperRepository.upsert_discovered */
async function upsertDiscovered(paper: ConferencePaper, today: string): Promise<void> {
  await db
    .insert(ascanConferencePapers)
    .values({
      paperKey: paper.paperKey,
      title: paper.title,
      authors: paper.authors,
      abstract: paper.abstract ?? "",
      venue: paper.venue,
      venueFullName: paper.venueFullName,
      rank: paper.rank,
      category: paper.category,
      year: paper.year ?? 0,
      publicationDate: paper.publicationDate ?? "",
      doi: paper.doi ?? "",
      url: paper.url ?? "",
      pdfUrl: paper.pdfUrl ?? "",
      citationCount: paper.citationCount,
      tldr: paper.tldr ?? "",
      keywords: paper.keywords ? paper.keywords.split(",") : [],
      paperType: paper.paperType,
      source: paper.source,
      firstSeenDate: today,
      lastSeenDate: today,
      analyzed: false,
    })
    .onConflictDoUpdate({
      target: ascanConferencePapers.paperKey,
      set: { lastSeenDate: today, citationCount: paper.citationCount },
    });
}

/** ConferencePaperRepository.save_analysis */
async function saveAnalysis(paperKey: string, analysis: ConferenceAnalysis): Promise<void> {
  await db
    .update(ascanConferencePapers)
    .set({
      oneLiner: analysis.oneLiner,
      summaryCn: analysis.summaryCn,
      keywords: analysis.keywords,
      coreContribution: analysis.coreRecommendation,
      relevance: analysis.relevance,
      analyzed: true,
    })
    .where(eq(ascanConferencePapers.paperKey, paperKey));
}

/** AnalyzeConfStage cache restore: load cached analyses for already-analyzed papers. */
async function loadCachedAnalyses(
  papers: ConferencePaper[],
  analyzedKeys: Set<string>,
): Promise<Map<string, ConferenceAnalysis>> {
  const analyses = new Map<string, ConferenceAnalysis>();
  const cachedKeys = papers.map((p) => p.paperKey).filter((k) => analyzedKeys.has(k));
  if (!cachedKeys.length) return analyses;

  const rows = await db
    .select()
    .from(ascanConferencePapers)
    .where(inArray(ascanConferencePapers.paperKey, cachedKeys));

  for (const row of rows) {
    if (row.analyzed && row.oneLiner) {
      analyses.set(row.paperKey, {
        oneLiner: row.oneLiner ?? "",
        summaryCn: row.summaryCn ?? "",
        keywords: Array.isArray(row.keywords) ? (row.keywords as string[]) : [],
        coreRecommendation: row.coreContribution ?? "",
        relevance: row.relevance ?? "一般推荐",
      });
    }
  }
  return analyses;
}

// ── module entry (stages.py: Fetch + Analyze + BuildFragment) ─

export async function run(ctx: ModuleContext): Promise<ModuleResult> {
  const { config, log } = ctx;

  // ── FetchConfStage ──
  const conferences = await loadCcfConferences(
    config.conference_rank_filter ?? [],
    config.conference_categories ?? [],
  );

  let newPapers: ConferencePaper[] = [];
  let analyzedKeys = new Set<string>();

  if (!conferences.length) {
    log("无会议配置，跳过会议论文抓取");
  } else {
    log(`加载 ${conferences.length} 个会议配置`);

    const allPapers = await fetchAllConferences(conferences, log);

    analyzedKeys = await getAnalyzedKeys();
    const today = ctx.dateCompact;

    // Cross-module DOI dedup: skip conference papers whose DOI is already
    // in the arxiv papers table (same paper, different venue).
    let arxivDois = new Set<string>();
    try {
      arxivDois = await getArxivDois();
    } catch (e) {
      log(`Failed to load arxiv DOIs for cross-module dedup: ${e}`);
    }

    // Recency filter: only keep papers published within last N days.
    const daysRecent: number = config.conference_days_recent ?? DEFAULT_DAYS_RECENT;
    const cutoff = new Date(Date.now() - daysRecent * 24 * 60 * 60 * 1000);

    // Don't filter by known_keys — show recent papers each day.
    // LLM analysis stage uses analyzedKeys cache to skip re-analyzing.
    let skippedDoiDup = 0;
    let skippedOld = 0;
    for (const paper of allPapers) {
      if (paper.doi && arxivDois.has(paper.doi)) {
        skippedDoiDup++;
        continue;
      }
      const pubDateStr = (paper.publicationDate ?? "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(pubDateStr)) {
        const pubDt = new Date(`${pubDateStr}T00:00:00`);
        if (!isNaN(pubDt.getTime()) && pubDt < cutoff) {
          skippedOld++;
          continue;
        }
      } else if (/^\d{4}$/.test(pubDateStr)) {
        // 数据源（papers.cool/DBLP）仅提供年份粒度，只能按年份粗过滤：
        // 论文年份早于 cutoff 所在年份即视为过旧。
        if (Number(pubDateStr) < cutoff.getFullYear()) {
          skippedOld++;
          continue;
        }
      }
      // keep papers with unparseable dates
      newPapers.push(paper);
    }

    if (skippedDoiDup) log(`跳过 ${skippedDoiDup} 篇与 arXiv DOI 重复的会议论文`);
    if (skippedOld) log(`跳过 ${skippedOld} 篇超过 ${daysRecent} 天的旧会议论文`);

    for (const paper of newPapers) {
      try {
        await upsertDiscovered(paper, today);
      } catch (e) {
        log(`DB upsert failed for ${paper.paperKey}: ${e}`);
      }
    }

    const aCount = newPapers.filter((p) => p.rank === "A").length;
    const bCount = newPapers.filter((p) => p.rank === "B").length;
    if (newPapers.length) {
      log(`会议论文: 发现 ${newPapers.length} 篇（A 类 ${aCount} 篇，B 类 ${bCount} 篇，最近 ${daysRecent} 天）`);
    } else {
      log(`无符合条件的会议论文（共 ${allPapers.length} 篇，全部被 DOI 去重或时效过滤跳过）`);
    }
  }

  // ── AnalyzeConfStage ──
  let analyses = new Map<string, ConferenceAnalysis>();
  if (!newPapers.length) {
    log("无会议论文需要 LLM 分析");
  } else {
    analyses = await loadCachedAnalyses(newPapers, analyzedKeys);
    const cachedCount = analyses.size;
    const toAnalyze = newPapers.filter((p) => !analyses.has(p.paperKey));
    log(`Conference analyze: ${newPapers.length} total, ${cachedCount} cached, ${toAnalyze.length} need LLM`);

    if (toAnalyze.length) {
      if (!ctx.llm.isConfigured) {
        log("LLM 未配置，跳过会议论文分析");
      } else {
        const newAnalyses = await analyzePapersBatch(toAnalyze, ctx);
        for (const [key, analysis] of newAnalyses) {
          analyses.set(key, analysis);
          try {
            await saveAnalysis(key, analysis);
          } catch (e) {
            log(`Failed to save conference analysis for ${key}: ${e}`);
          }
        }
      }
    }

    const successCount = [...analyses.values()].filter((a) => a.oneLiner !== "[分析失败]").length;
    log(`Conference analysis done: ${successCount}/${newPapers.length} (${cachedCount} cached)`);
  }

  // ── BuildConfFragmentStage ──
  const lang = ctx.language || "zh";
  const html = confPapersToHtml(newPapers, analyses, ctx.dateCompact, lang);
  const md = confPapersToMd(newPapers, analyses, ctx.dateCompact, lang);

  if (newPapers.length) {
    log(`会议论文 HTML+MD 片段已生成 (HTML: ${html.length} chars, ${newPapers.length} 篇)`);
  } else {
    log("会议论文: 使用占位符");
  }

  return { html, md, count: newPapers.length };
}
