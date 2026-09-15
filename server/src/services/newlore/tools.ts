/**
 * Shared newlore tool definitions + handler factory for 闹闹 (chat-sessions).
 * Includes module execution, blog source management, and config read/update
 * tools so 闹闹 can manage the whole NewLore pipeline.
 */
import type { ToolDefinition } from "../notty/agent-loop.js";
import { listReports, getReport, deleteReport, stripHtml } from "./reports.js";
import { startNewLoreSupplement, startNewLoreModules, getRunStatus } from "./runner.js";
import { getUserChatConfig } from "../user-config.js";
import { getEffectiveConfig, updateEffectiveConfig, maskConfig } from "./config.js";

export const newloreToolDefinitions: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_newlore_reports",
      description: "列出最近的新知日报（科技前沿日报），包含日期和摘要。用户询问最新科技动态或新知内容时使用。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_newlore_report",
      description: "获取指定日期的新知日报纯文本内容。日期格式 YYYYMMDD 如 20260716。",
      parameters: {
        type: "object",
        properties: { date: { type: "string", description: "日期 YYYYMMDD" } },
        required: ["date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_newlore_report",
      description: "删除指定日期的新知日报。运行中的当日日报无法删除。",
      parameters: {
        type: "object",
        properties: { date: { type: "string", description: "日期 YYYYMMDD" } },
        required: ["date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "start_newlore_supplement",
      description: "启动新知补充（非阻塞，立即返回）。后台并行运行所有启用的模块并合并日报。用户说\"补充今日新知\"时调用。进度由 UI 自动展示，无需轮询。",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "报告日期 YYYYMMDD，默认今天" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_newlore_modules",
      description: "只运行指定的爬取模块（而非全部）。用户说\"只补充 arxiv 和 github\"时使用。可选模块：official(官方动态)、blog(独立博客)、github(GitHub)、arxiv(arXiv)、conference(会议论文)。",
      parameters: {
        type: "object",
        properties: {
          modules: {
            type: "array",
            items: { type: "string", enum: ["official", "blog", "github", "arxiv", "conference"] },
            description: "要运行的模块列表",
          },
          date: { type: "string", description: "报告日期 YYYYMMDD，默认今天" },
        },
        required: ["modules"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_newlore_status",
      description: "查看新知补充的运行状态和进度。",
      parameters: { type: "object", properties: {} },
    },
  },
  // ── 博客信息源管理 ──
  {
    type: "function",
    function: {
      name: "list_blog_sources",
      description: "列出当前配置抓取的博客 RSS 信息源。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "add_blog_source",
      description: "添加一个博客 RSS 信息源。用户说\"订阅/添加博客XX\"时使用。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "信息源名称（显示用）" },
          url: { type: "string", description: "RSS/Atom 订阅地址，以 http 开头" },
        },
        required: ["name", "url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_blog_source",
      description: "移除一个博客信息源（按名称或 URL）。用户说\"退订/删除博客XX\"时使用。",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "信息源名称或 URL" } },
        required: ["name"],
      },
    },
  },
  // ── 配置查看与更新 ──
  {
    type: "function",
    function: {
      name: "get_newlore_config",
      description: "查看新知 pipeline 的当前配置（API Key 等敏感信息已脱敏）。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "update_newlore_config",
      description: "更新新知 pipeline 的配置项，如 enabled_modules(启用模块列表)、arxiv_subjects(arXiv分类)、github_topics(GitHub主题)、max_total_papers(论文上限)、blog_max_per_source(每博客条数)等。用户说\"把XX改成YY\"时使用。不支持修改 API Key/Token。",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "配置键名" },
          value: { description: "新值（字符串/数字/数组，按配置类型）" },
        },
        required: ["key", "value"],
      },
    },
  },
];

const BLOCKED_CONFIG_KEYS = new Set([
  "llm_api_key", "github_token", "semantic_scholar_api_key",
]);

/**
 * Build the newlore tool handlers bound to a user id (for LLM config lookup).
 */
