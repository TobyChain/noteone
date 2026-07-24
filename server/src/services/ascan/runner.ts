/**
 * Ascan runner — drives the in-process TS pipeline.
 *
 * - startAscanSupplement: non-blocking, runs all modules + merge in background,
 *   tracked via supplementProgress. Used by 闹闹.
 * - runModule / mergeReport: blocking wrappers over the pipeline orchestrator,
 *   exposed via MCP / HTTP for fine-grained control.
 * - triggerRun: full run in background (legacy /trigger route, used by 续跑 button).
 */
import { generateReportSummary } from "./reports.js";
import {
  getModuleLabels,
  mergePipelineReport,
  moduleNames,
  runPipelineModule,
  todayCompact,
} from "./pipeline/index.js";
import { PipelineLLM } from "./pipeline/llm.js";
import { getConfig } from "./config.js";
import { readUserPreferences } from "./pipeline/index.js";
import { getUserLanguage } from "../user-config.js";

export interface AscanRunStatus {
  isRunning: boolean;
  pid: number | null;
  lastLockTime: string | null;
  lockAge: string | null;
  recentLog: string | null;
  recentLogs: string[];
  supplement: SupplementProgress | null;
}

// ── Supplement progress (non-blocking, for 闹闹) ───────────────────────

export interface ModuleProgress {
  name: string;
  label: string;
  status: "pending" | "running" | "done" | "failed";
  chars: number;
  error: string | null;
}

export interface SupplementProgress {
  isRunning: boolean;
  date: string;
  startedAt: string | null;
  phase: "running" | "merging" | "done" | "failed";
  modules: ModuleProgress[];
  currentModule: string | null;
  error: string | null;
}

const ALL_MODULES = moduleNames();

function freshProgress(date: string, language: "zh" | "en" = "zh"): SupplementProgress {
  const labels = getModuleLabels(language);
  return {
    isRunning: false,
    date,
    startedAt: null,
    phase: "running",
    modules: ALL_MODULES.map((m) => ({
      name: m, label: labels[m], status: "pending" as const, chars: 0, error: null,
    })),
    currentModule: null,
    error: null,
  };
}

let supplementProgress: SupplementProgress | null = null;
// One pipeline run at a time (module runs mutate shared fragment/DB state).
let pipelineBusy = false;

export function todayDateStr(): string {
  return todayCompact();
}

type LLMOverride = { apiKey: string; baseUrl: string; model: string };

// ── Module execution (blocking) ────────────────────────────────────────

export async function runModule(
  module: string,
  date?: string,
  llmConfig?: LLMOverride,
  userId?: string,
): Promise<{ module: string; ok: boolean; chars: number; error: string }> {
  const dateStr = date || todayDateStr();
  console.log(`[ascan] runModule ${module} date=${dateStr} (in-process)`);
  return runPipelineModule(module, dateStr, llmConfig, undefined, userId);
}

export async function mergeReport(
  date?: string,
  userId?: string,
): Promise<{ ok: boolean; date: string; html_path: string; md_path: string }> {
  const dateStr = date || todayDateStr();
  console.log(`[ascan] mergeReport date=${dateStr} (in-process)`);
  const [prefs, language] = await Promise.all([
    userId ? readUserPreferences(userId) : undefined,
    userId ? getUserLanguage(userId) : ("zh" as const),
  ]);
  return mergePipelineReport(dateStr, prefs?.moduleOrder, language);
}

// ── Non-blocking supplement ────────────────────────────────────────────

let supplementAbort: AbortController | null = null;

