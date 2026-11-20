import { randomUUID } from "node:crypto";
import { load } from "cheerio";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { notes, users } from "../db/schema.js";
import { getReport } from "./newlore/reports.js";

const SOURCE_APP = "newlore-highlight";
const MAX_HIGHLIGHTS = 500;
const MAX_DOCUMENT_BYTES = 1_000_000;
const fieldSchema = z.enum(["title", "oneLiner", "summary", "insight"]);
const segmentSchema = z.object({
  materialKey: z.string().min(1).max(1000).refine(value => value.trim().length > 0),
  field: fieldSchema,
  start: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  end: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  text: z.string().min(1).max(50_000),
  contextBefore: z.string().max(24).optional(),
  contextAfter: z.string().max(24).optional(),
  sourceUrl: z.string().url().max(1000).refine(value => /^https?:\/\//i.test(value)).optional(),
}).refine(segment => segment.end > segment.start && segment.end - segment.start === segment.text.length);
const inputSchema = z.object({
  requestId: z.string().uuid().optional(),
  text: z.string().min(1).max(50_000).refine(value => value.trim().length > 0),
  segments: z.array(segmentSchema).min(1).max(100),
  style: z.enum(["highlight", "bold", "underline"]).default("highlight"),
}).refine(input => input.segments.reduce((length, segment) => length + segment.text.length, 0) <= 50_000
  && input.text === input.segments.map(segment => segment.text).join("\n"));
const highlightSchema = inputSchema.innerType().omit({ requestId: true }).extend({
  id: z.string().uuid(), createdAt: z.string().datetime(),
});
const documentSchema = z.object({ highlights: z.array(highlightSchema) });
const noteSchema = documentSchema.extend({ kind: z.literal("daily-highlights"), reportDate: z.string() });
export type DailyHighlight = z.infer<typeof highlightSchema>;
type HighlightNote = Pick<typeof notes.$inferSelect, "id" | "status" | "rawContent">;
type HighlightReader = Pick<typeof db, "select">;
type Material = { key: string; urls: string[]; fields: Partial<Record<z.infer<typeof fieldSchema>, string>> };

export class DailyHighlightError extends Error {
  /** Keep expected validation errors readable at the HTTP boundary. */
  constructor(public readonly status: number, message: string) {
    super(message); this.name = "DailyHighlightError";
  }
}

/** Validate the calendar date before reading the installation's report file. */
async function checkReport(date: string) {
  if (!/^\d{8}$/.test(date)) throw new DailyHighlightError(400, "日报日期应为有效的 YYYYMMDD");
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
    throw new DailyHighlightError(400, "日报日期应为有效的 YYYYMMDD");
  }
  const html = await getReport(date);
  if (html === null) throw new DailyHighlightError(404, "日报不存在");
  return { iso, html };
}

