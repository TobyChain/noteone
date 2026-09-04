/**
 * NewLore configuration — .env parsing/serialization for the NewLore pipeline.
 *
 * The config surface (keys, env names, types, defaults, sensitivity) is
 * defined once in .newlore/config.schema.json (formerly the Python
 * newlore/config.schema.json; the Python pipeline has been removed).
 */
import { chmod, readFile, writeFile } from "fs/promises";
import { readFileSync, mkdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve, join } from "path";
import { config as appConfig } from "../../config.js";
import { getUserNewLoreConfig, setUserNewLoreConfig } from "../user-config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Dev: runtime data lives at server/.newlore/ (this file is at
// server/src/services/newlore/, so three levels up).
// Embedded (packaged .app): everything lives under {DATA_DIR}/newlore.
const SERVER_NEWLORE_ROOT = resolve(__dirname, "../../../.newlore");
const NEWLORE_ROOT = appConfig.dataDir ? join(appConfig.dataDir, "newlore") : SERVER_NEWLORE_ROOT;
const LEGACY_NEWSEE_ROOT = appConfig.dataDir ? join(appConfig.dataDir, "newsee") : resolve(__dirname, "../../../.newsee");
const LEGACY_ASCAN_ROOT = appConfig.dataDir ? join(appConfig.dataDir, "ascan") : resolve(__dirname, "../../../.ascan");
const NEWLORE_DOCS = join(NEWLORE_ROOT, "docs");
const NEWLORE_ENV = process.env.NEWLORE_ENV_PATH || join(NEWLORE_ROOT, ".env");
const LEGACY_ENV_PATHS = [
  process.env.NEWSEE_ENV_PATH || join(LEGACY_NEWSEE_ROOT, ".env"),
  process.env.ASCAN_ENV_PATH || join(LEGACY_ASCAN_ROOT, ".env"),
];
const NEWLORE_LOGS = join(NEWLORE_ROOT, "logs");
mkdirSync(NEWLORE_DOCS, { recursive: true });
mkdirSync(NEWLORE_LOGS, { recursive: true });

export { NEWLORE_ROOT, NEWLORE_DOCS, NEWLORE_ENV, NEWLORE_LOGS, LEGACY_NEWSEE_ROOT, LEGACY_ASCAN_ROOT };

export interface NewLoreConfig {
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
  wechat_request_interval_seconds: number;
  wechat_rate_limit_cooldown_minutes: number;
  // Output
  output_dir: string;
  log_level: string;
  // FarView
  farview_minimum_count: number;
  farview_blocked_topics: string[];
}

// ── schema (single source of truth: .newlore/config.schema.json) ─

type FieldType = "string" | "int" | "string_list" | "mp_list";

interface SchemaField {
  key: keyof NewLoreConfig;
  type: FieldType;
  default: any;
  sensitive?: boolean;
  personal?: boolean;
  group: string;
}

const SCHEMA_CANDIDATES = [
  process.env.NEWLORE_SCHEMA_PATH,
  join(NEWLORE_ROOT, "config.schema.json"),
  process.env.NEWSEE_SCHEMA_PATH,
  join(LEGACY_NEWSEE_ROOT, "config.schema.json"),
  process.env.ASCAN_SCHEMA_PATH,
  join(LEGACY_ASCAN_ROOT, "config.schema.json"),
].filter((value): value is string => Boolean(value));
const SCHEMA_PATH = SCHEMA_CANDIDATES.find(existsSync) ?? SCHEMA_CANDIDATES[0];
const schema: { fields: SchemaField[] } = JSON.parse(readFileSync(SCHEMA_PATH, "utf-8"));

export const CONFIG_KEYS: (keyof NewLoreConfig)[] = schema.fields.map((f) => f.key);

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

function configFromEnv(env: Record<string, string>): NewLoreConfig {
  const config = {} as Record<string, any>;
  for (const field of schema.fields) {
    config[field.key] = parseFieldValue(field, env[envNameOf(field.key)]);
  }
  return config as NewLoreConfig;
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

function updateEnvFile(existingContent: string, updates: Partial<NewLoreConfig>): string {
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

export async function getConfig(): Promise<NewLoreConfig> {
  const content = await readFirstConfigContent();
  return configFromEnv(content == null ? {} : parseEnvFile(content));
}

async function readFirstConfigContent(): Promise<string | null> {
  for (const envPath of [NEWLORE_ENV, ...LEGACY_ENV_PATHS]) {
    try {
      return await readFile(envPath, "utf-8");
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return null;
}

export async function updateConfig(updates: Partial<NewLoreConfig>): Promise<NewLoreConfig> {
  // If the new path does not exist yet, seed it from the newest readable
  // legacy config before applying updates. This makes migration lossless.
  const content = await readFirstConfigContent() ?? "";
  const updated = updateEnvFile(content, updates);
  await writeFile(NEWLORE_ENV, updated, { encoding: "utf-8", mode: 0o600 });
  await chmod(NEWLORE_ENV, 0o600);
  return getConfig();
}

// ── masking & update sanitization ─────────────────────────────

const SENSITIVE_KEYS = schema.fields.filter((f) => f.sensitive).map((f) => f.key);

export function maskConfig(config: NewLoreConfig): NewLoreConfig {
  const masked = { ...config };
  for (const key of SENSITIVE_KEYS) {
    (masked as any)[key] = masked[key] ? "***" : "";
  }
  return masked;
}

/** Filter updates to known keys; drop nulls and masked "***" placeholders. */
export function sanitizeConfigUpdates(updates: Record<string, unknown>): Partial<NewLoreConfig> {
  const filtered: Partial<NewLoreConfig> = {};
  for (const key of CONFIG_KEYS) {
    if (!(key in updates)) continue;
    const val = updates[key];
    if (val == null) continue;
    if (typeof val === "string" && val === "***") continue;
    (filtered as any)[key] = val;
  }
  return filtered;
}

// ── per-user personal config (DB) + effective config merge ──────

export const PERSONAL_KEYS: Set<string> = new Set(
  schema.fields.filter((f) => f.personal).map((f) => f.key as string),
);

export function splitConfigUpdates(updates: Partial<NewLoreConfig>): {
  personal: Partial<NewLoreConfig>;
  global: Partial<NewLoreConfig>;
} {
  const personal: Partial<NewLoreConfig> = {};
  const global: Partial<NewLoreConfig> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (PERSONAL_KEYS.has(k)) (personal as any)[k] = v;
    else (global as any)[k] = v;
  }
  return { personal, global };
}

export async function getEffectiveConfig(userId?: string): Promise<NewLoreConfig> {
  const globalConfig = await getConfig();
  if (!userId) return globalConfig;

  const userConfig = await getUserNewLoreConfig(userId);
  if (!userConfig) return globalConfig;

  const merged = { ...globalConfig };
  for (const key of PERSONAL_KEYS) {
    if (key in userConfig && (userConfig as any)[key] !== undefined) {
      (merged as any)[key] = (userConfig as any)[key];
    }
  }
  return merged;
}

export async function updateEffectiveConfig(
  userId: string | undefined,
  updates: Partial<NewLoreConfig>,
): Promise<NewLoreConfig> {
  const { personal, global } = splitConfigUpdates(updates);

  if (Object.keys(global).length > 0) {
    await updateConfig(global);
  }

  if (Object.keys(personal).length > 0 && userId) {
    await setUserNewLoreConfig(userId, personal);
  }

  return getEffectiveConfig(userId);
}
