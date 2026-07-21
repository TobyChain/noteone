/**
 * arXiv module — TS port of the Python arXiv pipeline
 * (ascan/main.py run_multi_dimension_pipeline + ascan/src/pipeline/stages.py).
 *
 * Fetch (RSS primary, arXiv API fallback) → Parse → Score → Analyze (LLM) →
 * Render HTML/MD fragments. Cross-day dedup and analysis caching go through
 * the `papers` table (drizzle), mirroring the Python PaperRepository.
 * The Python DailyReportDB / paper_daily_report bookkeeping is intentionally
 * NOT ported — the daily report only lands on disk via the orchestrator.
 */
import * as cheerio from "cheerio";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../../../db/client.js";
import { ascanPapers } from "../../../../db/schema.js";
import type { ModuleContext, ModuleResult } from "../types.js";
import { escapeHtml, fetchWithTimeout, sleep } from "../util.js";
import {
  MultiDimensionScorer,
  RECOMMENDATION_ORDER,
  type MultiDimensionScore,
} from "../scoring.js";

// ── constants (from ascan/src/config/settings.py) ─────────────────────────

/** 高优先级关键词（极度推荐触发）— settings.high_priority_keywords */
const HIGH_PRIORITY_KEYWORDS = [
  // 大模型算法
  "large language model", "llm training", "llm inference",
  "mixture of experts", "moe", "flash attention",
  "lora", "qlora", "parameter-efficient",
  "long context", "speculative decoding",
  // Agent 算法
  "chain of thought", "tree of thought",
  "agent planning", "agent reasoning",
  "reinforcement learning agent", "rlhf",
  "mathematical reasoning", "code generation",
  // 智能体架构
  "multi-agent system", "agent framework",
  "tool calling", "function calling",
  "mcp", "model context protocol",
  "autonomous agent", "llm agent",
  "browser use", "web agent", "computer use",
  // 智能体记忆
  "retrieval augmented generation", "rag",
  "agent memory", "long-term memory",
  "knowledge retrieval", "vector database",
  "dense retrieval", "knowledge graph",
  // 大模型前沿
  "scaling law", "emergent ability",
  "alignment", "multimodal",
  "vision language model", "world model",
  "hallucination", "interpretability",
];

/** 头部机构（极度推荐触发）— settings.top_institutions */
const TOP_INSTITUTIONS = [
  "google", "openai", "meta", "deepmind",
  "anthropic", "microsoft", "apple", "samsung",
  "xiaomi", "huawei", "oppo",
  "百度", "腾讯", "阿里", "字节", "智谱",
];

const MIN_SCORE = 30.0;
const MAX_REPORT_PAPERS = 15;
const MAX_LLM_RETRIES = 3;
const METADATA_BATCH_SIZE = 100;

// ── small helpers ─────────────────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, "0");

async function fetchText(url: string, timeoutMs = 30_000): Promise<{ status: number; text: string }> {
  const resp = await fetchWithTimeout(url, {}, timeoutMs);
  return { status: resp.status, text: await resp.text() };
}

/**
 * arXiv publishes at 22:00 Beijing; fetch the previous day, falling back
 * over weekends (Sat/Sun → Friday). Port of orchestrator._arxiv_data_date.
 */
