import { createHash } from "node:crypto";
import { dateKey, isDateKey, shiftDateKey } from "../calendar-date.js";

export type FarViewSourceType = "paper" | "conference" | "github" | "blog" | "official" | "wechat";
const SOURCE_TYPES: FarViewSourceType[] = ["paper", "conference", "github", "blog", "official", "wechat"];

export interface FarViewSourceItem {
  sourceType: FarViewSourceType;
  sourceId: string;
  title: string;
  summary?: string | null;
  keywords?: string[] | null;
  observedDate: string;
  url?: string | null;
}

export interface FarViewRepresentativeItem {
  sourceType: FarViewSourceType;
  sourceId: string;
  title: string;
  url: string | null;
  observedDate: string;
}

export interface FarViewTopic {
  id: string;
  name: string;
  currentCount: number;
  sourceDiversity: number;
  normalizedHeat: number;
  score: number;
  sourceCounts: Partial<Record<FarViewSourceType, number>>;
  representatives: FarViewRepresentativeItem[];
}

export interface FarViewSnapshotPayload {
  periodDays: 7;
  periodStart: string;
  periodEnd: string;
  sourceThrough: string;
  totalItems: number;
  sourceCounts: Partial<Record<FarViewSourceType, number>>;
  topics: FarViewTopic[];
}

interface TopicAggregate {
  sourceItems: Set<string>;
  sourceCounts: Map<FarViewSourceType, number>;
  items: FarViewRepresentativeItem[];
}

interface RankedTopic {
  topic: FarViewTopic;
  supportKey: string;
}

const STOPWORDS = new Set([
  "a", "an", "as", "at", "about", "after", "against", "among", "based", "before", "between",
  "by", "from", "in", "into", "is", "of", "on", "or", "over", "to", "through",
  "toward", "towards", "under", "using", "we", "with", "without", "via", "for",
  "and", "the", "this", "that", "these",
  "those", "their", "our", "your", "its", "are", "be", "been", "being", "did", "do",
  "does", "had", "has", "have", "may", "might", "must", "no", "not", "rather", "should",
  "than", "was", "were", "what", "when", "where", "which", "while", "who", "why", "would",
  "can", "could", "will", "towards", "new", "latest", "novel", "recent",
  "model", "models", "method", "methods", "system", "systems", "framework",
  "approach", "approaches", "analysis", "study", "studies", "research", "paper",
  "papers", "preprint", "article", "blog", "conference", "github", "official",
  "result", "results", "evaluation", "experiment", "experiments", "performance",
  "data", "dataset", "datasets", "task", "tasks", "topic", "topics", "signal", "application", "applications",
  "technology", "technique", "techniques", "work", "propose", "proposed", "present",
  "show", "shows", "introduce", "introduces", "learn", "learning", "training",
  "ai", "agent", "agents",
  "的", "了", "与", "和", "及", "在", "为", "对", "等", "中", "一种",
  "一个", "一些", "我们", "本文", "本研究", "该研究", "这个", "这些",
  "基于", "通过", "针对", "关于", "面向", "采用", "提出", "介绍", "实现",
  "进行", "使用", "利用", "可以", "能够", "如何", "最新", "相关", "一种",
  "研究", "方法", "模型", "系统", "技术", "应用", "框架", "论文", "文章",
  "结果", "实验", "数据", "任务", "性能", "分析", "学习", "训练",
]);

const BLOCKED_PHRASES = new Set([
  "read more", "click here", "learn more", "official blog", "github repository",
  "state of the art", "state-of-the-art", "et al", "arxiv preprint", "topic signal",
  "阅读全文", "点击查看", "点击阅读", "阅读原文", "查看详情", "最新研究", "研究结果",
]);

const ALIASES: Record<string, string> = {
  "large language model": "llm",
  "large language models": "llm",
  "large language": "llm",
  "language model": "llm",
  "language models": "llm",
  "language models llms": "llm",
  "llms": "llm",
  "models llms": "llm",
  "retrieval augmented generation": "rag",
  "retrieval-augmented generation": "rag",
  "recursive self improvement": "recursive self-improvement",
  "ai agents": "ai agent",
  "ai-agent": "ai agent",
  "agent-harness": "agent harness",
};