export function makeNewLoreHandlers(userId: string): Record<string, (args: any) => Promise<string>> {
  return {
    list_newlore_reports: async () => {
      const reports = await listReports();
      if (reports.length === 0) return "暂无日报";
      return reports.map((r) => `[${r.date}] ${r.summary || "无摘要"}`).join("\n");
    },
    get_newlore_report: async ({ date }: any) => {
      const html = await getReport(date);
      if (!html) return `未找到 ${date} 的日报`;
      return stripHtml(html).slice(0, 8000);
    },
    delete_newlore_report: async ({ date }: any) => {
      try {
        const result = await deleteReport(date);
        return result.deleted ? `已删除日报 ${date}` : `${date} 无可删除的日报文件`;
      } catch (err: any) {
        return `删除失败: ${err?.message || err}`;
      }
    },
    start_newlore_supplement: async ({ date }: any) => {
      try {
        const llmConfig = await getUserChatConfig(userId);
        const r = await startNewLoreSupplement(date, llmConfig, userId);
        return `新知补充已启动（${r.date}），后台运行中。包含：${r.modules.join("、")}。进度会自动展示给用户，你可以继续与用户对话。`;
      } catch (err: any) {
        return `启动失败: ${err?.message || err}`;
      }
    },
    run_newlore_modules: async ({ modules, date }: any) => {
      try {
        if (!Array.isArray(modules) || modules.length === 0) {
          return "请提供要运行的模块列表，如 [\"arxiv\", \"github\"]";
        }
        const llmConfig = await getUserChatConfig(userId);
        const r = await startNewLoreModules(modules, date, llmConfig, userId);
        return `已启动指定模块（${r.date}）：${r.modules.join("、")}。后台运行中，进度会自动展示。`;
      } catch (err: any) {
        return `启动失败: ${err?.message || err}`;
      }
    },
    get_newlore_status: async () => {
      const status = await getRunStatus();
      const supp = status.supplement;
      if (!supp) return "当前无新知补充任务";
      if (supp.isRunning) {
        const done = supp.modules.filter((m) => m.status === "done" || m.status === "failed").length;
        const current = supp.currentModule === "merge"
          ? "合并日报中"
          : supp.modules.find((m) => m.name === supp.currentModule)?.label ?? "运行中";
        return `新知补充运行中（${done}/${supp.modules.length}）：${current}`;
      }
      if (supp.phase === "done") return "新知补充已完成";
      if (supp.phase === "failed") return `新知补充失败：${supp.error ?? "未知错误"}`;
      return "当前无新知补充任务";
    },
    // ── 博客信息源管理 ──
    list_blog_sources: async () => {
      const config = await getEffectiveConfig(userId);
      const sources = config.blog_sources || [];
      if (sources.length === 0) return "当前使用默认博客源（配置为空）。";
      return `当前共 ${sources.length} 个博客信息源：\n` + sources.map((s, i) => `${i + 1}. ${s}`).join("\n");
    },
    add_blog_source: async ({ name, url }: any) => {
      const label = String(name ?? "").trim();
      const feedUrl = String(url ?? "").trim();
      if (!label) return "请提供信息源名称";
      if (!feedUrl.startsWith("http")) return "请提供以 http 开头的 RSS/Atom 地址";
      if (label.includes("|")) return "名称中不能包含 | 字符";
      const config = await getEffectiveConfig(userId);
      const sources = [...(config.blog_sources || [])];
      if (sources.some((s) => s.endsWith(`|${feedUrl}`) || s.split("|")[0] === label)) {
        return `信息源 ${label} 已存在。`;
      }
      sources.push(`${label}|${feedUrl}`);
      await updateEffectiveConfig(userId, { blog_sources: sources });
      return `已添加博客信息源：${label}（${feedUrl}）。当前共 ${sources.length} 个。`;
    },
    remove_blog_source: async ({ name }: any) => {
      const config = await getEffectiveConfig(userId);
      const sources = config.blog_sources || [];
      const key = String(name ?? "").trim().toLowerCase();
      const remaining = sources.filter((s) => {
        const idx = s.lastIndexOf("|");
        const label = (idx === -1 ? s : s.slice(0, idx)).toLowerCase();
        const url = idx === -1 ? "" : s.slice(idx + 1).toLowerCase();
        return label !== key && url !== key && s !== name;
      });
      if (remaining.length === sources.length) {
        return `未找到信息源"${name}"。`;
      }
      await updateEffectiveConfig(userId, { blog_sources: remaining });
      return `已移除信息源"${name}"。当前共 ${remaining.length} 个。`;
    },
    // ── 配置查看与更新 ──
    get_newlore_config: async () => {
      const config = maskConfig(await getEffectiveConfig(userId));
      const entries = Object.entries(config)
        .filter(([, v]) => v !== "" && !(Array.isArray(v) && v.length === 0))
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? JSON.stringify(v) : v}`);
      return `当前新知配置：\n${entries.join("\n")}`;
    },
    update_newlore_config: async ({ key, value }: any) => {
      const k = String(key ?? "").trim();
      if (!k) return "请提供配置键名";
      if (BLOCKED_CONFIG_KEYS.has(k)) return `出于安全考虑，不能通过对话修改 ${k}（API Key/Token 类）。请在设置页修改。`;
      const config = await getEffectiveConfig(userId);
      if (!(k in config)) return `未知配置键：${k}。可用 get_newlore_config 查看当前配置。`;
      await updateEffectiveConfig(userId, { [k]: value } as any);
      return `已更新配置 ${k} = ${Array.isArray(value) ? JSON.stringify(value) : value}`;
    },
  };
}
