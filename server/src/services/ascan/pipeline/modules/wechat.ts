/**
 * WeChat MP module — TS port of ascan/src/wechat_tracker/
 * (fetcher.py + analyzer.py + report.py + stages.py + models.py).
 *
 * Difference from the Python version: instead of HTTP-looping back to the
 * server's /api/wechat/mp/articles endpoint, we call the in-process WeChat
 * service (listArticles) directly. The triple-nested appmsgpublish JSON
 * parsing, pagination, dedup, date filter and ret=200003 handling are kept
 * identical to fetcher.py.
 */
import { eq } from "drizzle-orm";
import { db } from "../../../../db/client.js";
import { ascanWechatArticles } from "../../../../db/schema.js";
import { listArticles } from "../../../wechat/service.js";
import { sleep, escapeHtml } from "../util.js";
import { RECOMMENDATION_ORDER } from "../scoring.js";
import type { ModuleContext, ModuleResult } from "../types.js";

const FAILED_ONE_LINER = "[分析失败]";

// ── models (models.py) ────────────────────────────────────────

interface WeChatArticle {
  article_id: string; // unique key: mp_id + url
  title: string;
  url: string;
  mp_id: string;
  mp_name: string;
  publish_time: string; // ISO 8601
  author: string;
  summary: string;
  content: string; // full article body
  cover_url: string;
}

interface WeChatAnalysis {
  one_liner: string;
  summary_cn: string;
  keywords: string[];
  core_recommendation: string;
  relevance: string;
}

// ── fetcher (fetcher.py) ──────────────────────────────────────

/**
 * Extract the appmsgex[] list from the triple-nested response.
 *
 * Top-level: { base_resp: {ret, ...}, publish_page: "<json string>" }
 * publish_page parsed: { total_count, publish_list: [{publish_info: "<json string>"}] }
 * publish_info parsed: { appmsgex: [{title, author, link, ...}] }
 */
function parseAppmsgpublish(respJson: any, log: (msg: string) => void): any[] {
  const baseResp = respJson?.base_resp || {};
  const ret = baseResp.ret;
  if (ret !== 0) {
    const errMsg = baseResp.err_msg || `ret=${ret}`;
    log(`wechat appmsgpublish non-zero ret: ${errMsg}`);
    return [];
  }

  const publishPageRaw = respJson?.publish_page;
  if (!publishPageRaw) {
    log("wechat appmsgpublish: empty publish_page");
    return [];
  }
  let publishPage: any;
  try {
    publishPage = typeof publishPageRaw === "string" ? JSON.parse(publishPageRaw) : publishPageRaw;
  } catch (e) {
    log(`wechat publish_page JSON parse failed: ${e}`);
    return [];
  }

  const publishList = publishPage?.publish_list || [];
  const articles: any[] = [];
  for (const item of publishList) {
    const infoRaw = item?.publish_info;
    if (!infoRaw) continue;
    let info: any;
    try {
      info = typeof infoRaw === "string" ? JSON.parse(infoRaw) : infoRaw;
    } catch {
      continue;
    }
    const appmsgex = info?.appmsgex || [];
    for (const a of appmsgex) {
      if (a && typeof a === "object" && !Array.isArray(a)) {
        articles.push(a);
      }
    }
  }
  return articles;
}