const CONNECTOR_WORDS = new Set([
  "a", "an", "as", "at", "about", "after", "against", "among", "based", "before",
  "between", "by", "from", "in", "into", "is", "of", "on", "or", "over", "to",
  "through", "toward", "towards", "under", "using", "we", "with", "without", "via",
  "be", "been", "being", "did", "do", "does", "for", "and", "the", "this", "that",
  "these", "those", "their", "our", "your", "may", "might", "must", "no", "not",
  "rather", "should", "than", "what", "when", "where", "which", "while", "who", "why", "would",
]);
const PROSE_BLOCKERS = new Set([
  ...CONNECTOR_WORDS, "new", "latest", "novel", "recent", "method", "methods", "framework",
  "approach", "approaches", "analysis", "study", "studies", "research", "paper", "papers",
  "preprint", "article", "blog", "conference", "official", "result", "results", "evaluation",
  "experiment", "experiments", "performance", "dataset", "datasets", "task", "tasks", "topic",
  "topics", "signal", "application", "applications", "technology", "technique", "techniques",
  "work", "propose", "proposed", "present", "show", "shows", "introduce", "introduces",
  "increasingly", "existing", "extensive", "reliable", "reliability",
]);
const TECHNICAL_SINGLE_TOKENS = new Set([
  "llm", "vlm", "rag", "rlhf", "mcp", "cuda", "swiftui", "pglite",
]);
/** Strip URLs and release numbers before tokenization so their fragments cannot become topics. */
function cleanSourceText(value: string): string {
  return value.normalize("NFKC").toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\bv?\d+(?:\.\d+){1,}\b/g, " ");
}

