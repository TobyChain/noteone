/**
 * Ascan configuration — .env parsing/serialization for the Python pipeline.
 * Extracted from the former ascan-bridge.ts.
 */
import { readFile, writeFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, resolve, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ascan/ is at the noteone project root. This file lives at server/src/services/ascan/,
// so the project root is 4 levels up.
const ASCAN_ROOT = resolve(__dirname, "../../../../ascan");
const ASCAN_DOCS = join(ASCAN_ROOT, "docs");
const ASCAN_ENV = join(ASCAN_ROOT, ".env");
const ASCAN_LOGS = join(ASCAN_ROOT, "logs");

export { ASCAN_ROOT, ASCAN_DOCS, ASCAN_ENV, ASCAN_LOGS };

export interface AscanConfig {
  // LLM
  llm_api_key: string;
  llm_base_url: string;
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
  conference_days_recent: number;
  // Blog
  blog_max_per_source: number;
  // WeChat MP (WAE — wechat-article-exporter)
  wechat_wae_url: string;
  wechat_wae_auth_key: string;
  wechat_mp_ids: Array<{ id: string; name: string }>;
  wechat_limit_per_mp: number;
  wechat_days_recent: number;
  // Output
  output_dir: string;
  log_level: string;
}

// ── .env parsing ──────────────────────────────────────────────

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) return null;
  const key = trimmed.slice(0, eqIdx).trim();
  let value = trimmed.slice(eqIdx + 1).trim();
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

function parseMpList(value: string): Array<{ id: string; name: string }> {
  if (!value) return [];
  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.every((v: unknown) => v && typeof v === "object" && "id" in v)) {
        return parsed as Array<{ id: string; name: string }>;
      }
    } catch {
      // fall through to manual parse
    }
  }
  // Fallback: "id1|name1,id2|name2"
  return value.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const [id, name] = s.split("|").map((p) => p.trim());
    return { id, name: name || id };
  });
}

function parseInt2(value: string, fallback: number): number {
  const n = parseInt(value, 10);
  return isNaN(n) ? fallback : n;
}

function configFromEnv(env: Record<string, string>): AscanConfig {
  return {
    llm_api_key: env.LLM_API_KEY || "",
    llm_base_url: env.LLM_BASE_URL || "https://yunwu.ai/v1",
    llm_model: env.LLM_MODEL || "deepseek-v4-pro",
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
    conference_days_recent: parseInt2(env.CONFERENCE_DAYS_RECENT, 90),

    blog_max_per_source: parseInt2(env.BLOG_MAX_PER_SOURCE, 2),

    wechat_wae_url: env.WECHAT_WAE_URL || "http://localhost:3001",
    wechat_wae_auth_key: env.WECHAT_WAE_AUTH_KEY || "",
    wechat_mp_ids: parseMpList(env.WECHAT_MP_IDS || ""),
    wechat_limit_per_mp: parseInt2(env.WECHAT_LIMIT_PER_MP, 20),
    wechat_days_recent: parseInt2(env.WECHAT_DAYS_RECENT, 30),

    output_dir: env.OUTPUT_DIR || "./docs",
    log_level: env.LOG_LEVEL || "INFO",
  };
}

// ── .env writing ──────────────────────────────────────────────

const CONFIG_TO_ENV: Record<keyof AscanConfig, string> = {
  llm_api_key: "LLM_API_KEY",
  llm_base_url: "LLM_BASE_URL",
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
  conference_days_recent: "CONFERENCE_DAYS_RECENT",
  blog_max_per_source: "BLOG_MAX_PER_SOURCE",
  wechat_wae_url: "WECHAT_WAE_URL",
  wechat_wae_auth_key: "WECHAT_WAE_AUTH_KEY",
  wechat_mp_ids: "WECHAT_MP_IDS",
  wechat_limit_per_mp: "WECHAT_LIMIT_PER_MP",
  wechat_days_recent: "WECHAT_DAYS_RECENT",
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

export const ASCAN_CONFIG_TO_ENV = CONFIG_TO_ENV;