/** Match the native reader's original textContent, including inline labels and UTF-16 offsets. */
function reportMaterials(html: string): Material[] {
  const $ = load(html);
  const materials: Material[] = [];
  const reasonLabel = /^(核心洞察|核心推荐|值得关注|Core Insight|Core Recommendation|Worth Following)[:：]/i;
  $(".card").each((_index, element) => {
    const card = $(element);
    const heading = card.find("h3,h4,h2").filter((_i, node) => !$(node).closest(".summary-block,.abstract-cn").length).first();
    if (!heading.length) return;
    const urls = card.find("a[href]").map((_i, node) => $(node).attr("href") ?? "").get().filter(url => /^https?:\/\//i.test(url));
    const titleUrl = heading.find("a[href]").filter((_i, node) => /^https?:\/\//i.test($(node).attr("href") ?? "")).first().attr("href");
    const source = (titleUrl || urls[0] || heading.text()).trim();
    if (!source) return;
    const section = card.closest(".report-section");
    const module = section.attr("data-module-id") || section.attr("id") || section.children("h2").first().text().trim() || "standalone";
    const key = JSON.stringify([module, source]);
    const paragraphs = card.children("p");
    const insight = paragraphs.filter((_i, node) => $(node).hasClass("recommendation") || reasonLabel.test($(node).text().trim())).first();
    const intro = paragraphs.filter((_i, node) => !$(node).is(".meta,.meta-list,.links,.recommendation,.muted,.empty-state") && !reasonLabel.test($(node).text().trim())).first();
    const lead = card.find("p.lead").first();
    const oneLiner = lead.length ? lead : intro;
    const translated = card.find(".abstract-cn p");
    const abstract = translated.length ? translated : card.find(".summary-block p");
    const fields: Material["fields"] = { title: heading.text(), oneLiner: oneLiner.text(), summary: abstract.text(), insight: insight.text() };
    materials.push({ key, urls, fields });
  });
  // Reports with summary tables still preserve a title's actual source link and row text.
  $(".report-section").filter((_i, section) => !$(section).find(".card").length).find("table.summary-table tbody tr").each((_index, element) => {
    const cells = $(element).children("td");
    if (cells.length < 3) return;
    const title = cells.eq(1);
    const urls = title.find("a[href]").map((_i, node) => $(node).attr("href") ?? "").get().filter(url => /^https?:\/\//i.test(url));
    const source = (urls[0] || title.text()).trim();
    if (!source) return;
    const section = $(element).closest(".report-section");
    const module = section.attr("data-module-id") || section.attr("id") || section.children("h2").first().text().trim() || "standalone";
    const key = JSON.stringify([module, source]);
    materials.push({ key, urls, fields: { title: title.text(), oneLiner: cells.eq(3).text() } });
  });
  return materials;
}

/** Verify provenance against the exact material rather than trusting a caller-supplied URL. */
function verifiedSegments(html: string, segments: DailyHighlight["segments"]) {
  const materials = reportMaterials(html);
  return segments.map(segment => {
    const material = materials.find(item => item.key === segment.materialKey && item.fields[segment.field]?.slice(segment.start, segment.end) === segment.text);
    if (!material) throw new DailyHighlightError(400, "所选片段与日报字段内容不一致");
    if (segment.sourceUrl && !material.urls.includes(segment.sourceUrl)) throw new DailyHighlightError(400, "片段来源链接与日报材料不一致");
    const sourceUrl = segment.sourceUrl || material.urls[0];
    return { ...segment, ...(sourceUrl ? { sourceUrl } : {}) };
  });
}

/** Restrict the shared report's quick-note record to its authenticated owner. */
function highlightScope(userId: string, date: string) {
  return and(eq(notes.userId, userId), eq(notes.sourceApp, SOURCE_APP), inArray(notes.status, ["active", "archived"]),
    sql`${notes.rawContent}->>'kind' = 'daily-highlights'`, sql`${notes.rawContent}->>'reportDate' = ${date}`);
}

/** Preserve malformed saved data and allow an explicitly empty document after cancellation. */
function savedHighlights(settings: unknown, date: string): DailyHighlight[] {
  const shelf = (settings as Record<string, unknown> | null)?.dailyHighlights;
  if (shelf === undefined) return [];
  if (!shelf || typeof shelf !== "object" || Array.isArray(shelf)) throw new DailyHighlightError(409, "已保存划线的数据格式无效");
  if (!Object.prototype.hasOwnProperty.call(shelf, date)) return [];
  const parsed = documentSchema.safeParse((shelf as Record<string, unknown>)[date]);
  if (!parsed.success) throw new DailyHighlightError(409, "已保存划线的数据格式无效");
  return parsed.data.highlights;
}

/** Read only the retained excerpts in the dedicated note. */
function notedHighlights(note: HighlightNote | undefined): DailyHighlight[] {
  if (!note) return [];
  const parsed = noteSchema.safeParse(note.rawContent);
  if (!parsed.success) throw new DailyHighlightError(409, "已有摘录笔记的数据格式无效");
  return parsed.data.highlights;
}

/** Ignore recovery context and source metadata when recognizing repeated selections. */
function positionKey(highlight: Pick<DailyHighlight, "segments" | "style">): string {
  return JSON.stringify([highlight.style, highlight.segments.map(segment => [segment.materialKey, segment.field, segment.start, segment.end, segment.text])]);
}

/** Lock the note only during mutation; the user row serializes marks and quick notes for that owner. */
async function readState(reader: HighlightReader, userId: string, date: string, settings: unknown, lock = false) {
  const query = reader.select({ id: notes.id, status: notes.status, rawContent: notes.rawContent }).from(notes)
    .where(highlightScope(userId, date)).orderBy(asc(notes.createdAt), asc(notes.id)).limit(1);
  const [note] = await (lock ? query.for("update") : query);
  return { note, highlights: savedHighlights(settings, date) };
}

/** Derive quick-note flags from the live note so a trashed note permits a new capture. */
function viewState(note: HighlightNote | undefined, highlights: DailyHighlight[]) {
  const saved = notedHighlights(note);
  const ids = new Set(saved.map(highlight => highlight.id));
  const positions = new Set(saved.map(positionKey));
  return { noteId: note?.id ?? null, status: note ? note.status as "active" | "archived" : null,
    highlights: highlights.map(highlight => ({ ...highlight, quickNoted: ids.has(highlight.id) || positions.has(positionKey(highlight)) })) };
}

/** Bound each report while updating only its settings path, preserving model credentials and other documents. */
async function writeDocument(tx: Pick<typeof db, "update">, userId: string, date: string, highlights: DailyHighlight[]) {
  const patch = JSON.stringify({ [date]: { highlights } });
  if (highlights.length > MAX_HIGHLIGHTS || Buffer.byteLength(patch) > MAX_DOCUMENT_BYTES) throw new DailyHighlightError(400, "单份日报的划线已达到保存上限");
  await tx.update(users).set({
    settings: sql`jsonb_set(COALESCE(${users.settings}, '{}'::jsonb), '{dailyHighlights}', (COALESCE(${users.settings}->'dailyHighlights', '{}'::jsonb) || ${patch}::jsonb), true)`,
    updatedAt: new Date(),
  }).where(eq(users.id, userId));
}

/** Keep a plain-text ordered list, indenting continuation lines without changing source punctuation. */
function noteContent(highlights: DailyHighlight[]): string {
  return highlights.map((highlight, index) => {
    const marker = `${index + 1}. `;
    const text = highlight.text.replace(/\r\n?/g, "\n").replace(/\n/g, `\n${" ".repeat(marker.length)}`);
    return `${marker}${text}`;
  }).join("\n\n");
}

/** Return the owner's persistent marks without generating or changing a report. */
export async function getDailyHighlights(userId: string, date: string) {
  await checkReport(date);
  const [owner] = await db.select({ settings: users.settings }).from(users).where(eq(users.id, userId));
  if (!owner) throw new DailyHighlightError(404, "用户不存在");
  const state = await readState(db, userId, date, owner.settings);
  return viewState(state.note, state.highlights);
}

/** Save a mark independently; this action leaves the notes table untouched. */
export async function saveDailyHighlight(userId: string, date: string, body: unknown) {
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) throw new DailyHighlightError(400, "摘录内容或所选位置格式无效");
  const { html } = await checkReport(date);
  const input = { ...parsed.data, segments: verifiedSegments(html, parsed.data.segments) };
  return db.transaction(async tx => {
    const [owner] = await tx.select({ settings: users.settings }).from(users).where(eq(users.id, userId)).for("update");
    if (!owner) throw new DailyHighlightError(404, "用户不存在");
    const state = await readState(tx, userId, date, owner.settings, true);
    const location = positionKey(input);
    const requested = input.requestId && state.highlights.find(highlight => highlight.id === input.requestId);
    if (requested && positionKey(requested) !== location) throw new DailyHighlightError(409, "请求标识已用于其他划线");
    const duplicate = requested || state.highlights.find(highlight => positionKey(highlight) === location);
    const highlight = duplicate || { id: input.requestId ?? randomUUID(), text: input.text, segments: input.segments, style: input.style, createdAt: new Date().toISOString() };
    const next = duplicate ? state.highlights : [...state.highlights, highlight];
    if (!duplicate) await writeDocument(tx, userId, date, next);
    const view = viewState(state.note, next);
    return { ...view, highlight: view.highlights.find(item => item.id === highlight.id)!, created: !duplicate, deduplicated: Boolean(duplicate) };
  });
}

/** Cancel the mark while keeping previously captured note excerpts and their order. */
export async function cancelDailyHighlight(userId: string, date: string, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new DailyHighlightError(400, "划线标识格式无效");
  await checkReport(date);
  return db.transaction(async tx => {
    const [owner] = await tx.select({ settings: users.settings }).from(users).where(eq(users.id, userId)).for("update");
    if (!owner) throw new DailyHighlightError(404, "用户不存在");
    const state = await readState(tx, userId, date, owner.settings, true);
    const next = state.highlights.filter(highlight => highlight.id !== id);
    const deleted = next.length !== state.highlights.length;
    if (deleted) await writeDocument(tx, userId, date, next);
    return { ...viewState(state.note, next), deleted };
  });
}

/** Append to one ordered note per owner and report, reusing archived notes and retaining provenance. */
export async function quickNoteDailyHighlight(userId: string, date: string, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new DailyHighlightError(400, "划线标识格式无效");
  const { iso } = await checkReport(date);
  return db.transaction(async tx => {
    const [owner] = await tx.select({ settings: users.settings }).from(users).where(eq(users.id, userId)).for("update");
    if (!owner) throw new DailyHighlightError(404, "用户不存在");
    const state = await readState(tx, userId, date, owner.settings, true);
    const highlight = state.highlights.find(item => item.id === id);
    if (!highlight) throw new DailyHighlightError(404, "划线内容不存在");
    const saved = notedHighlights(state.note);
    const duplicate = saved.some(item => item.id === id || positionKey(item) === positionKey(highlight));
    let note = state.note;
    if (!duplicate) {
      const next = [...saved, highlight];
      const sourceUrls = [...new Set(next.flatMap(item => item.segments.flatMap(segment => segment.sourceUrl ? [segment.sourceUrl] : [])))];
      const rawContent = { kind: "daily-highlights", reportDate: date, highlights: next, sourceUrls };
      if (next.length > MAX_HIGHLIGHTS || Buffer.byteLength(JSON.stringify(rawContent)) > MAX_DOCUMENT_BYTES) throw new DailyHighlightError(400, "单份日报的摘录已达到保存上限");
      if (note) {
        [note] = await tx.update(notes).set({ content: noteContent(next), rawContent, sourceUrl: sourceUrls[0] ?? null, updatedAt: new Date() })
          .where(and(eq(notes.id, note.id), eq(notes.userId, userId), eq(notes.sourceApp, SOURCE_APP)))
          .returning({ id: notes.id, status: notes.status, rawContent: notes.rawContent });
      } else {
        [note] = await tx.insert(notes).values({ userId, contentType: "text", sourceApp: SOURCE_APP,
          title: `${iso} 新知摘录`, sourceUrl: sourceUrls[0] ?? null, status: "active", content: noteContent(next), rawContent,
        }).returning({ id: notes.id, status: notes.status, rawContent: notes.rawContent });
      }
    }
    const view = viewState(note, state.highlights);
    return { ...view, highlight: view.highlights.find(item => item.id === id)!, created: !state.note, deduplicated: duplicate };
  });
}