/** Normalize a candidate and reject generic, malformed, or source-template phrases. */
function normalizePhrase(value: string): string | null {
  const cleaned = cleanSourceText(value)
    .replace(/[^\p{L}\p{N}+#-]+/gu, " ")
    .replace(/\s+/g, " ").trim();
  const alias = ALIASES[cleaned];
  if (alias) return alias;
  const aliased = cleaned;
  if (!aliased || aliased.length < 2 || aliased.length > 64) return null;
  if (BLOCKED_PHRASES.has(aliased) || /^\d+(?:[-.]\d+)*$/.test(aliased)) return null;

  const tokens = aliased.split(" ");
  if (tokens.length === 1 && STOPWORDS.has(aliased)) return null;
  if (tokens.length > 1 && tokens.every((token) => STOPWORDS.has(token))) return null;
  return aliased;
}

/** Extract deterministic one-to-three word topics without retaining source boilerplate. */
export function extractPhrases(item: FarViewSourceItem): string[] {
  const phrases = new Set<string>();
  for (const keyword of item.keywords ?? []) {
    const normalized = normalizePhrase(keyword);
    if (normalized) phrases.add(normalized);
  }

  const fields = [item.title, item.summary ?? ""];
  for (const field of fields) {
    const normalizedField = cleanSourceText(field);
    const englishTokens = normalizedField.match(/[a-z][a-z0-9+#-]{1,30}/g) ?? [];
    for (const token of englishTokens) {
      if (TECHNICAL_SINGLE_TOKENS.has(token)) phrases.add(token);
    }
    for (let size = 2; size <= Math.min(3, englishTokens.length); size++) {
      for (let index = 0; index + size <= englishTokens.length; index++) {
        const tokens = englishTokens.slice(index, index + size);
        const rawPhrase = tokens.join(" ");
        const alias = ALIASES[rawPhrase];
        if (!alias && tokens.some((token) => PROSE_BLOCKERS.has(token))) continue;
        const normalized = alias ?? normalizePhrase(rawPhrase);
        if (normalized) phrases.add(normalized);
      }
    }

    for (const sentence of normalizedField.split(/[，。！？；：,.!?;:\n]+/)) {
      const chineseTokens = [...new Intl.Segmenter("zh", { granularity: "word" }).segment(sentence)]
        .filter((segment) => segment.isWordLike && /^[\p{Script=Han}]+$/u.test(segment.segment))
        .map((segment) => segment.segment)
        .filter((token) => !STOPWORDS.has(token));
      for (let size = 1; size <= Math.min(2, chineseTokens.length); size++) {
        for (let index = 0; index + size <= chineseTokens.length; index++) {
          const normalized = normalizePhrase(chineseTokens.slice(index, index + size).join(""));
          if (normalized) phrases.add(normalized);
        }
      }
    }
  }
  return [...phrases];
}

/** Generate a stable topic identifier from its canonical phrase. */
function topicId(name: string): string {
  return createHash("sha256").update(name).digest("hex").slice(0, 16);
}

/** Prefer representatives from different source types before filling remaining positions. */
function selectRepresentatives(items: FarViewRepresentativeItem[], limit = 3): FarViewRepresentativeItem[] {
  const sorted = [...items].sort((a, b) => a.sourceType.localeCompare(b.sourceType)
    || a.title.localeCompare(b.title) || a.sourceId.localeCompare(b.sourceId));
  const selected: FarViewRepresentativeItem[] = [];
  const usedSources = new Set<FarViewSourceType>();
  for (const item of sorted) {
    if (usedSources.has(item.sourceType)) continue;
    selected.push(item);
    usedSources.add(item.sourceType);
    if (selected.length === limit) return selected;
  }
  for (const item of sorted) {
    if (selected.some((candidate) => candidate.sourceType === item.sourceType && candidate.sourceId === item.sourceId)) continue;
    selected.push(item);
    if (selected.length === limit) break;
  }
  return selected;
}

/** Treat nested n-grams backed by exactly the same content as one topic candidate. */
function phrasesOverlap(first: string, second: string): boolean {
  if (/^[\x00-\x7F]+$/.test(first + second)) {
    const firstTokens = first.split(" ");
    const secondTokens = second.split(" ");
    const shorter = firstTokens.length <= secondTokens.length ? firstTokens : secondTokens;
    const longer = firstTokens.length <= secondTokens.length ? secondTokens : firstTokens;
    return shorter.every((token) => longer.includes(token));
  }
  return first.includes(second) || second.includes(first);
}

/** Rank at most ten topics from the inclusive seven-day window ending at `through`. */
export function buildFarViewSnapshot(
  items: FarViewSourceItem[],
  through: string | Date,
  options: { minimumCount?: number; limit?: number; blockedTopics?: string[] } = {},
): FarViewSnapshotPayload {
  const minimumCount = Math.max(options.minimumCount ?? 2, 1);
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 10);
  const periodEnd = dateKey(through);
  const periodStart = shiftDateKey(periodEnd, -6);
  const blockedTopics = new Set(
    (options.blockedTopics ?? []).map(normalizePhrase).filter((value): value is string => Boolean(value)),
  );
  const seenItems = new Set<string>();
  const sourceCounts: Partial<Record<FarViewSourceType, number>> = {};
  const topics = new Map<string, TopicAggregate>();

  const validItems = items.filter((item) => {
    const observed = item.observedDate.slice(0, 10);
    return isDateKey(observed) && observed >= periodStart && observed <= periodEnd;
  });

  for (const item of validItems) {
    const itemKey = `${item.sourceType}:${item.sourceId}`;
    if (!seenItems.has(itemKey)) {
      seenItems.add(itemKey);
      sourceCounts[item.sourceType] = (sourceCounts[item.sourceType] ?? 0) + 1;
    }
    for (const name of extractPhrases(item)) {
      const aggregate = topics.get(name) ?? {
        sourceItems: new Set<string>(),
        sourceCounts: new Map<FarViewSourceType, number>(),
        items: [],
      };
      if (!aggregate.sourceItems.has(itemKey)) {
        aggregate.sourceItems.add(itemKey);
        aggregate.sourceCounts.set(item.sourceType, (aggregate.sourceCounts.get(item.sourceType) ?? 0) + 1);
        aggregate.items.push({
          sourceType: item.sourceType, sourceId: item.sourceId, title: item.title,
          url: item.url ?? null, observedDate: item.observedDate.slice(0, 10),
        });
      }
      topics.set(name, aggregate);
    }
  }

  const coveredSourceTypes = Object.keys(sourceCounts).length;
  const ranked: RankedTopic[] = [];
  for (const [name, aggregate] of topics) {
    const currentCount = aggregate.sourceItems.size;
    const sourceDiversity = aggregate.sourceCounts.size;
    const documentShare = seenItems.size > 0 ? currentCount / seenItems.size : 0;
    if (blockedTopics.has(name) || currentCount < minimumCount
      || (seenItems.size >= 20 && documentShare >= 0.75)) continue;

    let normalizedHeat = 0;
    for (const sourceType of SOURCE_TYPES) {
      const count = aggregate.sourceCounts.get(sourceType);
      if (count) normalizedHeat += count / (sourceCounts[sourceType] ?? count);
    }
    normalizedHeat = coveredSourceTypes > 0 ? normalizedHeat / coveredSourceTypes : 0;
    const score = Math.log1p(currentCount) + normalizedHeat + sourceDiversity / 6;
    ranked.push({
      supportKey: [...aggregate.sourceItems].sort().join("|"),
      topic: {
        id: topicId(name), name, currentCount, sourceDiversity, normalizedHeat, score,
        sourceCounts: Object.fromEntries(aggregate.sourceCounts),
        representatives: selectRepresentatives(aggregate.items),
      },
    });
  }

  ranked.sort((a, b) => b.topic.score - a.topic.score || b.topic.currentCount - a.topic.currentCount
    || b.topic.sourceDiversity - a.topic.sourceDiversity || a.topic.name.length - b.topic.name.length
    || a.topic.name.localeCompare(b.topic.name));
  const selected: RankedTopic[] = [];
  for (const candidate of ranked) {
    const duplicate = selected.some((existing) => existing.supportKey === candidate.supportKey
      && phrasesOverlap(existing.topic.name, candidate.topic.name));
    if (!duplicate) selected.push(candidate);
    if (selected.length === limit) break;
  }
  return {
    periodDays: 7, periodStart, periodEnd,
    sourceThrough: periodEnd, totalItems: seenItems.size, sourceCounts,
    topics: selected.map((entry) => entry.topic),
  };
}