async function runSupplement(dateStr: string, llmConfig?: LLMOverride, userId?: string): Promise<void> {
  const abort = new AbortController();
  supplementAbort = abort;

  // Shared PipelineLLM so all modules share one concurrency semaphore
  const config = await getConfig();
  const sharedLlm = new PipelineLLM({
    apiKey: llmConfig?.apiKey || config.llm_api_key,
    baseUrl: llmConfig?.baseUrl || config.llm_base_url,
    model: llmConfig?.model || config.llm_model,
    maxConcurrency: config.llm_max_concurrency,
    maxTokens: config.llm_max_tokens,
    timeoutMs: config.llm_timeout_ms,
  });

  // Read user preferences and language for module order, focus, and report labels
  const [prefs, language] = await Promise.all([
    userId ? readUserPreferences(userId) : undefined,
    userId ? getUserLanguage(userId) : ("zh" as const),
  ]);

  // Run all modules in parallel
  const results = await Promise.allSettled(
    ALL_MODULES.map(async (mod) => {
      if (abort.signal.aborted) throw new Error("aborted");
      const mp = supplementProgress!.modules.find((m) => m.name === mod)!;
      mp.status = "running";
      supplementProgress!.currentModule = mod;
      try {
        const r = await runPipelineModule(mod, dateStr, llmConfig, sharedLlm, userId);
        mp.status = r.ok ? "done" : "failed";
        mp.chars = r.chars;
        mp.error = r.error || null;
        console.log(`[ascan] supplement ${mod}: ${mp.status} (${mp.chars} chars)`);
      } catch (err: any) {
        mp.status = "failed";
        mp.error = err?.message || String(err);
        console.error(`[ascan] supplement ${mod} exception:`, err);
      }
    }),
  );

  // Log any unexpected rejections (individual module errors are already caught above)
  for (const r of results) {
    if (r.status === "rejected" && r.reason?.message !== "aborted") {
      console.error("[ascan] supplement unexpected rejection:", r.reason);
    }
  }

  if (abort.signal.aborted) {
    supplementProgress!.isRunning = false;
    supplementProgress!.currentModule = null;
    return;
  }

  // Merge
  supplementProgress!.phase = "merging";
  supplementProgress!.currentModule = "merge";
  try {
    const r = await mergePipelineReport(dateStr, prefs?.moduleOrder, language);
    supplementProgress!.phase = r.ok ? "done" : "failed";
    supplementProgress!.error = r.ok ? null : r.md_path;
    if (r.ok) {
      try {
        const summary = await generateReportSummary(dateStr, llmConfig);
        console.log(`[ascan] supplement summary: ${summary.slice(0, 60)}`);
      } catch (err: any) {
        console.error(`[ascan] supplement summary failed:`, err);
      }
    }
  } catch (err: any) {
    supplementProgress!.phase = "failed";
    supplementProgress!.error = err?.message || String(err);
  }
  supplementProgress!.isRunning = false;
  supplementProgress!.currentModule = null;
  console.log(`[ascan] supplement finished: ${supplementProgress!.phase}`);
}

/**
 * Start the full ascan supplement in the background. Returns immediately so
 * the chat request is not blocked. Progress is tracked in `supplementProgress`
 * and exposed via `getRunStatus()`.
 */
export async function startAscanSupplement(
  date?: string,
  llmConfig?: LLMOverride,
  userId?: string,
): Promise<{ started: boolean; date: string; modules: string[] }> {
  const dateStr = date || todayDateStr();
  if (supplementProgress?.isRunning || pipelineBusy) {
    throw new Error("新知补充已在运行中");
  }
  const language = userId ? await getUserLanguage(userId) : "zh";
  const labels = getModuleLabels(language);
  supplementProgress = freshProgress(dateStr, language);
  supplementProgress.isRunning = true;
  supplementProgress.startedAt = new Date().toISOString();
  pipelineBusy = true;

  console.log(`[ascan] startAscanSupplement date=${dateStr} (background, in-process)`);

  // Run in background — do NOT await.
  runSupplement(dateStr, llmConfig, userId)
    .catch((err) => {
      console.error("[ascan] supplement background error:", err);
      supplementProgress!.isRunning = false;
      supplementProgress!.phase = "failed";
      supplementProgress!.error = String(err);
    })
    .finally(() => {
      pipelineBusy = false;
    });

  return { started: true, date: dateStr, modules: ALL_MODULES.map((m) => labels[m]) };
}

export function getSupplementProgress(): SupplementProgress | null {
  return supplementProgress;
}

// ── Full run (background, same engine as supplement) ──────────────────

export async function triggerRun(
  date?: string,
  llmConfig?: LLMOverride,
  userId?: string,
): Promise<{ pid: number; message: string }> {
  const dateStr = date || todayDateStr();
  await startAscanSupplement(dateStr, llmConfig, userId);
  // pid is meaningless in-process; kept for API compatibility with old clients.
  return { pid: process.pid, message: `Ascan pipeline started (in-process, date: ${dateStr})` };
}

export async function abortRun(): Promise<{ killed: boolean; message: string }> {
  if (supplementProgress?.isRunning) {
    supplementAbort?.abort();
    supplementProgress.isRunning = false;
    supplementProgress.phase = "failed";
    supplementProgress.error = "aborted by user";
    console.log("[ascan] abort requested — cancelling in-flight modules");
    return { killed: true, message: "Pipeline abort requested" };
  }
  return { killed: false, message: "No pipeline running" };
}

export async function getRunStatus(): Promise<AscanRunStatus> {
  const running = supplementProgress?.isRunning ?? false;
  const recentLogs: string[] = [];
  if (supplementProgress) {
    for (const m of supplementProgress.modules) {
      if (m.status === "done") recentLogs.push(`[${m.name}] done (${m.chars} chars)`);
      else if (m.status === "failed") recentLogs.push(`[${m.name}] failed: ${m.error || "unknown"}`);
      else if (m.status === "running") recentLogs.push(`[${m.name}] running...`);
    }
  }
  return {
    isRunning: running,
    pid: running ? process.pid : null,
    lastLockTime: supplementProgress?.startedAt ?? null,
    lockAge: null,
    recentLog: recentLogs.length > 0 ? recentLogs[recentLogs.length - 1] : null,
    recentLogs: recentLogs.slice(-10),
    supplement: supplementProgress,
  };
}
