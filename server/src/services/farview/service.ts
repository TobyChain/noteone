import { desc, eq, sql } from "drizzle-orm";
import { db, rowsOf } from "../../db/client.js";
import { farviewSnapshots } from "../../db/schema.js";
import { getConfig } from "../newlore/config.js";
import { buildFarViewSnapshot, type FarViewSnapshotPayload, type FarViewSourceItem, type FarViewSourceType } from "./engine.js";
import { dateKey, shiftDateKey } from "../calendar-date.js";

type SourceRow = {
  source_type: FarViewSourceType;
  source_id: string | number;
  title: string | null;
  summary: string | null;
  keywords: unknown;
  observed_date: string | null;
  url: string | null;
};

export interface FarViewStatus {
  isRunning: boolean;
  lastGeneratedAt: string | null;
  periodStart: string | null;
  error: string | null;
}

let running = false;
let lastError: string | null = null;

function normalizeKeywords(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function loadFarViewSourceItems(through: string | Date): Promise<FarViewSourceItem[]> {
  const to = dateKey(through);
  const from = shiftDateKey(to, -6);
  const result = await db.execute(sql<SourceRow>`
    SELECT 'paper' AS source_type, id::text AS source_id, title, abstract AS summary, keywords,
           LEFT(COALESCE(first_seen_date, created_at::date::text, published), 10) AS observed_date, abs_url AS url
      FROM papers WHERE LEFT(COALESCE(first_seen_date, created_at::date::text, published), 10) BETWEEN ${from} AND ${to}
    UNION ALL
    SELECT 'conference', id::text, title, COALESCE(abstract, summary_cn, tldr), keywords,
           LEFT(COALESCE(first_seen_date, publication_date, created_at_ts::date::text), 10), url
      FROM conference_papers WHERE LEFT(COALESCE(first_seen_date, publication_date, created_at_ts::date::text), 10) BETWEEN ${from} AND ${to}
    UNION ALL
    SELECT 'github', id::text, full_name, COALESCE(description, one_liner), topics,
           LEFT(COALESCE(first_seen_date, created_at_ts::date::text), 10), url
      FROM github_repos WHERE LEFT(COALESCE(first_seen_date, created_at_ts::date::text), 10) BETWEEN ${from} AND ${to}
    UNION ALL
    SELECT 'blog', id::text, COALESCE(title, slug), COALESCE(summary, summary_cn, one_liner), '[]'::jsonb,
           LEFT(COALESCE(first_seen_date, date, created_at_ts::date::text), 10), url
      FROM blog_posts WHERE LEFT(COALESCE(first_seen_date, date, created_at_ts::date::text), 10) BETWEEN ${from} AND ${to}
    UNION ALL
    SELECT 'official', id::text, COALESCE(title, slug), COALESCE(summary, summary_cn, one_liner), '[]'::jsonb,
           LEFT(COALESCE(first_seen_date, date, created_at_ts::date::text), 10), url
      FROM official_items WHERE LEFT(COALESCE(first_seen_date, date, created_at_ts::date::text), 10) BETWEEN ${from} AND ${to}
    UNION ALL
    SELECT 'wechat', id::text, title, COALESCE(summary, summary_cn, one_liner), keywords,
           LEFT(COALESCE(first_seen_date, publish_time, created_at_ts::date::text), 10), url
      FROM wechat_articles WHERE LEFT(COALESCE(first_seen_date, publish_time, created_at_ts::date::text), 10) BETWEEN ${from} AND ${to}
  `);
  return rowsOf<SourceRow>(result).flatMap((row) => row.title && row.observed_date ? [{
    sourceType: row.source_type, sourceId: String(row.source_id), title: row.title, summary: row.summary,
    keywords: normalizeKeywords(row.keywords), observedDate: row.observed_date.slice(0, 10), url: row.url,
  }] : []);
}

async function performFarViewRefresh(through: string | Date): Promise<FarViewSnapshotPayload> {
  lastError = null;
  try {
    const config = await getConfig();
    const payload = buildFarViewSnapshot(await loadFarViewSourceItems(through), through, {
      minimumCount: Math.max(1, config.farview_minimum_count),
      limit: 10,
      blockedTopics: config.farview_blocked_topics,
    });
    // Keep the existing column for backup compatibility; it now stores the rolling window end date.
    await db.insert(farviewSnapshots).values({
      weekStart: payload.periodEnd, status: "completed", payload, sourceThrough: payload.sourceThrough, generatedAt: new Date(),
    }).onConflictDoUpdate({
      target: farviewSnapshots.weekStart,
      set: { status: "completed", payload, sourceThrough: payload.sourceThrough, generatedAt: new Date(), errorMessage: null },
    });
    return payload;
  } catch (error: any) {
    lastError = error?.message || String(error);
    throw error;
  } finally {
    running = false;
  }
}

export async function refreshFarView(through: string | Date = new Date()): Promise<FarViewSnapshotPayload> {
  if (running) throw Object.assign(new Error("FarView refresh is already running"), { status: 409 });
  running = true;
  return performFarViewRefresh(through);
}

export function startFarViewRefresh(through: string | Date = new Date()): { started: true } {
  if (running) throw Object.assign(new Error("FarView refresh is already running"), { status: 409 });
  running = true;
  void performFarViewRefresh(through).catch((error) => {
    console.error("[farview] refresh failed:", error);
  });
  return { started: true };
}

export async function getLatestFarViewSnapshot(): Promise<FarViewSnapshotPayload | null> {
  const rows = await db.query.farviewSnapshots.findMany({
    orderBy: [desc(farviewSnapshots.generatedAt)],
    limit: 32,
  });
  for (const row of rows) {
    const payload = row.payload as Partial<FarViewSnapshotPayload>;
    if (payload.periodDays === 7 && typeof payload.periodStart === "string") {
      return payload as FarViewSnapshotPayload;
    }
  }
  return null;
}

export async function getFarViewTopic(id: string): Promise<{ snapshot: FarViewSnapshotPayload; topic: FarViewSnapshotPayload["topics"][number] } | null> {
  const snapshot = await getLatestFarViewSnapshot();
  const topic = snapshot?.topics.find((candidate) => candidate.id === id);
  return snapshot && topic ? { snapshot, topic } : null;
}

export async function getFarViewStatus(): Promise<FarViewStatus> {
  const rows = await db.query.farviewSnapshots.findMany({
    orderBy: [desc(farviewSnapshots.generatedAt)],
    limit: 32,
  });
  const row = rows.find((candidate) => {
    const payload = candidate.payload as Partial<FarViewSnapshotPayload>;
    return payload.periodDays === 7 && typeof payload.periodStart === "string";
  });
  const snapshot = row?.payload as FarViewSnapshotPayload | undefined;
  return {
    isRunning: running, lastGeneratedAt: row?.generatedAt?.toISOString() ?? null,
    periodStart: snapshot?.periodStart ?? null, error: lastError ?? row?.errorMessage ?? null,
  };
}
