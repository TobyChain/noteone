/**
 * Local tools for 闹闹 — whitelisted shell commands + restricted file access.
 *
 * Security model:
 *  - Only read-only commands from an explicit whitelist
 *  - All paths must resolve within allowed directories (~/Documents, ~/Desktop, ~/Downloads)
 *  - Shell metacharacters (;, &&, ||, $(), ``, >, <) are blocked
 *  - find -exec/-delete blocked; xargs/env/eval blocked entirely
 *  - 30s timeout, 8KB output cap
 */
import { exec } from "child_process";
import { resolve, normalize, basename } from "path";
import { homedir } from "os";
import { readdir, readFile, stat } from "fs/promises";
import type { ToolDefinition } from "./notty/agent-loop.js";

const HOME = homedir();

const ALLOWED_DIRS = [
  resolve(HOME, "Documents"),
  resolve(HOME, "Desktop"),
  resolve(HOME, "Downloads"),
];

const ALLOWED_COMMANDS = new Set([
  "grep", "rg", "find", "ls", "cat", "head", "tail", "wc",
  "sort", "uniq", "diff", "file", "stat", "du", "pwd",
  "which", "date", "echo", "tree", "basename", "dirname",
  "realpath", "readlink", "md5", "shasum", "cal",
]);

const BLOCKED_FIND_FLAGS = new Set(["-exec", "-execdir", "-delete", "-ok", "-okdir"]);

const BLOCKED_META = /[;]|\$\(|`|&&|\|\||>>?|</;

function resolvePath(p: string): string {
  if (p.startsWith("~")) return resolve(HOME, p.slice(1).replace(/^\//, ""));
  return resolve(HOME, p);
}

function isPathAllowed(p: string): boolean {
  const resolved = resolvePath(p);
  return ALLOWED_DIRS.some((dir) => resolved === dir || resolved.startsWith(dir + "/"));
}

function validateCommand(cmd: string): { ok: boolean; error?: string } {
  if (BLOCKED_META.test(cmd)) {
    return { ok: false, error: "包含被禁止的 shell 元字符（; && || $() `` > <）" };
  }

  const segments = cmd.split("|").map((s) => s.trim());
  for (const seg of segments) {
    const parts = seg.split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    const base = parts[0];

    if (!ALLOWED_COMMANDS.has(base)) {
      return { ok: false, error: `命令不在白名单: ${base}（允许: ${[...ALLOWED_COMMANDS].join(", ")}）` };
    }

    if (base === "find") {
      for (const flag of parts) {
        if (BLOCKED_FIND_FLAGS.has(flag)) {
          return { ok: false, error: `find 禁止使用 ${flag}` };
        }
      }
    }

    for (const part of parts.slice(1)) {
      if (part.startsWith("-")) continue;
      if (part.startsWith('"') || part.startsWith("'")) continue;
      if (/[*?[\]{}]/.test(part)) continue;
      if (part.includes("/") || part.startsWith("~") || part.startsWith(".")) {
        if (!isPathAllowed(part)) {
          return { ok: false, error: `路径不在允许目录内: ${part}（允许: ~/Documents, ~/Desktop, ~/Downloads）` };
        }
      }
    }
  }

  return { ok: true };
}

async function execCommand(cmd: string): Promise<string> {
  const v = validateCommand(cmd);
  if (!v.ok) return `⛔ ${v.error}`;

  return new Promise((res) => {
    exec(cmd, { timeout: 30_000, maxBuffer: 1024 * 1024, cwd: HOME }, (err, stdout, stderr) => {
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
  const searchDir = resolvePath(dir || "~/Documents");
  if (!isPathAllowed(searchDir)) return `⛔ 路径不在允许目录内: ${searchDir}`;

  const include = filePattern ? `--include=${filePattern}` : "";
  const cmd = `grep -rn ${include} -- ${JSON.stringify(query)} ${JSON.stringify(searchDir)} | head -${maxResults}`;
  return execCommand(cmd);
}

async function listFiles(dir: string, recursive = false): Promise<string> {
  const target = resolvePath(dir);
  if (!isPathAllowed(target)) return `⛔ 路径不在允许目录内: ${target}`;

  try {
    const flag = recursive ? "-laR" : "-la";
    return await execCommand(`ls ${flag} ${JSON.stringify(target)}`);
  } catch (e: any) {
    return `列出失败: ${e.message}`;
  }
}

async function readFileContent(path: string, offset = 0, limit = 200): Promise<string> {
  const target = resolvePath(path);
  if (!isPathAllowed(target)) return `⛔ 路径不在允许目录内: ${target}`;

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
      name: "run_command",
      description:
        "在本地终端执行白名单命令（只读）。允许: grep/rg/find/ls/cat/head/tail/wc/sort/uniq/diff/file/stat/du/tree/date/echo 等。" +
        "路径限定在 ~/Documents、~/Desktop、~/Downloads。禁止 rm/mv/cp/curl/sudo/python 等写入或执行类命令。" +
        "示例: grep -rn 'TODO' ~/Documents/NoteOne | head -20",
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "要执行的 shell 命令" } },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "在指定目录中搜索文件内容（grep）。比 run_command 更安全、更结构化。",
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
    run_command: async ({ command }: any) => execCommand(command),
    search_files: async ({ query, path, filePattern, maxResults }: any) =>
      searchFiles(query, path, filePattern, maxResults),
    list_files: async ({ path, recursive }: any) => listFiles(path, recursive),
    read_file: async ({ path, offset, limit }: any) => readFileContent(path, offset, limit),
  };
}
