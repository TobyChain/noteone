/**
 * Ascan configuration — .env parsing/serialization for the Python pipeline.
 *
 * The config surface (keys, env names, types, defaults, sensitivity) is
 * defined once in ascan/config.schema.json and shared with the Python side
 * (ascan/src/config/settings.py, consistency enforced by
 * ascan/tests/test_config_schema.py).
 */
import { readFile, writeFile } from "fs/promises";
import { readFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve, join } from "path";
import { config as appConfig } from "../../config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Dev: ascan/ is at the noteone project root (this file lives at
// server/src/services/ascan/, project root is 4 levels up).
// Embedded (packaged .app): everything lives under {DATA_DIR}/ascan.
const REPO_ASCAN_ROOT = resolve(__dirname, "../../../../ascan");
const ASCAN_ROOT = appConfig.dataDir ? join(appConfig.dataDir, "ascan") : REPO_ASCAN_ROOT;
const ASCAN_DOCS = join(ASCAN_ROOT, "docs");
const ASCAN_ENV = process.env.ASCAN_ENV_PATH || join(ASCAN_ROOT, ".env");
const ASCAN_LOGS = join(ASCAN_ROOT, "logs");
if (appConfig.dataDir) {
  mkdirSync(ASCAN_DOCS, { recursive: true });
  mkdirSync(ASCAN_LOGS, { recursive: true });
}

export { ASCAN_ROOT, ASCAN_DOCS, ASCAN_ENV, ASCAN_LOGS };

export interface AscanConfig {
  // LLM
  llm_api_key: string;
  llm_base_url: string;
  llm_model: string;
  llm_max_concurrency: number;
  llm_max_tokens: number;
  llm_timeout_ms: number;
  // Pipeline
  enabled_modules: string[];
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
  blog_sources: string[];
  // WeChat MP (built-in service)
  wechat_service_url: string;
  wechat_auth_key: string;
  wechat_mp_ids: Array<{ id: string; name: string }>;
  wechat_limit_per_mp: number;
  wechat_days_recent: number;
  // Output
  output_dir: string;
  log_level: string;
}

// ── schema (single source of truth: ascan/config.schema.json) ─

type FieldType = "string" | "int" | "string_list" | "mp_list";

interface SchemaField {
  key: keyof AscanConfig;
  type: FieldType;
  default: any;
  sensitive?: boolean;
  group: string;
}

const SCHEMA_PATH = process.env.ASCAN_SCHEMA_PATH || join(REPO_ASCAN_ROOT, "config.schema.json");
const schema: { fields: SchemaField[] } = JSON.parse(readFileSync(SCHEMA_PATH, "utf-8"));

export const CONFIG_KEYS: (keyof AscanConfig)[] = schema.fields.map((f) => f.key);

function envNameOf(key: string): string {
  return key.toUpperCase();
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

function parseFieldValue(field: SchemaField, raw: string | undefined): any {
  if (raw === undefined || raw === "") {
    return structuredClone(field.default);
  }
  switch (field.type) {
    case "string":
      return raw;
    case "int": {
      const n = parseInt(raw, 10);
      return isNaN(n) ? field.default : n;
    }
    case "string_list":
      return parseList(raw);
    case "mp_list":
      return parseMpList(raw);
  }
}

function configFromEnv(env: Record<string, string>): AscanConfig {
  const config = {} as Record<string, any>;
  for (const field of schema.fields) {
    config[field.key] = parseFieldValue(field, env[envNameOf(field.key)]);
  }
  return config as AscanConfig;
}

// ── .env writing ──────────────────────────────────────────────

function serializeValue(value: any): string {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  return String(value ?? "");
}

// JSON values contain double quotes; single-quote those lines so both this
// parser and python-dotenv read them back unmangled.
function formatEnvLine(envKey: string, value: any): string {
  const serialized = serializeValue(value);
  return serialized.includes('"') ? `${envKey}='${serialized}'` : `${envKey}="${serialized}"`;
}

function updateEnvFile(existingContent: string, updates: Partial<AscanConfig>): string {
  const lines = existingContent.split("\n");
  const envKeyToConfigKey = Object.fromEntries(
    CONFIG_KEYS.map((key) => [envNameOf(key), key]),
  );
  const updatedKeys = new Set<string>();

  const newLines = lines.map((line) => {
    const parsed = parseEnvLine(line);
    if (!parsed) return line;
    const configKey = envKeyToConfigKey[parsed.key];
    if (configKey && configKey in updates) {
      updatedKeys.add(parsed.key);
      return formatEnvLine(parsed.key, updates[configKey]!);
    }
    return line;
  });

  for (const key of CONFIG_KEYS) {
    const envKey = envNameOf(key);
    if (key in updates && !updatedKeys.has(envKey)) {
      newLines.push(formatEnvLine(envKey, updates[key]!));
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

// ── masking & update sanitization ─────────────────────────────

const SENSITIVE_KEYS = schema.fields.filter((f) => f.sensitive).map((f) => f.key);

export function maskConfig(config: AscanConfig): AscanConfig {
  const masked = { ...config };
  for (const key of SENSITIVE_KEYS) {
    (masked as any)[key] = masked[key] ? "***" : "";
  }
  return masked;
}

/** Filter updates to known keys; drop nulls and masked "***" placeholders. */
export function sanitizeConfigUpdates(updates: Record<string, unknown>): Partial<AscanConfig> {
  const filtered: Partial<AscanConfig> = {};
  for (const key of CONFIG_KEYS) {
    if (!(key in updates)) continue;
    const val = updates[key];
    if (val == null) continue;
    if (typeof val === "string" && val === "***") continue;
    (filtered as any)[key] = val;
  }
  return filtered;
}
