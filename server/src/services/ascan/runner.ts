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
  MODULE_LABELS,
  mergePipelineReport,
  moduleNames,
  runPipelineModule,
  todayCompact,
} from "./pipeline/index.js";

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

function freshProgress(date: string): SupplementProgress {
  return {
    isRunning: false,
    date,
    startedAt: null,
    phase: "running",
    modules: ALL_MODULES.map((m) => ({
      name: m, label: MODULE_LABELS[m], status: "pending" as const, chars: 0, error: null,
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
): Promise<{ module: string; ok: boolean; chars: number; error: string }> {
  const dateStr = date || todayDateStr();
  console.log(`[ascan] runModule ${module} date=${dateStr} (in-process)`);
  return runPipelineModule(module, dateStr, llmConfig);
}

export async function mergeReport(
  date?: string,
): Promise<{ ok: boolean; date: string; html_path: string; md_path: string }> {
  const dateStr = date || todayDateStr();
  console.log(`[ascan] mergeReport date=${dateStr} (in-process)`);
  return mergePipelineReport(dateStr);
}

// ── Non-blocking supplement ────────────────────────────────────────────

async function runSupplement(dateStr: string, llmConfig?: LLMOverride): Promise<void> {
  for (const mod of ALL_MODULES) {
    if (!supplementProgress?.isRunning) break; // aborted
    const mp = supplementProgress!.modules.find((m) => m.name === mod)!;
    mp.status = "running";
    supplementProgress!.currentModule = mod;
    try {
      const r = await runModule(mod, dateStr, llmConfig);
      mp.status = r.ok ? "done" : "failed";
      mp.chars = r.chars;
      mp.error = r.error || null;
      console.log(`[ascan] supplement ${mod}: ${mp.status} (${mp.chars} chars)`);
    } catch (err: any) {
      mp.status = "failed";
      mp.error = err?.message || String(err);
      console.error(`[ascan] supplement ${mod} exception:`, err);
    }
  }
  // Merge
  supplementProgress!.phase = "merging";
  supplementProgress!.currentModule = "merge";
  try {
    const r = await mergeReport(dateStr);
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
): Promise<{ started: boolean; date: string; modules: string[] }> {
  const dateStr = date || todayDateStr();
  if (supplementProgress?.isRunning || pipelineBusy) {
    throw new Error("新知补充已在运行中");
  }
  supplementProgress = freshProgress(dateStr);
  supplementProgress.isRunning = true;
  supplementProgress.startedAt = new Date().toISOString();
  pipelineBusy = true;

  console.log(`[ascan] startAscanSupplement date=${dateStr} (background, in-process)`);

  // Run in background — do NOT await.
  runSupplement(dateStr, llmConfig)
    .catch((err) => {
      console.error("[ascan] supplement background error:", err);
      supplementProgress!.isRunning = false;
      supplementProgress!.phase = "failed";
      supplementProgress!.error = String(err);
    })
    .finally(() => {
      pipelineBusy = false;
    });

  return { started: true, date: dateStr, modules: ALL_MODULES.map((m) => MODULE_LABELS[m]) };
}

export function getSupplementProgress(): SupplementProgress | null {
  return supplementProgress;
}

// ── Full run (background, same engine as supplement) ──────────────────

export async function triggerRun(
  date?: string,
  llmConfig?: LLMOverride,
): Promise<{ pid: number; message: string }> {
  const dateStr = date || todayDateStr();
  await startAscanSupplement(dateStr, llmConfig);
  // pid is meaningless in-process; kept for API compatibility with old clients.
  return { pid: process.pid, message: `Ascan pipeline started (in-process, date: ${dateStr})` };
}

export async function abortRun(): Promise<{ killed: boolean; message: string }> {
  // In-process abort: stop scheduling further modules. The module currently
  // running finishes its in-flight work and then the loop exits.
  if (supplementProgress?.isRunning) {
    supplementProgress.isRunning = false;
    supplementProgress.phase = "failed";
    supplementProgress.error = "aborted by user";
    console.log("[ascan] abort requested — stopping after current module");
    return { killed: true, message: "Pipeline abort requested (stops after current module)" };
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