/** Format a unix-seconds timestamp like Python's time.strftime("%Y-%m-%dT%H:%M:%S+08:00", localtime). */
function formatPublishTime(ts: number): string {
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}+08:00`;
}

/**
 * Map AppMsgEx fields to WeChatArticle. Return null if article is older
 * than minPublishTs (unix seconds) or missing title/link.
 */
function appmsgToArticle(
  a: any,
  fakeid: string,
  mpName: string,
  minPublishTs = 0,
): WeChatArticle | null {
  const link: string = a?.link || "";
  const title: string = String(a?.title || "").trim();
  if (!title || !link) return null;
  const articleId = `wx:${fakeid}:${link}`;
  let publishTime = "";
  let publishTs = 0;
  const pt = a?.publish_time || a?.create_time;
  if (pt) {
    const n = Number(pt);
    if (Number.isFinite(n)) {
      publishTs = n;
      publishTime = formatPublishTime(Math.trunc(n));
    } else {
      publishTime = String(pt);
    }
  }
  // Date filter: skip articles older than the cutoff (0 = no filter)
  if (minPublishTs > 0 && publishTs > 0 && publishTs < minPublishTs) return null;
  const summary: string = a?.digest || a?.summary || "";
  const cover: string = a?.cover_img || a?.cover || "";
  const author: string = a?.author || "";
  return {
    article_id: articleId,
    title,
    url: link,
    mp_id: fakeid,
    mp_name: mpName,
    publish_time: publishTime,
    author,
    summary,
    content: "", // full body not provided by appmsgpublish; left empty for now
    cover_url: cover,
  };
}

/**
 * Fetch articles for a single MP via the in-process WeChat service.
 * Skip articles older than daysRecent days (0 = no filter).
 */
async function fetchMpArticles(
  authKey: string,
  fakeid: string,
  mpName: string,
  limit: number,
  daysRecent: number,
  log: (msg: string) => void,
): Promise<WeChatArticle[]> {
  if (!authKey || !fakeid) {
    log(`wechat fetch skipped: auth_key=${!!authKey} fakeid=${!!fakeid}`);
    return [];
  }

  const minPublishTs = daysRecent > 0 ? Date.now() / 1000 - daysRecent * 86400 : 0;
  const collected: WeChatArticle[] = [];
  let begin = 0;
  const pageSize = Math.min(limit, 20);
  const seenIds = new Set<string>();
  let skippedOld = 0;

  while (begin < limit) {
    const size = Math.min(pageSize, limit - begin);
    try {
      const data: any = await listArticles(authKey, fakeid, begin, size);
      const baseResp = data?.base_resp || {};
      if (baseResp.ret === 200003) {
        log("wechat auth-key expired (ret=200003) — please re-scan in Settings");
        break;
      }
      const articlesRaw = parseAppmsgpublish(data, log);
      if (!articlesRaw.length) break;
      let newCount = 0;
      for (const a of articlesRaw) {
        const art = appmsgToArticle(a, fakeid, mpName, minPublishTs);
        if (art === null) {
          // Could be missing title/link OR too old — count for logging
          if (a?.title && a?.link) skippedOld++;
          continue;
        }
        if (!seenIds.has(art.article_id)) {
          collected.push(art);
          seenIds.add(art.article_id);
          newCount++;
        }
      }
      if (newCount === 0) break; // all duplicates or all filtered, stop
      begin += articlesRaw.length;
      await sleep(400);
    } catch (e) {
      log(`wechat ${mpName || fakeid} begin=${begin} error: ${e}`);
      break;
    }
  }

  log(
    `wechat ${mpName || fakeid}: ${collected.length} articles (limit=${limit}, days_recent=${daysRecent}, skipped_old≈${skippedOld})`,
  );
  return collected;
}

/** Fetch articles from multiple MPs. mpList: [{ id: "<fakeid>", name: "..." }] */
async function fetchAllMps(
  authKey: string,
  mpList: Array<{ id: string; name: string }>,
  limit: number,
  daysRecent: number,
  log: (msg: string) => void,
): Promise<WeChatArticle[]> {
  const allArticles: WeChatArticle[] = [];
  for (const mp of mpList) {
    const fakeid = mp?.id || "";
    const mpName = mp?.name || "";
    if (!fakeid) continue;
    const articles = await fetchMpArticles(authKey, fakeid, mpName, limit, daysRecent, log);
    allArticles.push(...articles);
    await sleep(500);
  }
  log(`Total WeChat articles fetched: ${allArticles.length} from ${mpList.length} MPs`);
  return allArticles;
}

// ── DB repository (WeChatArticleRepository) ───────────────────

async function getAllKnownIds(): Promise<Set<string>> {
  const rows = await db.select({ articleId: ascanWechatArticles.articleId }).from(ascanWechatArticles);
  return new Set(rows.map((r) => r.articleId));
}

async function upsertDiscovered(article: WeChatArticle, today: string): Promise<void> {
  await db
    .insert(ascanWechatArticles)
    .values({
      articleId: article.article_id,
      title: article.title,
      url: article.url,
      mpId: article.mp_id,
      mpName: article.mp_name,
      publishTime: article.publish_time,
      author: article.author,
      summary: article.summary || "",
      content: article.content || "",
      coverUrl: article.cover_url,
      firstSeenDate: today,
      lastSeenDate: today,
      analyzed: false,
    })
    .onConflictDoUpdate({
      target: ascanWechatArticles.articleId,
      set: { lastSeenDate: today, updatedAtTs: new Date() },
    });
}

async function saveAnalysis(articleId: string, analysis: WeChatAnalysis): Promise<void> {
  await db
    .update(ascanWechatArticles)
    .set({
      oneLiner: analysis.one_liner,
      summaryCn: analysis.summary_cn,
      keywords: analysis.keywords ?? [],
      coreRecommendation: analysis.core_recommendation ?? "",
      relevance: analysis.relevance,
      analyzed: true,
      updatedAtTs: new Date(),
    })
    .where(eq(ascanWechatArticles.articleId, articleId));
}

// ── LLM analysis (analyzer.py) ────────────────────────────────

function buildPrompt(article: WeChatArticle, language: "zh" | "en"): string {
  // Use first 1500 chars of content to avoid token limit
  const content = (article.content || article.summary || (language === "en" ? "(No content)" : "（无内容）")).slice(0, 1500);
  if (language === "en") {
    return `You are an AI content analysis expert. Analyze the following WeChat article and generate a summary and assessment.

