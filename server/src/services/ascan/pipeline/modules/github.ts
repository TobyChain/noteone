/**
 * GitHub module — TS port of ascan/src/github_agent/ (daily only).
 * Single-file pipeline: fetch (Trending + Search API) → dedup → enrich
 * (README/file tree) → LLM analyze → render HTML/MD fragments.
 *
 * Faithful port of fetcher.py / analyzer.py / report.py / stages.py
 * (weekly logic intentionally not ported).
 */
import * as cheerio from "cheerio";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../../../../db/client.js";
import { ascanGithubRepos } from "../../../../db/schema.js";
import type { ModuleContext, ModuleResult } from "../types.js";
import { escapeHtml, fetchWithTimeout, sleep } from "../util.js";

// ── constants (fetcher.py) ────────────────────────────────────────────────

const TRENDING_URL = "https://github.com/trending";
const API_BASE = "https://api.github.com";
const HEADERS_BASE: Record<string, string> = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

/** AI/Agent 相关关键词，用于从 Trending 中过滤 */
const AI_KEYWORDS = [
  "agent", "llm", "gpt", "ai", "rag", "mcp", "langchain", "autogen",
  "copilot", "assistant", "chatbot", "reasoning", "prompt", "embedding",
  "vector", "inference", "fine-tune", "finetune", "multimodal", "vision",
  "openai", "anthropic", "gemini", "claude", "mistral", "ollama",
  "memory", "tool", "workflow", "pipeline", "orchestrat",
];

// ── models (models.py) ────────────────────────────────────────────────────

interface RepoInfo {
  full_name: string;          // e.g. "microsoft/autogen"
  owner: string;
  name: string;
  description: string | null;
  stars: number;
  forks: number;
  language: string | null;
  topics: string[];
  url: string;                // https://github.com/owner/repo
  homepage: string | null;
  pushed_at: string | null;   // ISO 8601
  created_at: string | null;
  stars_today: number | null; // from Trending page
  readme_summary: string | null; // first 3000 chars of README
  top_files: string[];        // key source file paths
}

interface RepoAnalysis {
  one_liner: string;
  positioning: string;
  core_tech: string;
  use_cases: string;
  comparison: string;
  watch_reason: string;
  relevance: string; // 高度相关/相关/一般/较低
}

function makeRepo(partial: Partial<RepoInfo> & { full_name: string; owner: string; name: string; url: string }): RepoInfo {
  return {
    description: null,
    stars: 0,
    forks: 0,
    language: null,
    topics: [],
    homepage: null,
    pushed_at: null,
    created_at: null,
    stars_today: null,
    readme_summary: null,
    top_files: [],
    ...partial,
  };
}

// ── fetcher (fetcher.py) ──────────────────────────────────────────────────

class GitHubFetcher {
  private headers: Record<string, string>;
  private log: (msg: string) => void;

  constructor(token: string | undefined, log: (msg: string) => void) {
    this.headers = { ...HEADERS_BASE };
    if (token) this.headers.Authorization = `Bearer ${token}`;
    this.log = log;
  }

  // ── Trending ────────────────────────────────────────────────────────────

