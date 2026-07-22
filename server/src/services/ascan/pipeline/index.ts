/**
 * Ascan pipeline orchestrator (TS port of ascan/orchestrator.py).
 * Single entry point that governs all knowledge modules: run one module,
 * persist its HTML/MD fragment, and merge fragments into the unified daily
 * report. Runs fully in-process — no Python, no child processes.
 */
import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { ASCAN_DOCS, ASCAN_LOGS, getConfig } from "../config.js";
import { PipelineLLM } from "./llm.js";
import { buildUnifiedHtml, buildUnifiedMd } from "./report.js";
import { MODULE_LABELS, type AscanModuleName, type ModuleContext, type ModuleRunner, type AscanPreferences } from "./types.js";
import type { LLMConfig } from "../../llm.js";
import { db } from "../../../db/client.js";
import { users } from "../../../db/schema.js";
import { eq } from "drizzle-orm";

const FRAGMENT_DIR = () => join(ASCAN_LOGS, "fragments");

// Lazy imports so one broken module can't take down the orchestrator.
const MODULE_REGISTRY: Record<AscanModuleName, () => Promise<{ run: ModuleRunner }>> = {
  official: () => import("./modules/official.js"),
  blog: () => import("./modules/blog.js"),
  github: () => import("./modules/github.js"),
  arxiv: () => import("./modules/arxiv.js"),
  conference: () => import("./modules/conference.js"),
  wechat: () => import("./modules/wechat.js"),
};

export function moduleNames(): AscanModuleName[] {
  return Object.keys(MODULE_REGISTRY) as AscanModuleName[];
}

export interface ModuleRunResult {
  module: string;
  ok: boolean;
  chars: number;
  error: string;
}

function toDashed(dateCompact: string): string {
  return `${dateCompact.slice(0, 4)}-${dateCompact.slice(4, 6)}-${dateCompact.slice(6, 8)}`;
}

export function todayCompact(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

async function buildContext(dateCompact: string, llmOverride?: LLMConfig, sharedLlm?: PipelineLLM, preferences?: AscanPreferences): Promise<ModuleContext> {
  const config = await getConfig();
  const llm = sharedLlm ?? new PipelineLLM({
    apiKey: llmOverride?.apiKey || config.llm_api_key,
    baseUrl: llmOverride?.baseUrl || config.llm_base_url,
    model: llmOverride?.model || config.llm_model,
    maxConcurrency: config.llm_max_concurrency,
  });
  return {
    date: toDashed(dateCompact),
    dateCompact,
    config,
    llm,
    log: (msg: string) => console.log(`[ascan] ${msg}`),
    preferences,
  };
}

export async function readUserPreferences(userId?: string): Promise<AscanPreferences | undefined> {
  if (!userId) return undefined;
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { settings: true },
  });
  const prefs = (user?.settings as any)?.ascanPreferences;
  return prefs && typeof prefs === "object" ? prefs : undefined;
}

function fragmentPaths(dateCompact: string, module: string): { html: string; md: string } {
  const base = join(FRAGMENT_DIR(), dateCompact);
  return { html: join(base, `${module}.html`), md: join(base, `${module}.md`) };
}

async function persistFragment(dateCompact: string, module: string, html: string, md: string): Promise<number> {
  const paths = fragmentPaths(dateCompact, module);
  await mkdir(join(FRAGMENT_DIR(), dateCompact), { recursive: true });
  await writeFile(paths.html, html, "utf-8");
  await writeFile(paths.md, md, "utf-8");
  return html.length;
}

async function loadFragment(dateCompact: string, module: string): Promise<{ html: string; md: string }> {
  const paths = fragmentPaths(dateCompact, module);
  const html = existsSync(paths.html) ? await readFile(paths.html, "utf-8") : "";
  const md = existsSync(paths.md) ? await readFile(paths.md, "utf-8") : "";
  return { html, md };
}

/** Run a single module, persist its fragment, return a JSON-serializable result. */
export async function runPipelineModule(
  name: string,
  dateCompact: string,
  llmOverride?: LLMConfig,
  sharedLlm?: PipelineLLM,
  userId?: string,
): Promise<ModuleRunResult> {
  if (!(name in MODULE_REGISTRY)) {
    return { module: name, ok: false, chars: 0, error: `unknown module: ${name}` };
  }
  const moduleName = name as AscanModuleName;
  console.log(`[ascan] [${name}] run_module start (date=${dateCompact})`);
  try {
    const preferences = await readUserPreferences(userId);
    const ctx = await buildContext(dateCompact, llmOverride, sharedLlm, preferences);
    const { run } = await MODULE_REGISTRY[moduleName]();
    const result = await run(ctx);
    const chars = await persistFragment(dateCompact, name, result.html, result.md);
    console.log(`[ascan] [${name}] run_module done ok=true chars=${chars} items=${result.count}`);
    return { module: name, ok: true, chars, error: "" };
  } catch (err: any) {
    console.error(`[ascan] [${name}] run_module exception:`, err);
    return { module: name, ok: false, chars: 0, error: String(err?.message || err) };
  }
}

export interface MergeResult {
  ok: boolean;
  date: string;
  html_path: string;
  md_path: string;
}

/** Read persisted fragments for the date, build unified HTML+MD, write into docs/. */
export async function mergePipelineReport(dateCompact: string, moduleOrder?: AscanModuleName[]): Promise<MergeResult> {
  const names = moduleOrder?.length ? moduleOrder : moduleNames();
  const loaded = await Promise.all(names.map((name) => loadFragment(dateCompact, name)));
  const fragments = Object.fromEntries(names.map((name, i) => [name, loaded[i]])) as Record<AscanModuleName, { html: string; md: string }>;

  const unifiedHtml = buildUnifiedHtml(dateCompact, {
    arxiv: fragments.arxiv?.html ?? "",
    github: fragments.github?.html ?? "",
    official: fragments.official?.html ?? "",
    blog: fragments.blog?.html ?? "",
    conference: fragments.conference?.html ?? "",
    wechat: fragments.wechat?.html ?? "",
  }, moduleOrder);
  const unifiedMd = buildUnifiedMd(dateCompact, {
    arxiv: fragments.arxiv?.md ?? "",
    github: fragments.github?.md ?? "",
    official: fragments.official?.md ?? "",
    blog: fragments.blog?.md ?? "",
    conference: fragments.conference?.md ?? "",
    wechat: fragments.wechat?.md ?? "",
  }, moduleOrder);

  await mkdir(ASCAN_DOCS, { recursive: true });
  const htmlPath = join(ASCAN_DOCS, `Ascan-${dateCompact}.html`);
  const mdPath = join(ASCAN_DOCS, `Ascan-${dateCompact}.md`);
  await writeFile(htmlPath, unifiedHtml, "utf-8");
  await writeFile(mdPath, unifiedMd, "utf-8");
  console.log(`[ascan] [merge] report written: ${htmlPath}`);
  return { ok: true, date: dateCompact, html_path: htmlPath, md_path: mdPath };
}

export { MODULE_LABELS };