export function arxivDataDate(dateCompact: string, offsetDays: number): string {
  const dt = new Date(
    Number(dateCompact.slice(0, 4)),
    Number(dateCompact.slice(4, 6)) - 1,
    Number(dateCompact.slice(6, 8)),
  );
  dt.setDate(dt.getDate() - offsetDays);
  const w = dt.getDay(); // 0=Sun ... 6=Sat
  if (w === 6) dt.setDate(dt.getDate() - 1); // Saturday → Friday
  else if (w === 0) dt.setDate(dt.getDate() - 2); // Sunday → Friday
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

// ── data shapes ───────────────────────────────────────────────────────────

interface RawPaper {
  arxivId: string;
  title: string;
  authors: string[];
  abstract: string;
  absUrl: string;
  pdfUrl: string;
}

interface PaperAnalysis {
  transAbs: string;
  compressed: string;
  oneLiner: string | null;
  coreRecommendation: string | null;
  keywords: string[];
  subTopic: string;
  recommendation: string;
}

interface LlmAnalysisJson {
  trans_abs?: string;
  compressed?: string;
  one_liner?: string;
  core_recommendation?: string;
  keywords?: string[];
  sub_topic?: string;
  recommendation?: string;
}

// ── Stage 1: Fetch (RSS primary, arXiv API fallback) ──────────────────────

interface FetchResult {
  ids: string[];
  rssEntries: RawPaper[];
}

function parseRssItems(xml: string): Array<{ link: string; title: string; summary: string; creator: string }> {
  const $ = cheerio.load(xml, { xmlMode: true });
  const items: Array<{ link: string; title: string; summary: string; creator: string }> = [];
  $("item").each((_, el) => {
    const $el = $(el);
    items.push({
      link: $el.children("link").first().text().trim(),
      title: $el.children("title").first().text().trim(),
      summary: $el.children("description").first().text(),
      creator: $el.children("dc\\:creator").first().text().trim(),
    });
  });
  return items;
}

async function fetchStage(ctx: ModuleContext, dataDate: string, seenIds: Set<string>): Promise<FetchResult> {
  const { config, log } = ctx;
  const allIds: string[] = [];
  const rssEntries: RawPaper[] = [];
  const subjects = config.arxiv_subjects;

  for (const subject of subjects) {
    log(`抓取主题: ${subject} (RSS 优先)`);
    const rssRetryDelays = [5, 10, 15];
    let rssOk = false;

    // ── Primary: RSS feed ────────────────────────────────────
    const waits = [0, ...rssRetryDelays];
    for (let rssAttempt = 0; rssAttempt < waits.length; rssAttempt++) {
      const rssWait = waits[rssAttempt];
      if (rssWait) {
        log(`主题 ${subject} RSS 等待 ${rssWait}s 后重试 (第${rssAttempt}次)...`);
        await sleep(rssWait * 1000);
      }
      try {
        const r = await fetchText(`https://rss.arxiv.org/rss/${subject}`, 30_000);
        if (r.status === 200) {
          const entries = parseRssItems(r.text);
          let rssCount = 0;
          for (const entry of entries) {
            const m = entry.link.match(/\/abs\/(\d+\.\d+)/);
            if (m && !seenIds.has(m[1])) {
              const paperId = m[1];
              allIds.push(paperId);
              seenIds.add(paperId);
              rssCount++;
              const abstract = entry.summary.replace(/^[\s\S]*?Abstract:\s*/, "").trim();
              // arXiv RSS puts all names into a single dc:creator element —
              // keep them as one joined author string (feedparser parity).
              const authors = entry.creator ? [entry.creator] : [];
              rssEntries.push({
                arxivId: paperId,
                title: entry.title,
                authors,
                abstract,
                absUrl: entry.link,
                pdfUrl: `https://arxiv.org/pdf/${paperId}.pdf`,
              });
            }
          }
          if (rssCount > 0) {
            log(`主题 ${subject} RSS: ${rssCount} 篇（共 ${entries.length} 条），累计 ${allIds.length} 篇`);
            rssOk = true;
            break;
          } else if (entries.length === 0) {
            log(`主题 ${subject} RSS feed 为空（arXiv 可能尚未更新）`);
          } else {
            log(`主题 ${subject} RSS feed 有 ${entries.length} 条但全部已去重`);
          }
        } else {
          log(`主题 ${subject} RSS HTTP ${r.status}`);
        }
      } catch (e2) {
        log(`主题 ${subject} RSS 异常 (第${rssAttempt + 1}次): ${e2}`);
      }
    }

    // ── Fallback: arXiv API ──────────────────────────────────
    if (!rssOk) {
      log(`主题 ${subject}: RSS 失败，尝试 arxiv API...`);
      const targetCompact = dataDate.replace(/-/g, "");
      const startDt = new Date(
        Number(dataDate.slice(0, 4)),
        Number(dataDate.slice(5, 7)) - 1,
        Number(dataDate.slice(8, 10)),
      );
      startDt.setDate(startDt.getDate() - 3);
      const startCompact = `${startDt.getFullYear()}${pad2(startDt.getMonth() + 1)}${pad2(startDt.getDate())}`;
      const query = `cat:${subject} AND submittedDate:[${startCompact}0000 TO ${targetCompact}2359]`;

      const apiRetryDelays = [5, 10, 15];
      const apiWaits = [0, ...apiRetryDelays];
      for (let attempt = 0; attempt < apiWaits.length; attempt++) {
        const wait = apiWaits[attempt];
        if (wait) {
          log(`主题 ${subject} API 等待 ${wait}s 后重试 (第${attempt}次)...`);
          await sleep(wait * 1000);
        }
        if (attempt === 0 && subject !== subjects[0]) {
          await sleep(3000);
        }
        try {
          const url =
            "http://export.arxiv.org/api/query?" +
            `search_query=${encodeURIComponent(query)}` +
            `&start=0&max_results=${config.max_papers_per_subject}` +
            "&sortBy=submittedDate&sortOrder=descending";
          const r = await fetchText(url, 30_000);
          if (r.status !== 200) throw new Error(`arXiv API HTTP ${r.status}`);
          const results = parseAtomEntries(r.text);
          let subjectCount = 0;
          for (const result of results) {
            if (!seenIds.has(result.arxivId)) {
              allIds.push(result.arxivId);
              seenIds.add(result.arxivId);
              subjectCount++;
            }
          }
          log(`主题 ${subject} API: 找到 ${subjectCount} 篇，累计去重后 ${allIds.length} 篇`);
          if (subjectCount > 0) break;
        } catch (e) {
          if (attempt < apiRetryDelays.length) {
            log(`主题 ${subject} API 异常，${apiRetryDelays[attempt]}s 后重试: ${e}`);
          } else {
            log(`主题 ${subject} API 失败（已重试）: ${e}`);
            break;
          }
        }
      }
    }
  }

  log(`共获取 ${allIds.length} 篇不重复论文`);
  return { ids: allIds, rssEntries };
}

// ── Stage 2: Parse (RSS-first metadata; batched API for the rest) ─────────

function parseAtomEntries(xml: string): RawPaper[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const papers: RawPaper[] = [];
  $("entry").each((_, el) => {
    const $el = $(el);
    const entryId = $el.children("id").first().text().trim();
    const m = entryId.match(/\/abs\/([^\s]+)/);
    if (!m) return;
    const arxivId = m[1].split("v")[0];
    const authors: string[] = [];
    $el.children("author").each((_i, a) => {
      const name = $(a).children("name").first().text().trim();
      if (name) authors.push(name);
    });
    const pdfUrl = $el.find('link[title="pdf"]').attr("href") || `https://arxiv.org/pdf/${arxivId}.pdf`;
    papers.push({
      arxivId,
      title: $el.children("title").first().text().replace(/\s+/g, " ").trim(),
      authors,
      abstract: $el.children("summary").first().text().trim(),
      absUrl: entryId || `https://arxiv.org/abs/${arxivId}`,
      pdfUrl,
    });
  });
  return papers;
}

async function fetchArxivMetadata(ctx: ModuleContext, ids: string[]): Promise<RawPaper[]> {
  const { log } = ctx;
  log(`正在从 arXiv API 分批查询 ${ids.length} 篇论文元数据（每批 ${METADATA_BATCH_SIZE}）...`);
  const allResults: RawPaper[] = [];
  for (let i = 0; i < ids.length; i += METADATA_BATCH_SIZE) {
    const batch = ids.slice(i, i + METADATA_BATCH_SIZE);
    const batchNo = Math.floor(i / METADATA_BATCH_SIZE) + 1;
    try {
      const url =
        "http://export.arxiv.org/api/query?" +
        `id_list=${encodeURIComponent(batch.join(","))}` +
        `&max_results=${batch.length}`;
      const r = await fetchText(url, 30_000);
      if (r.status !== 200) throw new Error(`arXiv API HTTP ${r.status}`);
      const results = parseAtomEntries(r.text);
      allResults.push(...results);
      log(`  批次 ${batchNo}: 查询 ${batch.length} 篇，返回 ${results.length} 篇`);
    } catch (e) {
      log(`  批次 ${batchNo}: 查询 ${batch.length} 篇失败: ${e}`);
      if (String(e).includes("429")) {
        log("  arXiv 限流，跳过剩余批次");
        break;
      }
    }
    await sleep(3000);
  }
  log(`API 共解析 ${allResults.length} 篇论文（请求 ${ids.length} 篇）`);
  return allResults;
}

async function parseStage(ctx: ModuleContext, fetched: FetchResult): Promise<RawPaper[]> {
  const { config, log } = ctx;
  if (!fetched.ids.length) {
    log("没有论文 ID 需要解析");
    return [];
  }

  const ids = fetched.ids.slice(0, config.max_total_papers);
  const rssEntries = fetched.rssEntries;
  const rssIdSet = new Set(rssEntries.map((e) => e.arxivId));
  const idsNeedApi = ids.filter((pid) => !rssIdSet.has(pid));

  let results: RawPaper[];
  if (!idsNeedApi.length) {
    log(`全部 ${rssEntries.length} 篇来自 RSS（已含 title/abstract），跳过 API 元数据查询`);
    results = rssEntries;
  } else {
    log(`RSS 覆盖 ${rssEntries.length} 篇，还需从 API 查询 ${idsNeedApi.length} 篇元数据`);
    let apiResults: RawPaper[] = [];
    try {
      apiResults = await fetchArxivMetadata(ctx, idsNeedApi);
    } catch (e) {
      log(`arXiv API 元数据查询失败（使用 RSS 数据继续）: ${e}`);
    }
    const apiResultIds = new Set(apiResults.map((r) => r.arxivId));
    const missingIds = idsNeedApi.filter((pid) => !apiResultIds.has(pid));
    if (missingIds.length) {
      log(`API 元数据缺失 ${missingIds.length} 篇，构造最小元数据兜底`);
      for (const pid of missingIds) {
        apiResults.push({
          arxivId: pid,
          title: `arXiv:${pid}`,
          authors: [],
          abstract: "",
          absUrl: `https://arxiv.org/abs/${pid}`,
          pdfUrl: `https://arxiv.org/pdf/${pid}.pdf`,
        });
      }
    }
    results = [...rssEntries, ...apiResults];
    log(`合并后共 ${results.length} 篇（RSS ${rssEntries.length} + API ${apiResults.length}）`);
  }

  log(`成功解析 ${results.length} 篇论文`);
  return results;
}

// ── Stage 3: Score ────────────────────────────────────────────────────────

function scoreStage(ctx: ModuleContext, papers: RawPaper[]): MultiDimensionScore[] {
  const { log } = ctx;
  if (!papers.length) {
    log("没有论文可评分");
    return [];
  }

  const scorer = new MultiDimensionScorer();
  const scored = papers.map((p) =>
    scorer.scorePaper(p.arxivId, p.title, p.abstract, p.authors),
  );
  log(`评分进度: ${scored.length}/${papers.length}`);

  const relevant = scored.filter((s) => s.overallScore >= MIN_SCORE);
  const selected = [...relevant]
    .sort((a, b) => b.overallScore - a.overallScore)
    .slice(0, MAX_REPORT_PAPERS);

  log(`📊 过滤结果: 原始 ${scored.length} 篇 → 相关 ${relevant.length} 篇 → 精选 ${selected.length} 篇（上限 ${MAX_REPORT_PAPERS}）`);
  return selected;
}

// ── Stage 4: Analyze (LLM concurrent) + DB write-back ─────────────────────

/** Prompt — verbatim port of call_llm.LLMClient._create_analysis_prompt. */
function createAnalysisPrompt(title: string, abstract: string): string {
  const highPriority = HIGH_PRIORITY_KEYWORDS.slice(0, 4).join("/");
  const topInst = TOP_INSTITUTIONS.slice(0, 3).join("/");

  const titleSafe = title.replace(/"/g, "'").replace(/\\/g, "\\\\");
  let abstractSafe = abstract.replace(/"/g, "'").replace(/\\/g, "\\\\");
  if (abstractSafe.length > 1500) {
    abstractSafe = abstractSafe.slice(0, 1500) + "...";
  }

  return (
    "Analyze this paper and reply ONLY with a JSON object (no markdown, no explanation). " +
    "IMPORTANT: keep trans_abs under 300 Chinese characters to avoid truncation. " +
    "JSON fields: trans_abs=Chinese translation of abstract (accurate, concise, MAX 300 chars), " +
    "compressed=2-3 sentence Chinese summary of research problem/method/contribution, " +
    "one_liner=用大白话一句话说清这篇论文解决了什么问题或提出了什么方法，中文，20-40字，不要堆术语，像给产品经理介绍一样通俗易懂，不要用本文/本研究/该论文开头，" +
    "core_recommendation=Chinese explanation of how this paper relates to or inspires LLM/Agent research (大模型算法/Agent算法/智能体架构/智能体记忆/大模型前沿) (30-80 chars), " +
    "keywords=list of 3-5 Chinese keywords, " +
    "sub_topic=research field in Chinese (e.g. 大模型算法/Agent算法/智能体架构/智能体记忆/大模型前沿), " +
    "recommendation=one of [极度推荐/很推荐/推荐/一般推荐/不推荐] " +
    `(极度推荐 if related to ${highPriority} or from ${topInst}; ` +
    "很推荐 for strong innovation; 推荐 for good quality; 一般推荐 for routine; 不推荐 for unrelated). " +
    `PAPER TITLE: ${titleSafe} | ABSTRACT: ${abstractSafe}`
  );
}

async function analyzeOne(
  ctx: ModuleContext,
  score: MultiDimensionScore,
  paper: RawPaper,
  idx: number,
  total: number,
): Promise<LlmAnalysisJson | null> {
  const prompt = createAnalysisPrompt(paper.title, paper.abstract);
  ctx.log(`[${idx}/${total}] 生成中文摘要: ${score.title.slice(0, 60)}...`);
  try {
    return await ctx.llm.chatJsonRetry<LlmAnalysisJson>(
      prompt,
      (analysis) => {
        const transAbs = String(analysis?.trans_abs ?? "");
        return Boolean(transAbs && !transAbs.includes("翻译失败") && transAbs.length > 20);
      },
      MAX_LLM_RETRIES,
    );
  } catch (e) {
    ctx.log(`LLM 分析失败 ${score.arxivId}: ${e}`);
    return null;
  }
}

/** Mirrors PaperRepository.create_or_update. */
async function upsertPaper(
  paper: RawPaper,
  published: string,
  analysis: PaperAnalysis,
): Promise<void> {
  const analysisFields = {
    transAbs: analysis.transAbs,
    compressed: analysis.compressed,
    keywords: analysis.keywords,
    subTopic: analysis.subTopic,
    recommendation: analysis.recommendation,
    oneLiner: analysis.oneLiner,
    coreRecommendation: analysis.coreRecommendation,
  };
  await db
    .insert(ascanPapers)
    .values({
      arxivId: paper.arxivId,
      title: paper.title,
      authors: paper.authors,
      abstract: paper.abstract,
      absUrl: paper.absUrl,
      pdfUrl: paper.pdfUrl,
      published,
      status: "completed",
      processedAt: new Date(),
      ...analysisFields,
    })
    .onConflictDoUpdate({
      target: ascanPapers.arxivId,
      set: {
        title: paper.title,
        authors: paper.authors,
        abstract: paper.abstract,
        absUrl: paper.absUrl,
        pdfUrl: paper.pdfUrl,
        published,
        updatedAt: new Date(),
        ...analysisFields,
      },
    });
}

async function analyzeStage(
  ctx: ModuleContext,
  scoredPapers: MultiDimensionScore[],
  parsedPapers: RawPaper[],
  dataDate: string,
): Promise<void> {
  const { log } = ctx;
  if (!scoredPapers.length) {
    log("没有精选论文需要 LLM 分析");
    return;
  }

  const paperDataMap = new Map(parsedPapers.map((p) => [p.arxivId, p]));
  const total = scoredPapers.length;

  let llmResults: Array<LlmAnalysisJson | null>;
  if (ctx.llm.isConfigured) {
    llmResults = await ctx.llm.mapConcurrent(
      scoredPapers.map((s, i) => ({ score: s, idx: i + 1 })),
      async ({ score, idx }) => {
        const paperData = paperDataMap.get(score.arxivId);
        if (!paperData) return null;
        return analyzeOne(ctx, score, paperData, idx, total);
      },
      () => null,
    );
  } else {
    log("LLM 未配置，跳过论文分析（论文仍会列出，只是无翻译）");
    llmResults = scoredPapers.map(() => null);
  }

  for (let i = 0; i < scoredPapers.length; i++) {
    const score = scoredPapers[i];
    const analysis = llmResults[i];
    const paperData = paperDataMap.get(score.arxivId);
    if (!paperData) continue;

    const keywordsList = [
      ...score.primaryDirections,
      ...(score.dimensionScores[0]?.matchedKeywords.slice(0, 3) ?? []),
    ] as string[];
    if (keywordsList.length < 2) {
      keywordsList.push(...["AI", "arXiv"].slice(0, 2 - keywordsList.length));
    }

    const paper: RawPaper = {
      arxivId: score.arxivId,
      title: score.title,
      authors: paperData.authors,
      abstract: paperData.abstract,
      absUrl: `https://arxiv.org/abs/${score.arxivId}`,
      pdfUrl: `https://arxiv.org/pdf/${score.arxivId}.pdf`,
    };

    let paperAnalysis: PaperAnalysis;
    if (analysis && analysis.trans_abs && !analysis.trans_abs.includes("翻译失败")) {
      paperAnalysis = {
        transAbs: analysis.trans_abs,
        compressed: analysis.compressed || "",
        oneLiner: analysis.one_liner || null,
        coreRecommendation: analysis.core_recommendation || null,
        keywords: keywordsList,
        subTopic: score.primaryDirections[0] ?? "未知",
        recommendation: score.recommendationLevel,
      };
    } else {
      const fallbackAbs = ctx.llm.isConfigured
        ? `【翻译失败-请查看原文】${paperData.abstract.slice(0, 500)}`
        : ""; // LLM not configured: list the paper without a translation
      if (ctx.llm.isConfigured) {
        log(`翻译最终失败 ${score.arxivId}，使用英文摘要兜底`);
      }
      paperAnalysis = {
        transAbs: fallbackAbs,
        compressed: `主要方向: ${score.primaryDirections.join(", ")}`,
        oneLiner: null,
        coreRecommendation: null,
        keywords: keywordsList,
        subTopic: score.primaryDirections[0] ?? "未知",
        recommendation: score.recommendationLevel,
      };
    }

    await upsertPaper(paper, dataDate, paperAnalysis);
  }

  log(`✅ LLM 分析完成，已保存 ${scoredPapers.length} 篇论文`);
}

// ── Stage 5: Render (ports of report2md.papers_to_html / report_md.papers_to_md) ──

interface RenderPaper {
  title: string;
  authors: string[];
  abs_url: string;
  pdf_url: string;
  keywords: string[];
  one_liner: string;
  core_recommendation: string;
  trans_abs: string;
  recommendation: string;
}

function safeJoin(items: string[]): string {
  return items.filter(Boolean).map(String).join(", ");
}

function htmlLink(url: string, label: string): string {
  if (!url) return "";
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

export function papersToHtml(dateStr: string, papers: RenderPaper[]): string {
  if (!papers.length) {
    return '<p class="empty-state">今日无 arXiv 精选论文。</p>';
  }

  const sections: string[] = [
    `<div class="report-list arxiv-list" data-date="${escapeHtml(dateStr)}">`,
  ];

  papers.forEach((paper, i) => {
    const index = i + 1;
    const title = (paper.title || "").trim();
    const authors = paper.authors || [];
    const absUrl = paper.abs_url || "";
    const pdfUrl = paper.pdf_url || "";
    const keywords = paper.keywords || [];
    const oneLiner = (paper.one_liner || "").trim();
    const coreRecommendation = (paper.core_recommendation || "").trim();
    const translatedAbstract = (paper.trans_abs || "").trim();

    const keywordTags = keywords
      .filter(Boolean)
      .map((keyword) => `<span class="tag">${escapeHtml(keyword)}</span>`)
      .join("");
    const links = [htmlLink(absUrl, "Abstract"), htmlLink(pdfUrl, "PDF")]
      .filter(Boolean)
      .join(" · ");

    sections.push('<article class="card paper-card">');
    sections.push(`<h3>${index}. ${escapeHtml(title)}</h3>`);
    if (authors.length) {
      sections.push(`<p class="meta"><strong>作者：</strong>${escapeHtml(safeJoin(authors))}</p>`);
    }
    if (keywordTags) {
      sections.push(`<div class="tags">${keywordTags}</div>`);
    }
    if (oneLiner) {
      sections.push(`<p><strong>一句话总结：</strong>${escapeHtml(oneLiner)}</p>`);
    }
    if (links) {
      sections.push(`<p class="links">${links}</p>`);
    }

    sections.push('<section class="summary-block">');
    sections.push("<h4>中文摘要</h4>");
    if (translatedAbstract) {
      sections.push(`<p>${escapeHtml(translatedAbstract)}</p>`);
    } else {
      sections.push('<p class="muted">中文摘要生成中...</p>');
    }
    sections.push("</section>");

    if (coreRecommendation) {
      sections.push(
        `<p class="recommendation"><strong>核心推荐：</strong>${escapeHtml(coreRecommendation)}</p>`,
      );
    }
    sections.push("</article>");
  });

  sections.push("</div>");
  return sections.join("\n");
}

export function papersToMd(_dateStr: string, papers: RenderPaper[]): string {
  if (!papers.length) {
    return "_今日无 arXiv 精选论文。_";
  }

  const lines: string[] = [];
  papers.forEach((paper, i) => {
    const index = i + 1;
    const title = (paper.title || "").trim();
    const authors = paper.authors || [];
    const absUrl = paper.abs_url || "";
    const pdfUrl = paper.pdf_url || "";
    const keywords = paper.keywords || [];
    const oneLiner = (paper.one_liner || "").trim();
    const coreRec = (paper.core_recommendation || "").trim();
    const transAbs = (paper.trans_abs || "").trim();

    lines.push(`### ${index}. ${title}`);
    lines.push("");
    if (authors.length) {
      lines.push(`**作者：** ${safeJoin(authors)}`);
    }
    if (keywords.length) {
      lines.push(`**关键词：** ${keywords.filter(Boolean).map((k) => `\`${k}\``).join(" ")}`);
    }
    if (oneLiner) {
      lines.push(`**一句话总结：** ${oneLiner}`);
    }

    const linkParts: string[] = [];
    if (absUrl) linkParts.push(`[Abstract](${absUrl})`);
    if (pdfUrl) linkParts.push(`[PDF](${pdfUrl})`);
    if (linkParts.length) {
      lines.push(`**链接：** ${linkParts.join(" · ")}`);
    }

    lines.push("");
    if (transAbs) {
      lines.push(`> ${transAbs}`);
    } else {
      lines.push("> _中文摘要生成中..._");
    }

    if (coreRec) {
      lines.push("");
      lines.push(`> **核心推荐：** ${coreRec}`);
    }

    lines.push("");
    lines.push("---");
    lines.push("");
  });

  return lines.join("\n");
}

async function generateReport(
  ctx: ModuleContext,
  dataDate: string,
  selectedIds: string[],
): Promise<{ html: string; md: string; count: number }> {
  const { log } = ctx;
  const rows = selectedIds.length
    ? await db
        .select()
        .from(ascanPapers)
        .where(inArray(ascanPapers.arxivId, selectedIds))
    : await db
        .select()
        .from(ascanPapers)
        .where(eq(ascanPapers.published, dataDate))
        .limit(500);

  if (!rows.length) {
    log("没有论文数据可生成报告");
    return { html: papersToHtml(dataDate, []), md: papersToMd(dataDate, []), count: 0 };
  }

  if (selectedIds.length) {
    log(`按精选 ID 过滤后: ${rows.length} 篇`);
  }

  const papers: RenderPaper[] = rows.map((r) => ({
    title: r.title || "",
    authors: (r.authors as string[]) || [],
    abs_url: r.absUrl || "",
    pdf_url: r.pdfUrl || "",
    keywords: (r.keywords as string[]) || [],
    one_liner: r.oneLiner || "",
    core_recommendation: r.coreRecommendation || "",
    trans_abs: r.transAbs || "",
    recommendation: r.recommendation || "",
  }));
  papers.sort(
    (a, b) =>
      (RECOMMENDATION_ORDER[b.recommendation] || 0) -
      (RECOMMENDATION_ORDER[a.recommendation] || 0),
  );

  const html = papersToHtml(dataDate, papers);
  const md = papersToMd(dataDate, papers);
  log("arXiv HTML + MD 片段已生成，等待统一日报合并");
  return { html, md, count: papers.length };
}

// ── entry point ───────────────────────────────────────────────────────────

export async function run(ctx: ModuleContext): Promise<ModuleResult> {
  const { config, log } = ctx;
  const dataDate = arxivDataDate(ctx.dateCompact, config.arxiv_date_offset_days);
  log(`🚀 启动多维度评分流水线: ${dataDate}, 主题: ${config.arxiv_subjects.join(", ")}`);

  // Cross-day dedup: load all known arxiv_ids from DB so papers already
  // reported in previous days' runs are skipped today.
  const seenIds = new Set<string>();
  try {
    const rows = await db.select({ arxivId: ascanPapers.arxivId }).from(ascanPapers);
    for (const row of rows) if (row.arxivId) seenIds.add(row.arxivId);
    log(`Cross-day dedup: ${seenIds.size} arxiv_ids already in DB`);
  } catch (e) {
    log(`Failed to load known arxiv_ids for dedup: ${e}`);
  }

  const fetched = await fetchStage(ctx, dataDate, seenIds);
  const parsed = await parseStage(ctx, fetched);
  const selected = scoreStage(ctx, parsed);
  await analyzeStage(ctx, selected, parsed, dataDate);
  return generateReport(ctx, dataDate, selected.map((s) => s.arxivId));
}
