/**
 * Ascan runner — spawns the Python pipeline.
 *
 * - startAscanSupplement: non-blocking, runs all modules + merge in background,
 *   tracked via supplementProgress. Used by 闹闹.
 * - runModule / mergeReport: blocking, used internally by startAscanSupplement
 *   and exposed via MCP / HTTP for fine-grained control.
 * - triggerRun: fire-and-forget full run (legacy /trigger route, used by 续跑 button).
 */
import { readFile, writeFile, stat, mkdir, readdir, unlink } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { config as serverConfig } from "../../config.js";
import { ASCAN_ROOT, ASCAN_LOGS, type AscanConfig } from "./config.js";
import { generateReportSummary } from "./reports.js";

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

const MODULE_LABELS: Record<string, string> = {
  arxiv: "arXiv 论文精选",
  github: "GitHub 项目挖掘",
  official: "官方动态跟踪",
  blog: "独立博客订阅",
  conference: "会议论文追踪",
  wechat: "微信公众号",
};

const ALL_MODULES = ["arxiv", "github", "official", "blog", "conference", "wechat"];

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

export function todayDateStr(): string {
  const today = new Date();
  return `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
}

function isPidAlive(pid: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Pid of the currently running Python subprocess. Used for abort + status.
let runningPid: number | null = null;

function llmEnv(llmConfig?: { apiKey: string; baseUrl: string; model: string }): Record<string, string> {
  const env: Record<string, string> = {};
  if (llmConfig?.apiKey || serverConfig.qwen.apiKey) {
    env.LLM_API_KEY = llmConfig?.apiKey || serverConfig.qwen.apiKey;
  }
  if (llmConfig?.baseUrl || serverConfig.qwen.baseUrl) {
    env.LLM_BASE_URL = llmConfig?.baseUrl || serverConfig.qwen.baseUrl;
  }
  if (llmConfig?.model) {
    env.LLM_MODEL = llmConfig.model;
  }
  return env;
}

function pythonBin(): string {
  const venvPython = join(ASCAN_ROOT, ".venv", "bin", "python");
  return existsSync(venvPython) ? venvPython : "python3";
}

/** Parse the last non-empty stdout line as JSON (python prints the result via print(json.dumps(...))). */
function parseJsonOut<T = any>(stdout: string): T | null {
  const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]) as T;
    } catch {
      // keep walking back
    }
  }
  return null;
}

interface SpawnResult {
  stdout: string;
  code: number;
}

function spawnBlocking(
  args: string[],
  llmConfig?: { apiKey: string; baseUrl: string; model: string },
  onPid?: (pid: number) => void,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    // Don't leak the server's DATABASE_URL (postgres) into the Python subprocess —
    // ascan/.env has its own sqlite DATABASE_URL that pydantic-settings should use.
    const childEnv: Record<string, string | undefined> = { ...process.env, PYTHONPATH: ASCAN_ROOT, ...llmEnv(llmConfig) };
    delete childEnv.DATABASE_URL;
    const child = spawn(pythonBin(), args, {
      cwd: ASCAN_ROOT,
      env: childEnv,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
      process.stderr.write(d);
    });
    child.on("spawn", () => {
      if (child.pid) onPid?.(child.pid);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, code: code ?? 0 }));
  });
}

// ── Module execution (blocking) ────────────────────────────────────────

export async function runModule(
  module: string,
  date?: string,
  llmConfig?: { apiKey: string; baseUrl: string; model: string },
): Promise<{ module: string; ok: boolean; chars: number; error: string }> {
  const dateStr = date || todayDateStr();
  console.log(`[ascan] runModule ${module} date=${dateStr} (blocking)`);
  const { stdout } = await spawnBlocking(
    ["main_daily.py", "--module", module, "--date", dateStr],
    llmConfig,
    (pid) => { runningPid = pid; },
  );
  runningPid = null;
  const result = parseJsonOut<{ module: string; ok: boolean; chars: number; error: string }>(stdout);
  return result ?? { module, ok: false, chars: 0, error: `no JSON output; stdout tail: ${stdout.slice(-200)}` };
}

export async function mergeReport(
  date?: string,
): Promise<{ ok: boolean; date: string; html_path: string; md_path: string }> {
  const dateStr = date || todayDateStr();
  console.log(`[ascan] mergeReport date=${dateStr} (blocking)`);
  const { stdout } = await spawnBlocking(
    ["main_daily.py", "--merge", "--date", dateStr],
    undefined,
    (pid) => { runningPid = pid; },
  );
  runningPid = null;
  const result = parseJsonOut<{ ok: boolean; date: string; html_path: string; md_path: string }>(stdout);
  return result ?? { ok: false, date: dateStr, html_path: "", md_path: `no JSON output; stdout tail: ${stdout.slice(-200)}` };
}

// ── Non-blocking supplement ────────────────────────────────────────────

/**
 * Start the full ascan supplement in the background. Returns immediately so
 * the chat request is not blocked. Progress is tracked in `supplementProgress`
 * and exposed via `getRunStatus()`.
 */
export async function startAscanSupplement(
  date?: string,
  llmConfig?: { apiKey: string; baseUrl: string; model: string },
): Promise<{ started: boolean; date: string; modules: string[] }> {
  const dateStr = date || todayDateStr();
  if (supplementProgress?.isRunning) {
    throw new Error("新知补充已在运行中");
  }
  supplementProgress = freshProgress(dateStr);
  supplementProgress.isRunning = true;
  supplementProgress.startedAt = new Date().toISOString();

  console.log(`[ascan] startAscanSupplement date=${dateStr} (background)`);

  // Run in background — do NOT await.
  (async () => {
    for (const mod of ALL_MODULES) {
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
  })().catch((err) => {
    console.error("[ascan] supplement background error:", err);
    supplementProgress!.isRunning = false;
    supplementProgress!.phase = "failed";
    supplementProgress!.error = String(err);
  });

  return { started: true, date: dateStr, modules: ALL_MODULES.map((m) => MODULE_LABELS[m]) };
}

export function getSupplementProgress(): SupplementProgress | null {
  return supplementProgress;
}

// ── Fire-and-forget full run ────────────────────────────────────────────

export async function triggerRun(
  date?: string,
  llmConfig?: { apiKey: string; baseUrl: string; model: string },
): Promise<{ pid: number; message: string }> {
  await mkdir(ASCAN_LOGS, { recursive: true }).catch(() => {});
  const args = ["main_daily.py"];
  if (date) args.push("--date", date);
  const childEnv: Record<string, string | undefined> = { ...process.env, PYTHONPATH: ASCAN_ROOT, ...llmEnv(llmConfig) };
  delete childEnv.DATABASE_URL;
  const child = spawn(pythonBin(), args, {
    cwd: ASCAN_ROOT,
    detached: true,
    stdio: "ignore",
    env: childEnv,
  });
  child.unref();
  return new Promise((resolve, reject) => {
    child.on("spawn", () => {
      const pid = child.pid!;
      runningPid = pid;
      const dateStr = date || todayDateStr();
      writeFile(join(ASCAN_LOGS, `ascan_${dateStr}.pid`), String(pid), "utf-8").catch(() => {});
      child.on("exit", () => {
        runningPid = null;
        unlink(join(ASCAN_LOGS, `ascan_${dateStr}.pid`)).catch(() => {});
      });
      resolve({ pid, message: `Ascan pipeline started (pid: ${pid})` });
    });
    child.on("error", (err) => reject(new Error(`Failed to start ascan: ${err.message}`)));
  });
}

export async function abortRun(): Promise<{ killed: boolean; message: string }> {
  const dateStr = todayDateStr();
  const pidPath = join(ASCAN_LOGS, `ascan_${dateStr}.pid`);
  let pid = runningPid;
  if (pid == null) {
    try {
      const pidContent = await readFile(pidPath, "utf-8");
      pid = parseInt(pidContent.trim(), 10);
    } catch {}
  }
  if (pid && !isNaN(pid)) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try { process.kill(pid, "SIGTERM"); } catch {}
    }
  }
  runningPid = null;
  await unlink(pidPath).catch(() => {});
  console.log(`[ascan] aborted run pid=${pid}`);
  return { killed: true, message: `Pipeline aborted (pid: ${pid})` };
}

export async function getRunStatus(): Promise<AscanRunStatus> {
  const dateStr = todayDateStr();
  const pidPath = join(ASCAN_LOGS, `ascan_${dateStr}.pid`);
  let pid: number | null = runningPid;
  if (!pid) {
    try {
      const pidContent = await readFile(pidPath, "utf-8");
      pid = parseInt(pidContent.trim(), 10) || null;
    } catch {}
  }
  const isRunning = isPidAlive(pid);

  let recentLog: string | null = null;
  let recentLogs: string[] = [];
  let lastLockTime: string | null = null;
  let lockAge: string | null = null;
  if (isRunning) {
    try {
      const st = await stat(pidPath);
      lastLockTime = st.mtime.toISOString();
      lockAge = `${((Date.now() - st.mtimeMs) / 3600000).toFixed(1)}h`;
    } catch {}
    try {
      const logFiles = await readdir(ASCAN_LOGS).catch(() => [] as string[]);
      const todayLog = logFiles
        .filter((f) => f.replace(/-/g, "").includes(dateStr) && f.endsWith(".log"))
        .sort()
        .pop();
      if (todayLog) {
        const logContent = await readFile(join(ASCAN_LOGS, todayLog), "utf-8");
        const lines = logContent.split("\n").filter((l) => l.trim());
        const stageLines = lines
          .filter((l) => /run_module|run_all|merge|\[arxiv\]|\[github\]|\[official\]|\[blog\]|\[conference\]|\[wechat\]|Step \d|阶段|arxiv|github|official|blog|conference|merge|完成|成功|失败|error|启动/i.test(l))
          .map((l) => l.trim().slice(0, 200));
        recentLogs = stageLines.slice(-10);
        recentLog = recentLogs.length > 0 ? recentLogs[recentLogs.length - 1] : null;
      }
    } catch {}
  }
  return { isRunning, pid, lastLockTime, lockAge, recentLog, recentLogs, supplement: supplementProgress };
}

export type { AscanConfig };