  /**
   * Scrape github.com/trending for repos. since: "daily" (weekly/monthly not ported).
   * Returns up to 25 RepoInfo objects (GitHub shows 25 per page).
   */
  async fetchTrending(language = "", since = "daily"): Promise<RepoInfo[]> {
    let url = `${TRENDING_URL}?since=${since}`;
    if (language) url += `&l=${language}`;

    let html: string;
    try {
      const resp = await fetchWithTimeout(url, { headers: this.headers }, 20_000);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      html = await resp.text();
    } catch (e) {
      this.log(`[github] Trending fetch failed: ${e}`);
      return [];
    }

    const $ = cheerio.load(html);
    const repos: RepoInfo[] = [];
    $("article.Box-row").each((_, article) => {
      try {
        const $article = $(article);

        // full_name
        const h2 = $article.find("h2 a").first();
        if (!h2.length) return;
        const fullName = (h2.attr("href") || "").replace(/^\/+|\/+$/g, ""); // "owner/repo"
        const parts = fullName.split("/");
        if (parts.length !== 2) return;
        const [owner, name] = parts;

        // description
        const p = $article.find("p").first();
        const description = p.length ? p.text().trim().replace(/\s+/g, " ") : null;

        // language
        const langSpan = $article.find("[itemprop=programmingLanguage]").first();
        const languageVal = langSpan.length ? langSpan.text().trim() : null;

        // stars total — try multiple selectors
        let stars = 0;
        for (const selector of ["a[href$='/stargazers']", "a.Link--muted"]) {
          const starLink = $article.find(selector).first();
          if (starLink.length) {
            const text = starLink.text().trim().replace(/,/g, "").replace(/k/g, "000");
            const digits = text.replace(/[^\d]/g, "");
            if (digits) {
              stars = parseInt(digits, 10);
              break;
            }
          }
        }

        // stars today
        let starsToday: number | null = null;
        $article.find("span").each((__, span) => {
          if (starsToday !== null) return;
          const text = $(span).text().trim();
          const m = text.match(/([\d,]+)\s+stars\s+today/i);
          if (m) starsToday = parseInt(m[1].replace(/,/g, ""), 10);
        });

        repos.push(makeRepo({
          full_name: fullName,
          owner,
          name,
          description,
          stars,
          stars_today: starsToday,
          language: languageVal,
          url: `https://github.com/${fullName}`,
        }));
      } catch {
        // skip malformed article
      }
    });

    this.log(`[github] Trending (${since}): scraped ${repos.length} repos`);
    return repos;
  }

  /** Fetch trending repos and keep only AI/Agent related ones (keyword match on name/description). */
  async fetchTrendingAi(since = "daily"): Promise<RepoInfo[]> {
    const allRepos = await this.fetchTrending("", since);
    const filtered = allRepos.filter((repo) => {
      const text = `${repo.name} ${repo.description || ""}`.toLowerCase();
      return AI_KEYWORDS.some((kw) => text.includes(kw));
    });
    this.log(`[github] Trending AI filter: ${allRepos.length} → ${filtered.length} repos`);
    return filtered;
  }

  // ── Search API ──────────────────────────────────────────────────────────

