/**
 * Schedule tools for 闹闹 — create / list / cancel scheduled tasks.
 * Currently supports one action: "start_ascan_supplement" (定时补充新知).
 */
import type { ToolDefinition } from "./llm.js";
import { createTask, listTasks, cancelTask } from "./scheduler.js";

export const scheduleToolDefinitions: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "schedule_task",
      description:
        "创建定时任务。目前支持 action=\"start_ascan_supplement\"（定时补充新知）。" +
        "cron 表达式为 5 字段标准格式：分 时 日 月 周。例如 \"0 8 * * *\" = 每天 8:00，\"0 8 * * 1-5\" = 工作日 8:00，\"0 */2 * * *\" = 每 2 小时。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "任务名称，如 每日新知补充" },
          cron: { type: "string", description: "cron 表达式，如 \"0 8 * * *\"" },
          action: { type: "string", description: "任务动作，目前仅支持 start_ascan_supplement" },
        },
        required: ["name", "cron", "action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_scheduled_tasks",
      description: "列出当前用户的所有定时任务。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_scheduled_task",
      description: "取消（停用）一个定时任务。",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "任务 ID" },
        },
        required: ["taskId"],
      },
    },
  },
];

export function makeScheduleHandlers(userId: string): Record<string, (args: any) => Promise<string>> {
  return {
    schedule_task: async ({ name, cron: cronExpr, action }: any) => {
      try {
        const task = await createTask(userId, name, cronExpr, action);
        return `定时任务已创建：${task.name}（${task.cronExpression}），ID: ${task.id}`;
      } catch (err: any) {
        return `创建失败: ${err?.message || err}`;
      }
    },
    list_scheduled_tasks: async () => {
      const tasks = await listTasks(userId);
      if (tasks.length === 0) return "暂无定时任务";
      return tasks.map((t) =>
        `[${t.id}] ${t.name} | ${t.cronExpression} | ${t.action} | ${t.enabled ? "启用" : "已停用"} | 上次运行: ${t.lastRunAt?.toISOString().slice(0, 19) ?? "无"}`
      ).join("\n");
    },
    cancel_scheduled_task: async ({ taskId }: any) => {
      const task = await cancelTask(userId, taskId);
      return task ? `已停用定时任务：${task.name}` : "任务不存在";
    },
  };
}
