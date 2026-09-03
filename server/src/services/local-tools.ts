/**
 * Local tools for 闹闹 — structured, read-only file access.
 *
 * Security model:
 *  - No caller-provided shell command is executed
 *  - All paths must resolve within allowed directories (~/Documents, ~/Desktop, ~/Downloads)
 *  - Child processes use execFile with shell disabled and fixed executables
 *  - 30s timeout, 8KB output cap
 */
import { execFile } from "child_process";
import { resolve, basename } from "path";
import { homedir } from "os";
import { readFile, realpath } from "fs/promises";
import type { ToolDefinition } from "./notty/agent-loop.js";

const HOME = homedir();

const ALLOWED_DIRS = [
  resolve(HOME, "Documents"),
  resolve(HOME, "Desktop"),
  resolve(HOME, "Downloads"),
];

function resolvePath(p: string): string {
  if (p.startsWith("~")) return resolve(HOME, p.slice(1).replace(/^\//, ""));
  return resolve(HOME, p);
}

function isPathAllowed(p: string): boolean {
  const resolved = resolvePath(p);
  return ALLOWED_DIRS.some((dir) => resolved === dir || resolved.startsWith(dir + "/"));
}

async function allowedRealPath(input: string): Promise<string | null> {
  try {
    const target = await realpath(resolvePath(input));
    return isPathAllowed(target) ? target : null;
  } catch {
    return null;
  }
}

async function runFile(command: string, args: string[]): Promise<string> {
  return new Promise((res) => {
    execFile(command, args, { timeout: 30_000, maxBuffer: 1024 * 1024, cwd: HOME }, (err, stdout, stderr) => {
      if (err && !stdout) {
        res(`命令执行失败: ${err.message}`);
        return;
      }
      const out = stdout.slice(0, 8000);
      const trunc = stdout.length > 8000 ? "\n…(输出已截断)" : "";
      const errOut = stderr ? `\n[stderr] ${stderr.slice(0, 500)}` : "";
      res(out + trunc + errOut || "(无输出)");
    });
  });
}

// ── Structured file tools (no shell) ──────────────────────────────────

async function searchFiles(query: string, dir?: string, filePattern?: string, maxResults = 30): Promise<string> {
  const searchDir = await allowedRealPath(dir || "~/Documents");
  if (!searchDir) return "⛔ 路径不存在或不在允许目录内";
  const safeMax = Math.min(Math.max(Number(maxResults) || 30, 1), 200);
  const args = ["-rn"];
  if (filePattern) args.push(`--include=${filePattern}`);
  args.push("--", query, searchDir);
  const output = await runFile("grep", args);
  return output.split("\n").slice(0, safeMax).join("\n");
}

async function listFiles(dir: string, recursive = false): Promise<string> {
  const target = await allowedRealPath(dir);
  if (!target) return "⛔ 路径不存在或不在允许目录内";

  try {
    const flag = recursive ? "-laR" : "-la";
    return await runFile("ls", [flag, "--", target]);
  } catch (e: any) {
    return `列出失败: ${e.message}`;
  }
}

async function readFileContent(path: string, offset = 0, limit = 200): Promise<string> {
  const target = await allowedRealPath(path);
  if (!target) return "⛔ 路径不存在或不在允许目录内";

  try {
    const content = await readFile(target, "utf-8");
    const lines = content.split("\n");
    const slice = lines.slice(offset, offset + limit);
    const header = `文件: ${basename(target)} (${lines.length} 行, 显示 ${offset + 1}-${Math.min(offset + limit, lines.length)})\n`;
    return header + slice.join("\n");
  } catch (e: any) {
    return `读取失败: ${e.message}`;
  }
}

// ── Tool definitions ──────────────────────────────────────────────────

export const localToolDefinitions: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_files",
      description: "在指定的允许目录中搜索文件内容。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词或正则" },
          path: { type: "string", description: "搜索目录，默认 ~/Documents" },
          filePattern: { type: "string", description: "文件名过滤，如 '*.swift'" },
          maxResults: { type: "number", description: "最大结果数，默认 30" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "列出目录内容。路径限定在 ~/Documents、~/Desktop、~/Downloads。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "目录路径" },
          recursive: { type: "boolean", description: "是否递归列出子目录" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "读取本地文件内容（按行）。路径限定在 ~/Documents、~/Desktop、~/Downloads。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件路径" },
          offset: { type: "number", description: "起始行号（0-based），默认 0" },
          limit: { type: "number", description: "读取行数，默认 200" },
        },
        required: ["path"],
      },
    },
  },
];

// ── Handler factory ───────────────────────────────────────────────────

export function makeLocalHandlers(): Record<string, (args: any) => Promise<string>> {
  return {
    search_files: async ({ query, path, filePattern, maxResults }: any) =>
      searchFiles(query, path, filePattern, maxResults),
    list_files: async ({ path, recursive }: any) => listFiles(path, recursive),
    read_file: async ({ path, offset, limit }: any) => readFileContent(path, offset, limit),
  };
}