Article info:
- WeChat MP: ${article.mp_name}
- Title: ${article.title}
- Author: ${article.author || "Unknown"}
- Content summary: ${content}

Output strictly as JSON (no markdown code block markers):
{
  "one_liner": "one-liner English summary (max 30 words)",
  "summary_cn": "English summary (max 200 words)",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "core_recommendation": "why it's worth attention and its relevance to LLM/Agent/Agent Architecture (max 80 words)",
  "relevance": "Highly Recommended/Recommended/Worth Reading/Moderately Recommended/Not Recommended"
}`;
  }
  return `你是一位 AI 领域的内容分析专家。请分析以下微信公众号文章，生成中文摘要和评估。

文章信息：
- 公众号：${article.mp_name}
- 标题：${article.title}
- 作者：${article.author || "未知"}
- 内容摘要：${content}

请严格输出 JSON（不要包含 markdown 代码块标记）：
{
  "one_liner": "一句话中文概括（30字以内）",
  "summary_cn": "中文摘要（200字以内）",
  "keywords": ["关键词1", "关键词2", "关键词3"],
  "core_recommendation": "为什么值得关注，与大模型/Agent/智能体的关联（80字以内）",
  "relevance": "极度推荐/很推荐/推荐/一般推荐/不推荐"
}`;
}

const FAILED_ANALYSIS: WeChatAnalysis = {
  one_liner: FAILED_ONE_LINER,
  summary_cn: "",
  keywords: [],
  core_recommendation: "",
  relevance: "不推荐",
};

/** Analyze WeChat articles concurrently using the pipeline LLM. */
async function analyzeArticlesBatch(
  articles: WeChatArticle[],
  ctx: ModuleContext,
): Promise<Map<string, WeChatAnalysis>> {
  const lang = ctx.language || "zh";
  const results = await ctx.llm.mapConcurrent<WeChatArticle, [string, WeChatAnalysis]>(
    articles,
    async (article) => {
      const data = await ctx.llm.chatJsonRetry<any>(buildPrompt(article, lang));
      const analysis: WeChatAnalysis = {
        one_liner: data.one_liner ?? "",
        summary_cn: data.summary_cn ?? "",
        keywords: Array.isArray(data.keywords) ? data.keywords : [],
        core_recommendation: data.core_recommendation ?? "",
        relevance: data.relevance ?? "一般推荐",
      };
      return [article.article_id, analysis];
    },
    (article, err) => {
      ctx.log(`LLM analysis failed for ${article.article_id}: ${err}`);
      return [article.article_id, { ...FAILED_ANALYSIS }];
    },
  );

  return new Map(results);
}

// ── report (report.py) ────────────────────────────────────────

function sortArticles(
  articles: WeChatArticle[],
  analyses: Map<string, WeChatAnalysis>,
): WeChatArticle[] {
  const key = (a: WeChatArticle): number => {
    const an = analyses.get(a.article_id);
    if (an) return RECOMMENDATION_ORDER[an.relevance] ?? 0;
    return 0;
  };
  // Stable sort, descending — mirrors Python sorted(..., reverse=True)
  return [...articles].sort((a, b) => key(b) - key(a));
}

function wechatArticlesToHtml(
  articles: WeChatArticle[],
  analyses: Map<string, WeChatAnalysis>,
  dateCompact: string,
  language: "zh" | "en" = "zh",
): string {
  if (!articles.length) return language === "en" ? '<p class="empty-state">No WeChat article updates today.</p>' : '<p class="empty-state">今日无微信公众号更新。</p>';

  const L = language === "en"
    ? { oneLiner: "Summary:", summary: "Abstract", generating: "Abstract generating...", coreRec: "Core Recommendation:", author: "Author", published: "Published", source: "Source", readOriginal: "Read Original" }
    : { oneLiner: "一句话总结：", summary: "中文摘要", generating: "中文摘要生成中...", coreRec: "核心推荐：", author: "作者", published: "发布", source: "来源", readOriginal: "阅读原文" };

  const sorted = sortArticles(articles, analyses);
  const parts: string[] = [`<div class="report-list wechat-list" data-date="${dateCompact}">`];

  sorted.forEach((article, i) => {
    const idx = i + 1;
    const analysis = analyses.get(article.article_id);
    const oneLiner = analysis ? analysis.one_liner : "";
    const summaryCn = analysis ? analysis.summary_cn : "";
    const keywords = analysis && analysis.keywords?.length ? analysis.keywords : [];
    const coreRec = analysis ? analysis.core_recommendation : "";
    const relevance = analysis ? analysis.relevance : "";

    const badges = [`<span class="tag tag-venue">${escapeHtml(article.mp_name)}</span>`];
    if (relevance && relevance !== "不推荐" && relevance !== "Not Recommended") {
      badges.push(`<span class="tag tag-relevance">${escapeHtml(relevance)}</span>`);
    }

    let kwTags = "";
    if (keywords.length) {
      kwTags =
        '<div class="tags">' +
        keywords.slice(0, 5).map((kw) => `<span class="tag">${escapeHtml(kw)}</span>`).join("") +
        "</div>";
    }

    const summaryBlock = summaryCn
      ? `<section class="summary-block"><h4>${L.summary}</h4><p>${escapeHtml(summaryCn)}</p></section>`
      : `<section class="summary-block"><h4>${L.summary}</h4><p class="muted">${L.generating}</p></section>`;

    let recHtml = "";
    if (coreRec) {
      recHtml = `<p class="recommendation"><strong>${L.coreRec}</strong>${escapeHtml(coreRec)}</p>`;
    }

    const meta: string[] = [];
    if (article.author) meta.push(`${L.author}：${escapeHtml(article.author)}`);
    if (article.publish_time) meta.push(`${L.published}：${escapeHtml(article.publish_time.slice(0, 16))}`);

    parts.push(
      `<article class="card paper-card">` +
        `<h3>${idx}. ${escapeHtml(article.title)}</h3>` +
        `<p class="meta"><strong>${meta.length ? meta.join(" · ") : L.source}</strong></p>` +
        `<div class="tags">${badges.join("")}</div>` +
        `${kwTags}` +
        `<p><strong>${L.oneLiner}</strong>${escapeHtml(oneLiner)}</p>` +
        `<p class="links"><a href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer">${L.readOriginal}</a></p>` +
        `${summaryBlock}` +
        `${recHtml}` +
        `</article>`,
    );
  });

  parts.push("</div>");
  return parts.join("\n");
}

