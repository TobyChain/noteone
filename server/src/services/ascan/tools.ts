/**
 * Shared ascan tool definitions + handler factory for 闹闹 (chat-sessions).
 * Used by both the regular chat route and the writer route to avoid duplicating
 * tool specs and handlers.
 *
 * `start_ascan_supplement` is NON-BLOCKING: it starts the pipeline in the
 * background and returns immediately, so the chat request is not held open.
 * Progress is tracked server-side and polled by the UI.
 */
import type { ToolDefinition } from "../notty/agent-loop.js";
import { listReports, getReport, deleteReport, stripHtml } from "./reports.js";
import { startAscanSupplement, getRunStatus } from "./runner.js";
import { getUserChatConfig } from "../user-config.js";

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
      description: "启动新知补充（非阻塞，立即返回）。后台依次运行 arXiv、GitHub、官方动态、博客、会议论文、微信公众号 6 个模块并合并日报。用户说\"补充今日新知\"时调用。进度由 UI 自动展示，无需轮询。wechat 需要先在设置中扫码登录微信公众平台，未登录会跳过。",
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
      name: "get_ascan_status",
      description: "查看新知补充的运行状态和进度。",
      parameters: { type: "object", properties: {} },
    },
  },
];

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
        const r = await startAscanSupplement(date, llmConfig);
        return `新知补充已启动（${r.date}），后台运行中。包含：${r.modules.join("、")}。进度会自动展示给用户，你可以继续与用户对话。`;
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
  };
}