  /**
   * Search repos by GitHub topic label (per page 30, sorted by `sort` desc).
   * 403 is treated as a rate-limit warning and returns [].
   */
  async searchByTopic(topic: string, minStars = 500, maxResults = 10, sort = "updated", page = 1): Promise<RepoInfo[]> {
    const params = new URLSearchParams({
      q: `topic:${topic} stars:>=${minStars}`,
      sort,
      order: "desc",
      per_page: String(Math.min(maxResults, 30)),
      page: String(page),
    });
    let data: any;
    try {
      const resp = await fetchWithTimeout(`${API_BASE}/search/repositories?${params}`, { headers: this.headers }, 20_000);
      if (resp.status === 403) {
        this.log(`[github] GitHub API rate limited for topic=${topic}`);
        return [];
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      data = await resp.json();
    } catch (e) {
      this.log(`[github] Search topic=${topic} failed: ${e}`);
      return [];
    }

    const repos = ((data?.items as any[]) || []).map((item) => this.itemToRepo(item));
    // Respect rate limit: Search API = 30 req/min authenticated
    await sleep(2000);
    return repos;
  }

  /**
   * Search by topic, skipping repos whose full_name is in skipNames.
   * Keeps fetching additional pages until `want` fresh repos are collected
   * or maxPages is exhausted.
   */
  async searchByTopicSkipKnown(
    topic: string,
    skipNames: Set<string>,
    minStars = 500,
    want = 10,
    sort = "updated",
    maxPages = 5,
  ): Promise<RepoInfo[]> {
    const results: RepoInfo[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const batch = await this.searchByTopic(topic, minStars, 30, sort, page);
      if (!batch.length) break;
      const fresh = batch.filter((r) => !skipNames.has(r.full_name));
      results.push(...fresh);
      if (results.length >= want) break;
      // If the whole page was known repos and there might be more, keep going
      if (batch.length < 30) break; // last page reached
    }
    return results.slice(0, want);
  }

  // ── README + file tree ──────────────────────────────────────────────────

  /** Return first maxChars of decoded README, or null. */
  async fetchReadme(fullName: string, maxChars = 3000): Promise<string | null> {
    try {
      const resp = await fetchWithTimeout(
        `${API_BASE}/repos/${fullName}/readme`,
        { headers: { ...this.headers, Accept: "application/vnd.github.raw" } },
        20_000,
      );
      if (resp.status === 404) return null;
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return (await resp.text()).slice(0, maxChars);
    } catch {
      return null;
    }
  }

  /** Return list of top-level source file/dir paths from the default branch. */
  async fetchTopFiles(fullName: string): Promise<string[]> {
    try {
      const resp = await fetchWithTimeout(`${API_BASE}/repos/${fullName}/contents`, { headers: this.headers }, 15_000);
      if (resp.status !== 200) return [];
      const items = await resp.json();
      if (!Array.isArray(items)) return [];
      const names = items
        .slice(0, 30)
        .filter((item: any) => item?.type === "file" || item?.type === "dir")
        .map((item: any) => item.name as string);
      return names.slice(0, 20);
    } catch {
      return [];
    }
  }

  /** Fetch README + top files and attach to RepoInfo. */
  async enrichRepo(repo: RepoInfo): Promise<RepoInfo> {
    repo.readme_summary = await this.fetchReadme(repo.full_name);
    repo.top_files = await this.fetchTopFiles(repo.full_name);
    await sleep(500); // avoid secondary rate limit
    return repo;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private itemToRepo(item: any): RepoInfo {
    return makeRepo({
      full_name: item.full_name,
      owner: item.owner?.login ?? "",
      name: item.name,
      description: item.description ?? null,
      stars: item.stargazers_count ?? 0,
      forks: item.forks_count ?? 0,
      language: item.language ?? null,
      topics: Array.isArray(item.topics) ? item.topics : [],
      url: item.html_url,
      homepage: item.homepage ?? null,
      pushed_at: item.pushed_at ?? null,
      created_at: item.created_at ?? null,
    });
  }

  /** Remove duplicates by full_name, keep highest-stars copy. */
  deduplicate(repos: RepoInfo[]): RepoInfo[] {
    const seen = new Map<string, RepoInfo>();
    for (const r of repos) {
      const existing = seen.get(r.full_name);
      if (!existing || r.stars > existing.stars) seen.set(r.full_name, r);
    }
    return [...seen.values()];
  }

  /** Keep repos with min_stars. */
  filterAiRelevant(repos: RepoInfo[], minStars = 500): RepoInfo[] {
    return repos.filter((r) => r.stars >= minStars);
  }
}

// ── DB access (database/repositories.py: RepoRepository) ─────────────────

/** Return a set of full_name strings for all repos that have been LLM-analyzed. */
async function getAllAnalyzedNames(): Promise<Set<string>> {
  const rows = await db
    .select({ fullName: ascanGithubRepos.fullName })
    .from(ascanGithubRepos)
    .where(and(eq(ascanGithubRepos.analyzed, true), isNotNull(ascanGithubRepos.oneLiner)));
  return new Set(rows.map((r) => r.fullName));
}

/** Fetch existing repo rows for the given full_names in a single query, keyed by full_name. */
async function getByFullNames(fullNames: string[]) {
  if (!fullNames.length) return new Map<string, typeof ascanGithubRepos.$inferSelect>();
  const rows = await db
    .select()
    .from(ascanGithubRepos)
    .where(inArray(ascanGithubRepos.fullName, fullNames));
  return new Map(rows.map((r) => [r.fullName, r]));
}

/**
 * Insert or update repo records. Updates star history and seen tracking.
 * Existing rows are pre-fetched in one query; new repos are batch-inserted;
 * existing repos are updated one by one (starsHistory merge needs old values).
 */
async function upsertRepos(repos: RepoInfo[], today: string): Promise<void> {
  if (!repos.length) return;
  const existingMap = await getByFullNames(repos.map((r) => r.full_name));

  const newRows = repos
    .filter((r) => !existingMap.has(r.full_name))
    .map((repo) => ({
      fullName: repo.full_name,
      owner: repo.owner,
      name: repo.name,
      description: repo.description,
      stars: repo.stars,
      forks: repo.forks,
      language: repo.language,
      topics: repo.topics,
      url: repo.url,
      pushedAt: repo.pushed_at,
      repoCreatedAt: repo.created_at,
      firstSeenDate: today,
      lastSeenDate: today,
      seenCount: 1,
      starsHistory: { [today]: repo.stars },
      analyzed: false,
    }));
  if (newRows.length) {
    await db.insert(ascanGithubRepos).values(newRows);
  }

  for (const repo of repos) {
    const existing = existingMap.get(repo.full_name);
    if (!existing) continue;
    const history: Record<string, number> = { ...((existing.starsHistory as Record<string, number>) || {}) };
    history[today] = repo.stars;
    await db
      .update(ascanGithubRepos)
      .set({
        stars: repo.stars,
        forks: repo.forks,
        description: repo.description,
        pushedAt: repo.pushed_at,
        lastSeenDate: today,
        seenCount: (existing.seenCount || 0) + 1,
        starsHistory: history,
        updatedAtTs: new Date(),
      })
      .where(eq(ascanGithubRepos.fullName, repo.full_name));
  }
}

/** Persist LLM analysis fields to an existing repo row. */
async function saveAnalysis(fullName: string, analysis: RepoAnalysis): Promise<void> {
  await db
    .update(ascanGithubRepos)
    .set({
      oneLiner: analysis.one_liner,
      positioning: analysis.positioning,
      coreTech: analysis.core_tech,
      useCases: analysis.use_cases,
      comparison: analysis.comparison,
      watchReason: analysis.watch_reason,
      relevance: analysis.relevance,
      analyzed: true,
      updatedAtTs: new Date(),
    })
    .where(eq(ascanGithubRepos.fullName, fullName));
}

// ── analyzer (analyzer.py) ────────────────────────────────────────────────

/** Build a compact JSON prompt for repo analysis (verbatim port of _build_repo_prompt). */
function buildRepoPrompt(repo: RepoInfo): string {
  const readme = (repo.readme_summary || "").slice(0, 800).replace(/\n/g, " ").replace(/"/g, "'");
  const filesStr = repo.top_files.length ? repo.top_files.slice(0, 15).join(", ") : "unknown";
  const desc = (repo.description || "no description").replace(/"/g, "'");

  return (
    `分析这个GitHub仓库并仅以JSON格式回复，不要有其他文字，不要markdown代码块。` +
    `仓库: ${repo.full_name} | ` +
    `描述: ${desc} | ` +
    `Stars: ${repo.stars} | ` +
    `语言: ${repo.language || "unknown"} | ` +
    `Topics: ${repo.topics.length ? repo.topics.slice(0, 8).join(", ") : "none"} | ` +
    `主要文件: ${filesStr} | ` +
    `README摘要: ${readme} | ` +
    `请返回JSON对象，包含以下字段：` +
    `one_liner(用大白话一句话说清这个项目能干什么，中文，不超过30字，不要用XX是开头，不要堆术语，像给产品经理介绍一样通俗易懂)，` +
    `positioning(项目定位：解决什么问题、面向什么用户，中文2-3句)，` +
    `core_tech(核心技术亮点或架构特点，中文2-3句)，` +
    `use_cases(典型使用场景，中文1-2句)，` +
    `comparison(与AutoGen/LangGraph/CrewAI等同类项目对比，若无同类写暂无，中文1-2句)，` +
    `watch_reason(为什么值得关注以及star增长原因，中文1-2句)，` +
    `relevance(与大模型及智能体方向（大模型算法/Agent算法/智能体架构/智能体记忆/大模型前沿）的相关性，必须是以下四个值之一：高度相关/相关/一般/较低)`
  );
}

const ANALYSIS_FIELDS = ["one_liner", "positioning", "core_tech", "use_cases", "comparison", "watch_reason"] as const;

/** Call LLM to analyze a single repo (3 attempts). Returns RepoAnalysis or null on failure. */
async function analyzeRepo(ctx: ModuleContext, repo: RepoInfo): Promise<RepoAnalysis | null> {
  const prompt = buildRepoPrompt(repo);

  let data: any;
  try {
    // All fields are required (mirrors pydantic RepoAnalysis validation)
    data = await ctx.llm.chatJsonRetry(
      prompt,
      (d: any) => ANALYSIS_FIELDS.every((f) => typeof d?.[f] === "string"),
      3,
    );
  } catch (e) {
    ctx.log(`[github] [${repo.full_name}] analysis failed after 3 attempts: ${e}`);
    return null;
  }

  // Normalize relevance field to allowed values
  let relevance: string = typeof data.relevance === "string" ? data.relevance : "一般";
  const allowed = new Set(["高度相关", "相关", "一般", "较低"]);
  if (!allowed.has(relevance)) {
    // Try partial match
    const partial = ["高度相关", "相关", "较低"].find((val) => relevance.includes(val));
    relevance = partial ?? "一般";
  }

  const analysis: RepoAnalysis = {
    one_liner: data.one_liner,
    positioning: data.positioning,
    core_tech: data.core_tech,
    use_cases: data.use_cases,
    comparison: data.comparison,
    watch_reason: data.watch_reason,
    relevance,
  };
  ctx.log(`[github] [${repo.full_name}] analyzed: ${analysis.one_liner}`);
  return analysis;
}

// ── report (report.py + tools/report_md.py) ───────────────────────────────

const RELEVANCE_ORDER: Record<string, number> = { 高度相关: 0, 相关: 1, 一般: 2, 较低: 3 };

function starsBadge(stars: number): string {
  if (stars >= 10000) return `⭐${Math.floor(stars / 1000)}k`;
  if (stars >= 1000) return `⭐${(stars / 1000).toFixed(1)}k`;
  return `⭐${stars}`;
}

function todayBadge(starsToday: number | null): string {
  if (starsToday === null) return "";
  return ` (+${starsToday} 今日)`;
}

function repoLink(repo: RepoInfo): string {
  return (
    `<a href="${escapeHtml(repo.url)}" target="_blank" rel="noopener noreferrer">` +
    `${escapeHtml(repo.full_name)}</a>`
  );
}

/** Build a daily GitHub HTML fragment (port of repos_to_daily_html). */
function reposToDailyHtml(
  repos: RepoInfo[],
  analyses: Map<string, RepoAnalysis | null>,
  reportDate: string,
): string {
  if (!repos.length) return '<p class="empty-state">今日无 GitHub 项目数据。</p>';

  const repoMap = new Map(repos.map((repo) => [repo.full_name, repo]));
  const starsOf = (name: string) => repoMap.get(name)?.stars ?? 0;

  const highRelevance = [...analyses.entries()].filter(
    ([, analysis]) => analysis !== null && analysis.relevance === "高度相关",
  ) as Array<[string, RepoAnalysis]>;
  highRelevance.sort((a, b) => starsOf(b[0]) - starsOf(a[0]));
  const tableRows = highRelevance.slice(0, 15);

  const sections: string[] = [`<div class="report-list github-list" data-date="${escapeHtml(reportDate)}">`];
  sections.push(
    '<p class="section-note">聚焦大模型与智能体相关项目（大模型算法/Agent算法/智能体架构/智能体记忆/大模型前沿）' +
    `，共发现 ${repos.length} 个仓库。</p>`,
  );

  sections.push(`<h3>今日精选（高度相关，共 ${tableRows.length} 个）</h3>`);
  if (tableRows.length) {
    sections.push('<div class="table-wrapper"><table>');
    sections.push("<thead><tr><th>项目</th><th>语言</th><th>Stars</th><th>一句话描述</th></tr></thead>");
    sections.push("<tbody>");
    for (const [fullName, analysis] of tableRows) {
      const repo = repoMap.get(fullName);
      if (!repo) continue;
      sections.push(
        "<tr>" +
        `<td>${repoLink(repo)}</td>` +
        `<td>${escapeHtml(repo.language || "—")}</td>` +
        `<td>${escapeHtml(starsBadge(repo.stars))}</td>` +
        `<td>${escapeHtml(analysis.one_liner)}</td>` +
        "</tr>",
      );
    }
    sections.push("</tbody></table></div>");
  } else {
    sections.push('<p class="empty-state">今日暂无高度相关仓库。</p>');
  }

  const analyzed = [...analyses.entries()].filter(([, a]) => a !== null) as Array<[string, RepoAnalysis]>;
  if (analyzed.length) {
    sections.push("<h3>精选项目深度解析</h3>");
    analyzed.sort((a, b) =>
      (RELEVANCE_ORDER[a[1].relevance] ?? 9) - (RELEVANCE_ORDER[b[1].relevance] ?? 9) ||
      starsOf(b[0]) - starsOf(a[0]),
    );
    for (const [fullName, analysis] of analyzed) {
      const repo = repoMap.get(fullName);
      if (!repo) continue;
      const topicTags = repo.topics
        .slice(0, 6)
        .map((topic) => `<span class="tag">${escapeHtml(topic)}</span>`)
        .join("");
      sections.push('<article class="card repo-card">');
      sections.push(`<h4>${repoLink(repo)}</h4>`);
      sections.push(`<p class="lead">${escapeHtml(analysis.one_liner)}</p>`);
      sections.push('<ul class="meta-list">');
      sections.push(`<li><strong>相关性：</strong>${escapeHtml(analysis.relevance)}</li>`);
      sections.push(`<li><strong>Stars：</strong>${escapeHtml(starsBadge(repo.stars) + todayBadge(repo.stars_today))}</li>`);
      sections.push(`<li><strong>语言：</strong>${escapeHtml(repo.language || "—")}</li>`);
      sections.push("</ul>");
      if (topicTags) sections.push(`<div class="tags">${topicTags}</div>`);
      sections.push(`<p><strong>定位：</strong>${escapeHtml(analysis.positioning)}</p>`);
      sections.push(`<p><strong>核心技术：</strong>${escapeHtml(analysis.core_tech)}</p>`);
      sections.push(`<p><strong>使用场景：</strong>${escapeHtml(analysis.use_cases)}</p>`);
      sections.push(`<p><strong>对比同类：</strong>${escapeHtml(analysis.comparison)}</p>`);
      sections.push(`<p><strong>值得关注：</strong>${escapeHtml(analysis.watch_reason)}</p>`);
      sections.push("</article>");
    }
  }

  // ── All repos list ──────────────────────────────────────────────
  const allAnalyzedNames = new Set(analyses.keys());
  const unanalyzed = repos.filter((r) => !allAnalyzedNames.has(r.full_name));
  if (unanalyzed.length) {
    sections.push("<h3>其他仓库</h3>");
    sections.push('<ul class="repo-link-list">');
    for (const repo of unanalyzed) {
      sections.push(
        `<li>${repoLink(repo)} ` +
        `<span class="repo-meta">${starsBadge(repo.stars)}</span> ` +
        `<span class="repo-lang">${escapeHtml(repo.language || "")}</span></li>`,
      );
    }
    sections.push("</ul>");
  }

  sections.push("</div>");
  return sections.join("\n");
}

/** Build a daily GitHub Markdown fragment (port of repos_to_daily_md). */
function reposToDailyMd(
  repos: RepoInfo[],
  analyses: Map<string, RepoAnalysis | null>,
  _reportDate: string,
): string {
  if (!repos.length) return "_今日无 GitHub 项目数据。_";

  const repoMap = new Map(repos.map((repo) => [repo.full_name, repo]));
  const starsOf = (name: string) => repoMap.get(name)?.stars ?? 0;
  const mdStars = (stars: number) => (stars >= 1000 ? `⭐${Math.floor(stars / 1000)}k` : `⭐${stars}`);

  const highRelevance = [...analyses.entries()].filter(
    ([, a]) => a !== null && a.relevance === "高度相关",
  ) as Array<[string, RepoAnalysis]>;
  highRelevance.sort((a, b) => starsOf(b[0]) - starsOf(a[0]));
  const tableRows = highRelevance.slice(0, 15);

  const lines: string[] = [];
  lines.push(`共发现 ${repos.length} 个仓库，聚焦大模型与智能体相关项目。`);
  lines.push("");

  lines.push(`#### 今日精选（高度相关，共 ${tableRows.length} 个）`);
  lines.push("");
  if (tableRows.length) {
    lines.push("| 项目 | 语言 | Stars | 一句话描述 |");
    lines.push("|------|------|-------|-----------|");
    for (const [name, analysis] of tableRows) {
      const repo = repoMap.get(name);
      if (!repo) continue;
      lines.push(`| [${repo.full_name}](${repo.url}) | ${repo.language || "—"} | ${mdStars(repo.stars)} | ${analysis.one_liner} |`);
    }
    lines.push("");
  } else {
    lines.push("_今日暂无高度相关仓库。_");
    lines.push("");
  }

  const analyzed = [...analyses.entries()].filter(([, a]) => a !== null) as Array<[string, RepoAnalysis]>;
  analyzed.sort((a, b) =>
    (RELEVANCE_ORDER[a[1].relevance] ?? 9) - (RELEVANCE_ORDER[b[1].relevance] ?? 9) ||
    starsOf(b[0]) - starsOf(a[0]),
  );

  if (analyzed.length) {
    lines.push("#### 精选项目深度解析");
    lines.push("");
    for (const [name, analysis] of analyzed) {
      const repo = repoMap.get(name);
      if (!repo) continue;
      const topics = repo.topics.length ? repo.topics.slice(0, 6).map((t) => `\`${t}\``).join(" ") : "";

      lines.push(`##### [${repo.full_name}](${repo.url})`);
      lines.push("");
      lines.push(`**${analysis.one_liner}**`);
      lines.push("");
      lines.push(`- **相关性：** ${analysis.relevance}`);
      lines.push(`- **Stars：** ${mdStars(repo.stars)}`);
      lines.push(`- **语言：** ${repo.language || "—"}`);
      if (topics) lines.push(`- **标签：** ${topics}`);
      lines.push(`- **定位：** ${analysis.positioning}`);
      lines.push(`- **核心技术：** ${analysis.core_tech}`);
      lines.push(`- **使用场景：** ${analysis.use_cases}`);
      lines.push(`- **对比同类：** ${analysis.comparison}`);
      lines.push(`- **值得关注：** ${analysis.watch_reason}`);
      lines.push("");
      lines.push("---");
      lines.push("");
    }
  }

  // ── All repos link list ─────────────────────────────────────────
  const analyzedNames = new Set(analyses.keys());
  const unanalyzed = repos.filter((r) => !analyzedNames.has(r.full_name));
  if (unanalyzed.length) {
    lines.push("#### 其他仓库");
    lines.push("");
    for (const repo of unanalyzed) {
      lines.push(`- [${repo.full_name}](${repo.url}) ${mdStars(repo.stars)} ${repo.language || ""}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── module entry (stages.py, daily only) ──────────────────────────────────

export async function run(ctx: ModuleContext): Promise<ModuleResult> {
  const { config, log, dateCompact } = ctx;
  const fetcher = new GitHubFetcher(config.github_token || undefined, log);

  // ── Stage 1: Fetch ── already-analyzed repos go to the END of the list so
  // the top-N analysis window always sees fresh repos first.
  const analyzedNames = await getAllAnalyzedNames();
  log(`[github] Already analyzed in DB: ${analyzedNames.size} repos`);

  let newRepos: RepoInfo[] = []; // never-analyzed repos
  let oldRepos: RepoInfo[] = []; // already-analyzed repos (shown in table but not re-analyzed)

  // 1. Trending (daily) — classify into new / old
  try {
    const trending = await fetcher.fetchTrendingAi("daily");
    for (const r of trending) {
      (analyzedNames.has(r.full_name) ? oldRepos : newRepos).push(r);
    }
    const knownCount = trending.filter((r) => analyzedNames.has(r.full_name)).length;
    log(`[github] Trending daily: ${trending.length} total (${trending.length - knownCount} new)`);
  } catch (e) {
    log(`[github] Trending fetch failed (non-fatal): ${e}`);
  }

  // 2. Search API by topic — use skip_known to prioritize fresh repos
  for (const topic of config.github_topics) {
    try {
      const fresh = await fetcher.searchByTopicSkipKnown(
        topic,
        analyzedNames,
        config.github_min_stars,
        config.github_max_repos_per_topic,
        "updated",
        5,
      );
      newRepos.push(...fresh);
      log(`[github] Topic '${topic}': ${fresh.length} new repos`);
    } catch (e) {
      log(`[github] Topic search '${topic}' failed (non-fatal): ${e}`);
    }
  }

  // Deduplicate within each bucket
  newRepos = fetcher.deduplicate(newRepos);
  newRepos = fetcher.filterAiRelevant(newRepos, config.github_min_stars);
  newRepos.sort((a, b) => b.stars - a.stars);

  oldRepos = fetcher.deduplicate(oldRepos);
  const newNames = new Set(newRepos.map((x) => x.full_name));
  oldRepos = oldRepos.filter((r) => !newNames.has(r.full_name));
  oldRepos.sort((a, b) => b.stars - a.stars);

  // Final list: new first, then old — analysis window will naturally hit new ones
  const repos = [...newRepos, ...oldRepos];
  log(`[github] Fetch done: ${newRepos.length} new + ${oldRepos.length} known = ${repos.length} total`);

  // Persist to DB
  await upsertRepos(repos, dateCompact);

  if (!repos.length) {
    return {
      html: reposToDailyHtml([], new Map(), dateCompact),
      md: reposToDailyMd([], new Map(), dateCompact),
      count: 0,
    };
  }

  // ── Stage 2: Enrich ── README + file tree for top-N not-yet-analyzed repos
  const topN = config.github_top_analyze;
  const toEnrich = repos.slice(0, topN).filter((r) => !analyzedNames.has(r.full_name));
  log(`[github] Enrich: top_n=${topN}, already_analyzed=${Math.min(topN, repos.length) - toEnrich.length}, need_enrich=${toEnrich.length}`);
  for (const repo of toEnrich) {
    try {
      await fetcher.enrichRepo(repo);
    } catch (e) {
      log(`[github] Enrich failed for ${repo.full_name}: ${e}`);
    }
  }

  // ── Stage 3: Analyze ── LLM batch analysis of top-N repos
  const topRepos = repos.slice(0, topN);
  const analyses = new Map<string, RepoAnalysis | null>();

  // Pass 1: restore already-analyzed repos from DB (single batch query)
  let cachedCount = 0;
  const cachedNames = topRepos
    .filter((r) => analyzedNames.has(r.full_name))
    .map((r) => r.full_name);
  const cachedRows = await getByFullNames(cachedNames);
  for (const fullName of cachedNames) {
    const row = cachedRows.get(fullName);
    if (row && row.analyzed && row.oneLiner) {
      analyses.set(fullName, {
        one_liner: row.oneLiner || "",
        positioning: row.positioning || "",
        core_tech: row.coreTech || "",
        use_cases: row.useCases || "",
        comparison: row.comparison || "",
        watch_reason: row.watchReason || "",
        relevance: row.relevance || "一般",
      });
      cachedCount++;
      log(`[github] [cache] ${fullName}: ${(row.oneLiner || "").slice(0, 40)}`);
    }
  }

  // Pass 2: concurrent LLM analysis of the rest
  const toAnalyze = topRepos.filter((r) => !analyses.has(r.full_name));
  log(`[github] Analyze: top_n=${topN}, cached=${cachedCount}, need_llm=${toAnalyze.length}`);

  if (toAnalyze.length && !ctx.llm.isConfigured) {
    log("[github] LLM not configured — skipping analysis");
  } else if (toAnalyze.length) {
    const results = await ctx.llm.mapConcurrent(
      toAnalyze,
      async (repo) => {
        log(`[github] Analyzing: ${repo.full_name}`);
        return { repo, analysis: await analyzeRepo(ctx, repo) };
      },
      (repo) => ({ repo, analysis: null as RepoAnalysis | null }),
    );
    for (const { repo, analysis } of results) {
      analyses.set(repo.full_name, analysis);
      if (analysis) {
        try {
          await saveAnalysis(repo.full_name, analysis);
        } catch (e) {
          log(`[github] Failed to save analysis for ${repo.full_name}: ${e}`);
        }
      }
    }
  }

  const successCount = [...analyses.values()].filter((a) => a !== null).length;
  log(`[github] Analysis done: ${successCount}/${topRepos.length} total (${cachedCount} from cache, ${toAnalyze.length} new LLM calls)`);

  // ── Stage 4: Render fragments ──
  const html = reposToDailyHtml(repos, analyses, dateCompact);
  const md = reposToDailyMd(repos, analyses, dateCompact);
  log("[github] GitHub HTML + MD 片段已生成，等待统一日报合并");

  return { html, md, count: repos.length };
}