function wechatArticlesToMd(
  articles: WeChatArticle[],
  analyses: Map<string, WeChatAnalysis>,
  _dateCompact: string,
  language: "zh" | "en" = "zh",
): string {
  if (!articles.length) return language === "en" ? "_No WeChat article updates today._" : "_今日无微信公众号更新。_";

  const L = language === "en"
    ? { total: (n: number) => `${n} new articles`, author: "Author", published: "Published", mp: "WeChat MP:", keywords: "Keywords:", oneLiner: "Summary:", link: "Link:", readOriginal: "Read Original", generating: "Abstract generating...", coreRec: "Core Recommendation:" }
    : { total: (n: number) => `共 ${n} 篇新文章`, author: "作者", published: "发布", mp: "公众号：", keywords: "关键词：", oneLiner: "一句话总结：", link: "链接：", readOriginal: "阅读原文", generating: "中文摘要生成中...", coreRec: "核心推荐：" };

  const sorted = sortArticles(articles, analyses);
  const lines: string[] = [`> ${L.total(articles.length)}`, ""];

  sorted.forEach((article, i) => {
    const idx = i + 1;
    const analysis = analyses.get(article.article_id);
    const oneLiner = analysis ? analysis.one_liner : "";
    const summaryCn = analysis ? analysis.summary_cn : "";
    const keywords = analysis && analysis.keywords?.length ? analysis.keywords : [];
    const coreRec = analysis ? analysis.core_recommendation : "";

    const meta: string[] = [];
    if (article.author) meta.push(`${L.author}：${article.author}`);
    if (article.publish_time) meta.push(`${L.published}：${article.publish_time.slice(0, 16)}`);

    lines.push(`### ${idx}. ${article.title}`);
    lines.push("");
    lines.push(`**${meta.length ? meta.join(" · ") : L.author}**`);
    lines.push(`**${L.mp}** ${article.mp_name}`);
    if (keywords.length) {
      const kwStr = keywords.slice(0, 5).map((kw) => `\`${kw}\``).join(" ");
      lines.push(`**${L.keywords}** ${kwStr}`);
    }
    if (oneLiner) lines.push(`**${L.oneLiner}** ${oneLiner}`);
    lines.push(`**${L.link}** [${L.readOriginal}](${article.url})`);
    lines.push("");
    if (summaryCn) lines.push(`> ${summaryCn}`);
    else lines.push(`> _${L.generating}_`);
    if (coreRec) lines.push(`> **${L.coreRec}** ${coreRec}`);
    lines.push("");
    lines.push("---");
    lines.push("");
  });

  return lines.join("\n");
}

