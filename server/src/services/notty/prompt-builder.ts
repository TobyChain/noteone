/**
 * Notty prompt building: user note index + system prompt.
 * Shared context source for the chat session flow.
 */
import { db } from "../../db/client.js";
import { notes, noteTags, tags } from "../../db/schema.js";
import { eq, and, ne, inArray, count, max } from "drizzle-orm";

export interface NoteIndexEntry {
  id: string;
  title: string | null;
  aiSummary: string | null;
  contentType: string;
  createdAt: Date;
}

export interface NoteIndex {
  allNotes: NoteIndexEntry[];
  indexText: string;
  version: string;
}

// Per-user cache keyed by a cheap version stamp (count + max updatedAt); the
// full index rebuild (all notes + all tags + string concat) only happens when
// notes actually changed. This is the hottest path — every chat message.
const indexCache = new Map<string, { version: string; index: NoteIndex }>();

export async function buildNoteIndex(userId: string): Promise<NoteIndex> {
  const [stamp] = await db.select({
    n: count(),
    latest: max(notes.updatedAt),
  }).from(notes).where(and(eq(notes.userId, userId), ne(notes.status, "trashed")));
  const version = `${stamp?.n ?? 0}:${stamp?.latest?.toISOString() ?? ""}`;

  const cached = indexCache.get(userId);
  if (cached && cached.version === version) return cached.index;

  const allNotes = await db.query.notes.findMany({
    where: and(eq(notes.userId, userId), ne(notes.status, "trashed")),
    columns: { id: true, title: true, aiSummary: true, contentType: true, createdAt: true },
  });

  const noteIdList = allNotes.map((n) => n.id);
  const allTags = noteIdList.length === 0 ? [] : await db.select({
    noteId: noteTags.noteId,
    name: tags.name,
  }).from(noteTags).innerJoin(tags, eq(noteTags.tagId, tags.id))
    .where(inArray(noteTags.noteId, noteIdList));

  const tagsByNote = new Map<string, string[]>();
  for (const t of allTags) {
    const list = tagsByNote.get(t.noteId) || [];
    list.push(t.name);
    tagsByNote.set(t.noteId, list);
  }

  const indexText = allNotes.map((n, i) => {
    const ntags = tagsByNote.get(n.id)?.join(", ") || "";
    return `[${i + 1}] ${n.title || "无标题"} | ${n.aiSummary?.slice(0, 80) || "无摘要"} | tags: ${ntags}`;
  }).join("\n");

  const index: NoteIndex = { allNotes, indexText, version };
  indexCache.set(userId, { version, index });
  return index;
}

const STABLE_PREFIX = `你是闹闹，壹识应用的 AI 助手。你可以帮助用户检索、总结和分析他们的笔记。

你拥有以下工具：
- read_note：按索引序号([N] 里的数字)或笔记 id 读取某条笔记的正文与来源/作者信息。支持 offset/limit 分段读取大笔记。
- search_notes：当用户的问题无法仅凭标题/摘要定位时，用语义检索找出最相关的笔记，再用 read_note 读取正文。
- web_fetch：获取外部网页内容（用户分享链接或需要查看网页时）。
- search_web：在互联网上搜索关键词，获取外部信息。当用户想了解笔记之外的知识时使用。
- list_ascan_reports：列出最近的新知日报（科技前沿日报），了解最新技术动态时使用。
- get_ascan_report：获取指定日期的新知日报纯文本内容。
- delete_ascan_report：删除指定日期的新知日报（用户明确要求删除时使用）。
- start_ascan_supplement({ date? })：启动新知补充（非阻塞，立即返回）。后台并行运行 arXiv、GitHub、官方动态、博客、会议论文、微信公众号 6 个模块并合并日报。用户说"补充今日新知"时调用。调用后你可以继续与用户对话，进度会自动展示给用户。
- get_ascan_status()：查看新知补充的运行状态和进度。
- run_command({ command })：在本地终端执行白名单只读命令（grep/find/ls/cat 等），路径限定 ~/Documents、~/Desktop、~/Downloads。用户让你搜索本地文件、查看目录、读文件内容时使用。
- search_files({ query, path?, filePattern? })：在本地目录中搜索文件内容（grep），比 run_command 更结构化。
- list_files({ path, recursive? })：列出本地目录内容。
- read_file({ path, offset?, limit? })：读取本地文件内容（按行）。
- schedule_task({ name, cron, action })：创建定时任务。action 目前支持 start_ascan_supplement（定时补充新知）。cron 格式如 "0 8 * * *" = 每天 8 点。
- list_scheduled_tasks()：列出所有定时任务。
- cancel_scheduled_task({ taskId })：取消定时任务。
- get_ascan_preferences()：获取用户的新知挖取偏好（每日重点、兴趣主题、模块显示顺序）。
- update_ascan_preferences({ focus?, topics?, moduleOrder? })：更新新知挖取偏好。用户说"今天重点关注XX"或"调整日报顺序"时使用。

规则：
- 用中文回答
- 引用笔记时注明标题；引用笔记内容前先用 read_note 读取正文
- 简洁友好
- 遇到 URL 时主动使用 web_fetch 查看内容
- 启动新知补充后，告诉用户已启动即可，进度会自动展示`;

export function buildStableSystemPrompt(): string {
  return STABLE_PREFIX;
}

export function buildDynamicContext(index: NoteIndex): string {
  return `用户共有 ${index.allNotes.length} 条笔记，索引如下（仅含标题与摘要，不含正文）：
${index.indexText}

重要：上面的索引只是目录，不包含笔记正文。当你需要引用、总结或分析某条笔记的具体内容时，必须先调用工具读取正文，不要凭索引里的摘要臆测正文内容。`;
}

export function buildNottySystemPrompt(index: NoteIndex): string {
  return `${STABLE_PREFIX}\n\n${buildDynamicContext(index)}`;
}
