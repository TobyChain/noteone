/**
 * Shared ascan tool definitions + handler factory for 闹闹 (chat-sessions).
 * Includes module execution, WeChat MP management, blog source management,
 * and config read/update tools so 闹闹 can manage the whole NewSee pipeline.
 */
import type { ToolDefinition } from "../notty/agent-loop.js";
import { listReports, getReport, deleteReport, stripHtml } from "./reports.js";
import { startAscanSupplement, startAscanModules, getRunStatus } from "./runner.js";
import { getUserChatConfig } from "../user-config.js";
import { getConfig, updateConfig, maskConfig } from "./config.js";
import { searchAccounts } from "../wechat/service.js";

export const ascanToolDefinitions: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_ascan_reports",
      description: "列出最近的新知日报（科技前沿日报），包含日期和摘要。用户询问最新科技动态或新知内容时使用。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_ascan_report",
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
      name: "delete_ascan_report",
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
      name: "start_ascan_supplement",
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
      name: "run_ascan_modules",
      description: "只运行指定的爬取模块（而非全部）。用户说\"今天只跑微信公众号\"或\"只补充 arxiv 和 github\"时使用。可选模块：official(官方动态)、blog(独立博客)、github(GitHub)、arxiv(arXiv)、conference(会议论文)、wechat(微信公众号)。",
      parameters: {
        type: "object",
        properties: {
          modules: {
            type: "array",
            items: { type: "string", enum: ["official", "blog", "github", "arxiv", "conference", "wechat"] },
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
      name: "get_ascan_status",
      description: "查看新知补充的运行状态和进度。",
      parameters: { type: "object", properties: {} },
    },
  },
  // ── 公众号管理 ──
  {
    type: "function",
    function: {
      name: "list_wechat_mps",
      description: "列出当前配置抓取的微信公众号。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "search_wechat_mp",
      description: "按关键词搜索微信公众号，返回候选公众号及其 fakeid（用于添加）。需要已登录公众平台。",
      parameters: {
        type: "object",
        properties: { keyword: { type: "string", description: "搜索关键词，如公众号名称" } },
        required: ["keyword"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_wechat_mp",
      description: "添加一个微信公众号到抓取列表。可直接给 fakeid；只给名字时会先搜索并添加最匹配的一个。用户说\"添加公众号XX\"时使用。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "公众号名称" },
          fakeid: { type: "string", description: "公众号 fakeid（可选，不提供时自动搜索）" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_wechat_mp",
      description: "从抓取列表移除一个微信公众号（按名称或 fakeid）。用户说\"删除/不再抓取公众号XX\"时使用。",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "公众号名称或 fakeid" } },
        required: ["name"],
      },
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
      name: "get_ascan_config",
      description: "查看新知 pipeline 的当前配置（API Key 等敏感信息已脱敏）。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "update_ascan_config",
      description: "更新新知 pipeline 的配置项，如 enabled_modules(启用模块列表)、arxiv_subjects(arXiv分类)、github_topics(GitHub主题)、max_total_papers(论文上限)、blog_max_per_source(每博客条数)、wechat_limit_per_mp(每公众号条数)、enabled_modules(启用模块)等。用户说\"把XX改成YY\"时使用。不支持修改 API Key/Token。",
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
  "llm_api_key", "github_token", "semantic_scholar_api_key", "wechat_auth_key",
]);

/**
 * Build the ascan tool handlers bound to a user id (for LLM config lookup).
 */
export function makeAscanHandlers(userId: string): Record<string, (args: any) => Promise<string>> {
  return {
    list_ascan_reports: async () => {
      const reports = await listReports();
      if (reports.length === 0) return "暂无日报";
      return reports.map((r) => `[${r.date}] ${r.summary || "无摘要"}`).join("\n");
    },
    get_ascan_report: async ({ date }: any) => {
      const html = await getReport(date);
      if (!html) return `未找到 ${date} 的日报`;
      return stripHtml(html).slice(0, 8000);
    },
    delete_ascan_report: async ({ date }: any) => {
      try {
        const result = await deleteReport(date);
        return result.deleted ? `已删除日报 ${date}` : `${date} 无可删除的日报文件`;
      } catch (err: any) {
        return `删除失败: ${err?.message || err}`;
      }
    },
    start_ascan_supplement: async ({ date }: any) => {
      try {
        const llmConfig = await getUserChatConfig(userId);
        const r = await startAscanSupplement(date, llmConfig, userId);
        return `新知补充已启动（${r.date}），后台运行中。包含：${r.modules.join("、")}。进度会自动展示给用户，你可以继续与用户对话。`;
      } catch (err: any) {
        return `启动失败: ${err?.message || err}`;
      }
    },
    run_ascan_modules: async ({ modules, date }: any) => {
      try {
        if (!Array.isArray(modules) || modules.length === 0) {
          return "请提供要运行的模块列表，如 [\"wechat\"] 或 [\"arxiv\", \"github\"]";
        }
        const llmConfig = await getUserChatConfig(userId);
        const r = await startAscanModules(modules, date, llmConfig, userId);
        return `已启动指定模块（${r.date}）：${r.modules.join("、")}。后台运行中，进度会自动展示。`;
      } catch (err: any) {
        return `启动失败: ${err?.message || err}`;
      }
    },
    get_ascan_status: async () => {
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
    // ── 公众号管理 ──
    list_wechat_mps: async () => {
      const config = await getConfig();
      const mps = config.wechat_mp_ids || [];
      if (mps.length === 0) return "当前未配置任何公众号。可用 add_wechat_mp 添加。";
      return `当前共 ${mps.length} 个公众号：\n` + mps.map((m, i) => `${i + 1}. ${m.name}（${m.id}）`).join("\n");
    },
    search_wechat_mp: async ({ keyword }: any) => {
      const config = await getConfig();
      if (!config.wechat_auth_key) return "未登录微信公众平台，请先在设置中扫码登录。";
      try {
        const result: any = await searchAccounts(config.wechat_auth_key, String(keyword ?? ""));
        const list = result?.list || result?.biz_list || [];
        if (list.length === 0) return `未找到匹配"${keyword}"的公众号`;
        const lines = list.slice(0, 5).map((item: any, i: number) =>
          `${i + 1}. ${item.nickname || item.alias || "未知"}（fakeid: ${item.fakeid || item.fake_id || "?"}）${item.signature ? " — " + String(item.signature).slice(0, 40) : ""}`,
        );
        return `找到 ${list.length} 个候选公众号：\n${lines.join("\n")}\n\n用 add_wechat_mp({ name, fakeid }) 添加其中一个。`;
      } catch (err: any) {
        return `搜索失败: ${err?.message || err}`;
      }
    },
    add_wechat_mp: async ({ name, fakeid }: any) => {
      const config = await getConfig();
      const mps = [...(config.wechat_mp_ids || [])];
      let id = typeof fakeid === "string" && fakeid ? fakeid : "";
      let displayName = String(name ?? "").trim();
      if (!id) {
        if (!config.wechat_auth_key) return "未登录微信公众平台，请先在设置中扫码登录；或直接提供 fakeid。";
        try {
          const result: any = await searchAccounts(config.wechat_auth_key, displayName);
          const list = result?.list || result?.biz_list || [];
          if (list.length === 0) return `未找到匹配"${displayName}"的公众号，请尝试 search_wechat_mp 查看候选或提供 fakeid。`;
          const top = list[0];
          id = top.fakeid || top.fake_id || "";
          displayName = top.nickname || top.alias || displayName;
          if (!id) return "搜索结果中没有 fakeid，请提供 fakeid。";
        } catch (err: any) {
          return `搜索公众号失败: ${err?.message || err}`;
        }
      }
      if (mps.some((m) => m.id === id)) return `公众号 ${displayName} 已在抓取列表中。`;
      mps.push({ id, name: displayName });
      await updateConfig({ wechat_mp_ids: mps });
      return `已添加公众号：${displayName}（${id}）。当前共 ${mps.length} 个公众号。`;
    },
    remove_wechat_mp: async ({ name }: any) => {
      const config = await getConfig();
      const mps = config.wechat_mp_ids || [];
      const key = String(name ?? "").trim().toLowerCase();
      const remaining = mps.filter((m) => m.name.toLowerCase() !== key && m.id !== name);
      if (remaining.length === mps.length) {
        return `未找到公众号"${name}"。当前列表：${mps.map((m) => m.name).join("、") || "（空）"}`;
      }
      const removed = mps.filter((m) => m.name.toLowerCase() === key || m.id === name);
      await updateConfig({ wechat_mp_ids: remaining });
      return `已移除公众号：${removed.map((m) => m.name).join("、")}。当前共 ${remaining.length} 个。`;
    },
    // ── 博客信息源管理 ──
    list_blog_sources: async () => {
      const config = await getConfig();
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
      const config = await getConfig();
      const sources = [...(config.blog_sources || [])];
      if (sources.some((s) => s.endsWith(`|${feedUrl}`) || s.split("|")[0] === label)) {
        return `信息源 ${label} 已存在。`;
      }
      sources.push(`${label}|${feedUrl}`);
      await updateConfig({ blog_sources: sources });
      return `已添加博客信息源：${label}（${feedUrl}）。当前共 ${sources.length} 个。`;
    },
    remove_blog_source: async ({ name }: any) => {
      const config = await getConfig();
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
      await updateConfig({ blog_sources: remaining });
      return `已移除信息源"${name}"。当前共 ${remaining.length} 个。`;
    },
    // ── 配置查看与更新 ──
    get_ascan_config: async () => {
      const config = maskConfig(await getConfig());
      const entries = Object.entries(config)
        .filter(([, v]) => v !== "" && !(Array.isArray(v) && v.length === 0))
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? JSON.stringify(v) : v}`);
      return `当前新知配置：\n${entries.join("\n")}`;
    },
    update_ascan_config: async ({ key, value }: any) => {
      const k = String(key ?? "").trim();
      if (!k) return "请提供配置键名";
      if (BLOCKED_CONFIG_KEYS.has(k)) return `出于安全考虑，不能通过对话修改 ${k}（API Key/Token 类）。请在设置页修改。`;
      const config = await getConfig();
      if (!(k in config)) return `未知配置键：${k}。可用 get_ascan_config 查看当前配置。`;
      await updateConfig({ [k]: value } as any);
      return `已更新配置 ${k} = ${Array.isArray(value) ? JSON.stringify(value) : value}`;
    },
  };
}
