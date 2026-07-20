/**
 * Scheduler — persists and runs scheduled tasks using node-cron.
 * On boot, restores all enabled tasks. When a task fires, it executes the
 * associated action (currently only "start_ascan_supplement").
 */
import * as cron from "node-cron";
import { db } from "../db/client.js";
import { scheduledTasks } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { startAscanSupplement } from "./ascan/runner.js";
import { getUserChatConfig } from "./user-config.js";

const activeJobs = new Map<string, cron.ScheduledTask>();

async function executeAction(task: typeof scheduledTasks.$inferSelect) {
  console.log(`[scheduler] firing task "${task.name}" (${task.action})`);
  try {
    const llmConfig = await getUserChatConfig(task.userId);
    if (task.action === "start_ascan_supplement") {
      await startAscanSupplement(undefined, llmConfig);
    } else {
      console.warn(`[scheduler] unknown action: ${task.action}`);
    }
    await db.update(scheduledTasks)
      .set({ lastRunAt: new Date(), updatedAt: new Date() })
      .where(eq(scheduledTasks.id, task.id));
  } catch (err) {
    console.error(`[scheduler] task "${task.name}" failed:`, err);
  }
}

function startJob(task: typeof scheduledTasks.$inferSelect) {
  if (activeJobs.has(task.id)) return;
  if (!cron.validate(task.cronExpression)) {
    console.warn(`[scheduler] invalid cron expression for "${task.name}": ${task.cronExpression}`);
    return;
  }
  const job = cron.schedule(task.cronExpression, () => executeAction(task));
  activeJobs.set(task.id, job);
  console.log(`[scheduler] started: "${task.name}" (${task.cronExpression})`);
}

function stopJob(taskId: string) {
  const job = activeJobs.get(taskId);
  if (job) {
    job.stop();
    activeJobs.delete(taskId);
  }
}

export async function restoreTasks() {
  const tasks = await db.query.scheduledTasks.findMany({
    where: eq(scheduledTasks.enabled, true),
  });
  for (const t of tasks) startJob(t);
  console.log(`[scheduler] restored ${tasks.length} task(s)`);
}

export async function createTask(
  userId: string,
  name: string,
  cronExpression: string,
  action: string,
  actionParams?: Record<string, any>,
) {
  if (!cron.validate(cronExpression)) {
    throw new Error(`无效的 cron 表达式: ${cronExpression}`);
  }
  const [task] = await db.insert(scheduledTasks).values({
    userId,
    name,
    cronExpression,
    action,
    actionParams: actionParams || {},
  }).returning();
  startJob(task);
  return task;
}

export async function listTasks(userId: string) {
  return db.query.scheduledTasks.findMany({
    where: eq(scheduledTasks.userId, userId),
    orderBy: (scheduledTasks, { desc }) => [desc(scheduledTasks.createdAt)],
  });
}

export async function cancelTask(userId: string, taskId: string) {
  const [task] = await db.update(scheduledTasks)
    .set({ enabled: false, updatedAt: new Date() })
    .where(and(eq(scheduledTasks.id, taskId), eq(scheduledTasks.userId, userId)))
    .returning();
  if (task) stopJob(task.id);
  return task;
}