// ── module entry (stages.py: Fetch + Analyze + BuildFragment) ─

const MAX_ARTICLES_PER_MP = 3;
const MAX_TOTAL_ARTICLES = 15;
const LLM_FILTER_THRESHOLD = 6;

/**
 * Use the pipeline LLM to filter WeChat articles by tech relevance.
 * Sends all article titles/summaries in a single prompt and asks the LLM
 * to score each 1-10. Only articles scoring >= LLM_FILTER_THRESHOLD are kept.
 * Falls back to the original list if LLM is unavailable or all articles
 * are filtered out.
 */
async function llmFilterArticles(
  articles: WeChatArticle[],
  ctx: ModuleContext,
): Promise<WeChatArticle[]> {
  if (!articles.length) return articles;
  if (!ctx.llm.isConfigured) {
    ctx.log("WeChat LLM 过滤：LLM 未配置，跳过过滤");
    return articles;
  }

  const articleListStr = articles
    .map((a, i) => `[${i + 1}] 标题：${a.title} | 公众号：${a.mp_name} | 摘要：${(a.summary || "").slice(0, 200)}`)
    .join("\n");

  const prompt = `你是一位科技日报编辑。请为以下微信公众号文章评估技术相关性和阅读价值，打分1-10分。

评分标准：
- 9-10分：与大模型/Agent/智能体/AI前沿高度相关，极具阅读价值
- 7-8分：技术内容扎实，与AI/科技有较强关联
- 5-6分：有一定技术价值，但相关性一般
- 3-4分：技术含量较低
- 1-2分：与科技无关

文章列表：
${articleListStr}

请严格输出JSON（不要包含markdown代码块标记）：
{
  "scores": [
    {"index": 1, "score": 8},
    {"index": 2, "score": 5}
  ]
}`;

  try {
    const data = await ctx.llm.chatJson<any>(prompt);
    const scoreMap = new Map<number, number>();
    if (Array.isArray(data.scores)) {
      for (const item of data.scores) {
        scoreMap.set(Number(item.index), Number(item.score));
      }
    }

    const filtered = articles.filter((_, i) => {
      const score = scoreMap.get(i + 1) ?? 0;
      return score >= LLM_FILTER_THRESHOLD;
    });

    ctx.log(
      `WeChat LLM 过滤: ${articles.length} → ${filtered.length} 篇（阈值≥${LLM_FILTER_THRESHOLD}）`,
    );

    // If all articles were filtered out, keep the originals rather than
    // showing an empty report.
    return filtered.length ? filtered : articles;
  } catch (e) {
    ctx.log(`WeChat LLM 过滤失败，保留全部文章: ${e}`);
    return articles;
  }
}

