/**
 * Ascan Bridge — bridges the Express server to the embedded Python ascan pipeline.
 *
 * Responsibilities:
 *  - List / read HTML daily reports from ascan/docs/
 *  - Parse and update ascan/.env configuration
 *  - Spawn `python main_daily.py` to trigger pipeline runs
 *  - Check run status via lock files
 */

import { readdir, readFile, writeFile, stat } from "fs/promises";
import { join } from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ascan/ is at the noteone project root, 3 levels up from server/src/services/
const ASCAN_ROOT = resolve(__dirname, "../../../ascan");
const ASCAN_DOCS = join(ASCAN_ROOT, "docs");
const ASCAN_ENV = join(ASCAN_ROOT, ".env");
const ASCAN_LOGS = join(ASCAN_ROOT, "logs");

export interface AscanReportMeta {
  date: string;
  filename: string;
  size: number;
  hasMarkdown: boolean;
}

export interface AscanConfig {
  // LLM
  idealab_api_key: string;
  idealab_base_url: string;
  llm_model: string;
  llm_max_concurrency: number;
  // GitHub
  github_token: string;
  github_topics: string[];
  github_max_repos_per_topic: number;
  github_min_stars: number;
  github_top_analyze: number;
  // ArXiv
  arxiv_subjects: string[];
  arxiv_date_offset_days: number;
  max_papers_per_subject: number;
  max_total_papers: number;
  // Conference
  semantic_scholar_api_key: string;
  conference_lookback_days: number;
  conference_rank_filter: string[];
  conference_categories: string[];
  // Blog
  blog_max_per_source: number;
  // WeChat
  wechat_rss_base_url: string;
  wechat_limit_per_mp: number;
  // Output
  output_dir: string;
  log_level: string;
}

export interface AscanRunStatus {
  isRunning: boolean;
  lastLockTime: string | null;
  lockAge: string | null;
  recentLog: string | null;
}

// ── .env parsing ──────────────────────────────────────────────

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) return null;
  const key = trimmed.slice(0, eqIdx).trim();
  let value = trimmed.slice(eqIdx + 1).trim();
  // strip surrounding quotes
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const parsed = parseEnvLine(line);
    if (parsed) result[parsed.key] = parsed.value;
  }
  return result;
}

function parseList(value: string): string[] {
  if (!value) return [];
  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.every((v: unknown) => typeof v === "string")) {
        return parsed;
      }
    } catch {
      // fall through to comma split
    }
  }
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseInt2(value: string, fallback: number): number {
  const n = parseInt(value, 10);
  return isNaN(n) ? fallback : n;
}

function configFromEnv(env: Record<string, string>): AscanConfig {
  return {
    idealab_api_key: env.IDEALAB_API_KEY || "",
    idealab_base_url: env.IDEALAB_BASE_URL || "https://idealab.alibaba-inc.com/api/openai/v1",
    llm_model: env.LLM_MODEL || "Qwen3.6-Plus-DogFooding",
    llm_max_concurrency: parseInt2(env.LLM_MAX_CONCURRENCY, 5),

    github_token: env.GITHUB_TOKEN || "",
    github_topics: parseList(env.GITHUB_TOPICS || "digital-twin,digital-avatar,recommendation-system,product-recommendation,e-commerce,product-inspection,compliance-detection,content-moderation,customer-service,chatbot,conversational-ai,llm-agent,ai-agent,rag,multi-agent"),
    github_max_repos_per_topic: parseInt2(env.GITHUB_MAX_REPOS_PER_TOPIC, 8),
    github_min_stars: parseInt2(env.GITHUB_MIN_STARS, 500),
    github_top_analyze: parseInt2(env.GITHUB_TOP_ANALYZE, 20),

    arxiv_subjects: parseList(env.ARXIV_SUBJECTS || '["cs.AI","cs.IR","cs.CL","cs.MA","cs.CV"]'),
    arxiv_date_offset_days: parseInt2(env.ARXIV_DATE_OFFSET_DAYS, 1),
    max_papers_per_subject: parseInt2(env.MAX_PAPERS_PER_SUBJECT, 200),
    max_total_papers: parseInt2(env.MAX_TOTAL_PAPERS, 500),

    semantic_scholar_api_key: env.SEMANTIC_SCHOLAR_API_KEY || "",
    conference_lookback_days: parseInt2(env.CONFERENCE_LOOKBACK_DAYS, 30),
    conference_rank_filter: parseList(env.CONFERENCE_RANK_FILTER || "A,B"),
    conference_categories: parseList(env.CONFERENCE_CATEGORIES || "ai,nlp,cv,dm,ir"),

    blog_max_per_source: parseInt2(env.BLOG_MAX_PER_SOURCE, 2),

    wechat_rss_base_url: env.WECHAT_RSS_BASE_URL || "http://localhost:8001",
    wechat_limit_per_mp: parseInt2(env.WECHAT_LIMIT_PER_MP, 20),

    output_dir: env.OUTPUT_DIR || "./docs",
    log_level: env.LOG_LEVEL || "INFO",
  };
}

// ── .env writing ──────────────────────────────────────────────