export async function run(ctx: ModuleContext): Promise<ModuleResult> {
  const { config, log, dateCompact } = ctx;
  const authKey = config.wechat_auth_key;
  const mpList = config.wechat_mp_ids || [];
  // Cap articles per MP to keep the report focused
  const limit = Math.min(config.wechat_limit_per_mp, MAX_ARTICLES_PER_MP);
  const daysRecent = config.wechat_days_recent;

  // ── FetchWeChatStage ──
  const lang0 = ctx.language || "zh";
  if (!authKey || !mpList.length) {
    log("WeChat tracker 未配置 auth_key / mp_ids，跳过");
    return {
      html: wechatArticlesToHtml([], new Map(), dateCompact, lang0),
      md: wechatArticlesToMd([], new Map(), dateCompact, lang0),
      count: 0,
    };
  }

  log(`Fetching WeChat (in-process), ${mpList.length} MPs, days_recent=${daysRecent}, limit_per_mp=${limit}`);
  let allArticles = await fetchAllMps(authKey, mpList, limit, daysRecent, log);

  // Cap total articles across all MPs
  if (allArticles.length > MAX_TOTAL_ARTICLES) {
    log(`WeChat: 总文章数 ${allArticles.length} 超过上限 ${MAX_TOTAL_ARTICLES}，截取前 ${MAX_TOTAL_ARTICLES} 篇`);
    allArticles = allArticles.slice(0, MAX_TOTAL_ARTICLES);
  }

  const knownIds = await getAllKnownIds();
  const today = dateCompact;

  // Dedup against DB: only carry forward articles never seen before.
  // This matches Blog/Official behavior — daily report shows NEW items only,
  // not a re-listing of everything in the recency window.
  const newArticles = allArticles.filter((a) => !knownIds.has(a.article_id));
  const skippedDup = allArticles.length - newArticles.length;

  for (const article of newArticles) {
    try {
      await upsertDiscovered(article, today);
    } catch (e) {
      log(`DB upsert failed for ${article.article_id}: ${e}`);
    }
  }

  if (skippedDup) log(`WeChat: 跳过 ${skippedDup} 篇已知文章`);
  if (newArticles.length) {
    log(`WeChat: 发现 ${newArticles.length} 篇新文章（最近 ${daysRecent} 天共 ${allArticles.length} 篇）`);
  } else {
    log(`WeChat: 无新文章（最近 ${daysRecent} 天共 ${allArticles.length} 篇全部已读）`);
  }

  // ── AnalyzeWeChatStage ──
  // newArticles are never-seen-before by construction, so there is no cached
  // analysis to restore — every new article needs LLM analysis.
  const analyses = new Map<string, WeChatAnalysis>();
  if (!newArticles.length) {
    log("无 WeChat 文章需要 LLM 分析");
  } else {
    log(`WeChat analyze: ${newArticles.length} need LLM`);

    if (!ctx.llm.isConfigured) {
      log("pipeline LLM 未配置，跳过 WeChat 分析");
    } else {
      const newAnalyses = await analyzeArticlesBatch(newArticles, ctx);
      for (const [key, analysis] of newAnalyses) {
        analyses.set(key, analysis);
        if (analysis) {
          try {
            await saveAnalysis(key, analysis);
          } catch (e) {
            log(`Failed to save WeChat analysis for ${key}: ${e}`);
          }
        }
      }
    }

    let success = 0;
    for (const a of analyses.values()) if (a && a.one_liner !== FAILED_ONE_LINER) success++;
    log(`WeChat analysis done: ${success}/${newArticles.length}`);
  }

  // ── LLM Filter Stage ──
  // Before rendering, use the pipeline LLM to filter articles by tech
  // relevance. Articles scoring below the threshold are dropped.
  const filteredArticles = await llmFilterArticles(newArticles, ctx);

  // ── BuildWeChatFragmentStage ──
  const lang = ctx.language || "zh";
  const html = wechatArticlesToHtml(filteredArticles, analyses, dateCompact, lang);
  const md = wechatArticlesToMd(filteredArticles, analyses, dateCompact, lang);

  if (filteredArticles.length) {
    log(`WeChat HTML+MD 片段已生成 (${html.length} chars, ${filteredArticles.length} 篇)`);
  } else {
    log("WeChat: 使用占位符");
  }

  return { html, md, count: filteredArticles.length };
}