const CONFIG_TO_ENV: Record<keyof AscanConfig, string> = {
  idealab_api_key: "IDEALAB_API_KEY",
  idealab_base_url: "IDEALAB_BASE_URL",
  llm_model: "LLM_MODEL",
  llm_max_concurrency: "LLM_MAX_CONCURRENCY",
  github_token: "GITHUB_TOKEN",
  github_topics: "GITHUB_TOPICS",
  github_max_repos_per_topic: "GITHUB_MAX_REPOS_PER_TOPIC",
  github_min_stars: "GITHUB_MIN_STARS",
  github_top_analyze: "GITHUB_TOP_ANALYZE",
  arxiv_subjects: "ARXIV_SUBJECTS",
  arxiv_date_offset_days: "ARXIV_DATE_OFFSET_DAYS",
  max_papers_per_subject: "MAX_PAPERS_PER_SUBJECT",
  max_total_papers: "MAX_TOTAL_PAPERS",
  semantic_scholar_api_key: "SEMANTIC_SCHOLAR_API_KEY",
  conference_lookback_days: "CONFERENCE_LOOKBACK_DAYS",
  conference_rank_filter: "CONFERENCE_RANK_FILTER",
  conference_categories: "CONFERENCE_CATEGORIES",
  blog_max_per_source: "BLOG_MAX_PER_SOURCE",
  wechat_rss_base_url: "WECHAT_RSS_BASE_URL",
  wechat_limit_per_mp: "WECHAT_LIMIT_PER_MP",
  output_dir: "OUTPUT_DIR",
  log_level: "LOG_LEVEL",
};

function serializeValue(key: keyof AscanConfig, value: any): string {
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }
  return value || "";
}

function updateEnvFile(existingContent: string, updates: Partial<AscanConfig>): string {
  const lines = existingContent.split("\n");
  const envKeyToConfigKey = Object.fromEntries(
    Object.entries(CONFIG_TO_ENV).map(([ck, ek]) => [ek, ck as keyof AscanConfig]),
  );
  const updatedKeys = new Set<string>();

  const formatLine = (envKey: string, configKey: keyof AscanConfig, value: any) => {
    const serialized = serializeValue(configKey, value);
    return `${envKey}="${serialized}"`;
  };

  const newLines = lines.map((line) => {
    const parsed = parseEnvLine(line);
    if (!parsed) return line;
    const configKey = envKeyToConfigKey[parsed.key];
    if (configKey && configKey in updates) {
      updatedKeys.add(parsed.key);
      return formatLine(parsed.key, configKey, updates[configKey]!);
    }
    return line;
  });

  for (const [configKey, envKey] of Object.entries(CONFIG_TO_ENV)) {
    if (configKey in updates && !updatedKeys.has(envKey)) {
      newLines.push(formatLine(envKey, configKey as keyof AscanConfig, updates[configKey as keyof AscanConfig]!));
    }
  }

  return newLines.join("\n");
}

// ── Public API ────────────────────────────────────────────────

export async function listReports(): Promise<AscanReportMeta[]> {
  try {
    const files = await readdir(ASCAN_DOCS);
    const htmlFiles = files.filter((f) => f.match(/^Ascan-\d{8}\.html$/));
    const reports: AscanReportMeta[] = [];
    for (const f of htmlFiles) {
      const date = f.match(/Ascan-(\d{8})\.html/)![1];
      const filePath = join(ASCAN_DOCS, f);
      const st = await stat(filePath);
      const hasMd = files.includes(`Ascan-${date}.md`);
      reports.push({ date, filename: f, size: st.size, hasMarkdown: hasMd });
    }
    reports.sort((a, b) => b.date.localeCompare(a.date));
    return reports;
  } catch {
    return [];
  }
}

export async function getReport(date: string): Promise<string | null> {
  const filePath = join(ASCAN_DOCS, `Ascan-${date}.html`);
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

export async function getConfig(): Promise<AscanConfig> {
  try {
    const content = await readFile(ASCAN_ENV, "utf-8");
    const env = parseEnvFile(content);
    return configFromEnv(env);
  } catch {
    return configFromEnv({});
  }
}

export async function updateConfig(updates: Partial<AscanConfig>): Promise<AscanConfig> {
  let content = "";
  try {
    content = await readFile(ASCAN_ENV, "utf-8");
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
  }
  const updated = updateEnvFile(content, updates);
  await writeFile(ASCAN_ENV, updated, "utf-8");
  return getConfig();
}

const RUNNING_LOCK_MS = 5 * 60_000;

export async function triggerRun(date?: string): Promise<{ pid: number; message: string }> {
  if (!date) {
    const today = new Date();
    const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    const lockPath = join(ASCAN_LOGS, `ascan_${dateStr}.lock`);
    try {
      const st = await stat(lockPath);
      const ageMs = Date.now() - st.mtimeMs;
      if (ageMs < RUNNING_LOCK_MS) {
        throw new Error("A pipeline run is already in progress");
      }
    } catch (err: any) {
      if (err?.code !== "ENOENT") throw err;
    }
  }
  const args = ["main_daily.py"];
  if (date) {
    args.push("--date", date);
  }
  const child = spawn("python3", args, {
    cwd: ASCAN_ROOT,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return new Promise((resolve2, reject) => {
    child.on("spawn", () => {
      resolve2({ pid: child.pid!, message: `Ascan pipeline started (pid: ${child.pid})` });
    });
    child.on("error", (err) => {
      reject(new Error(`Failed to start ascan: ${err.message}`));
    });
  });
}

export async function getRunStatus(): Promise<AscanRunStatus> {
  const today = new Date();
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const lockPath = join(ASCAN_LOGS, `ascan_${dateStr}.lock`);

  try {
    const st = await stat(lockPath);
    const ageMs = Date.now() - st.mtimeMs;
    const ageHours = (ageMs / 3600000).toFixed(1);
    return {
      isRunning: ageMs < RUNNING_LOCK_MS,
      lastLockTime: st.mtime.toISOString(),
      lockAge: `${ageHours}h`,
      recentLog: null,
    };
  } catch {
    return { isRunning: false, lastLockTime: null, lockAge: null, recentLog: null };
  }
}
