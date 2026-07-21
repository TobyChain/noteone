import { pgTable, pgEnum, text, timestamp, uuid, real, boolean, jsonb, index, uniqueIndex, vector, serial, integer } from "drizzle-orm/pg-core";

export const contentTypeEnum = pgEnum("content_type", [
  "text", "image", "video", "link", "mixed",
]);

export const noteStatusEnum = pgEnum("note_status", [
  "pending_ai", "active", "archived", "trashed", "failed",
]);

export const tagDimensionEnum = pgEnum("tag_dimension", [
  "format", "topic", "domain", "module",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  appleId: text("apple_id").unique().notNull(),
  email: text("email"),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  settings: jsonb("settings").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  contentType: contentTypeEnum("content_type").notNull().default("text"),
  title: text("title"),
  content: text("content").notNull(),
  rawContent: jsonb("raw_content"),
  sourceUrl: text("source_url"),
  sourceApp: text("source_app"),
  author: text("author"),
  authorOrg: text("author_org"),
  aiSummary: text("ai_summary"),
  embedding: vector("embedding", { dimensions: 1536 }),
  status: noteStatusEnum("status").notNull().default("pending_ai"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("notes_user_id_idx").on(table.userId),
  index("notes_status_idx").on(table.status),
  index("notes_created_at_idx").on(table.createdAt),
]);

export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  // tenant owner; nullable to keep migration non-destructive for any legacy global tags
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  dimension: tagDimensionEnum("dimension").notNull(),
  parentId: uuid("parent_id"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("tags_user_id_idx").on(table.userId),
  index("tags_dimension_idx").on(table.dimension),
  index("tags_parent_id_idx").on(table.parentId),
]);

export const noteTags = pgTable("note_tags", {
  noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
  tagId: uuid("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  confidence: real("confidence"),
  isManual: boolean("is_manual").notNull().default(false),
}, (table) => [
  index("note_tags_note_id_idx").on(table.noteId),
  index("note_tags_tag_id_idx").on(table.tagId),
  uniqueIndex("note_tags_note_tag_uniq").on(table.noteId, table.tagId),
]);

export const chatSessions = pgTable("chat_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("chat_sessions_user_id_idx").on(table.userId),
]);

export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => chatSessions.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  isSummary: boolean("is_summary").notNull().default(false),
  toolCalls: jsonb("tool_calls"),
  toolCallId: text("tool_call_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("chat_messages_session_id_idx").on(table.sessionId),
]);

// --- Daily Reports ---

export const reportStyleEnum = pgEnum("report_style", [
  "minimal",     // 极简杂志风
  "academic",    // 学术报告风
  "dashboard",   // 仪表盘数据可视化风
  "handwritten", // 手写笔记风
]);

export const reportDepthEnum = pgEnum("report_depth", [
  "brief",      // 速览版 (5 min)
  "deep",       // 深度版 (20 min)
  "action",     // 行动清单版 (TODO only)
]);

export const reportStatusEnum = pgEnum("report_status", [
  "generating",  // 生成中
  "completed",   // 已完成
  "failed",      // 生成失败
]);

export const dailyReports = pgTable("daily_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  date: text("date").notNull(), // YYYY-MM-DD
  style: reportStyleEnum("style").notNull().default("minimal"),
  depth: reportDepthEnum("depth").notNull().default("brief"),
  status: reportStatusEnum("status").notNull().default("generating"),
  htmlContent: text("html_content"),
  sourceNoteIds: jsonb("source_note_ids").default([]),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("daily_reports_user_id_idx").on(table.userId),
  index("daily_reports_date_idx").on(table.date),
  uniqueIndex("daily_reports_user_date_uniq").on(table.userId, table.date),
]);

// --- Scheduled Tasks ---

export const scheduledTasks = pgTable("scheduled_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  cronExpression: text("cron_expression").notNull(),
  action: text("action").notNull(),
  actionParams: jsonb("action_params").default({}),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("scheduled_tasks_user_id_idx").on(table.userId),
  index("scheduled_tasks_enabled_idx").on(table.enabled),
]);

// --- WeChat MP login sessions (auth-key -> token + cookies) ---

export const wechatSessions = pgTable("wechat_sessions", {
  authKey: text("auth_key").primaryKey(),
  token: text("token").notNull(),
  cookies: jsonb("cookies").notNull().default([]),
  nickname: text("nickname"),
  avatar: text("avatar"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("wechat_sessions_expires_at_idx").on(table.expiresAt),
]);

// --- Ascan pipeline tables (ported from the Python SQLAlchemy models; ---
// --- table/column names kept identical so dev DBs reuse dedup history) ---

export const ascanPapers = pgTable("papers", {
  id: serial("id").primaryKey(),
  arxivId: text("arxiv_id").notNull().unique(),
  title: text("title").notNull(),
  authors: jsonb("authors").default([]),
  abstract: text("abstract").default(""),
  absUrl: text("abs_url").notNull(),
  pdfUrl: text("pdf_url"),
  doi: text("doi"),
  doiUrl: text("doi_url"),
  published: text("published"), // YYYY-MM-DD
  bibtex: text("bibtex"),
  affiliations: jsonb("affiliations").default([]),
  primaryImageUrl: text("primary_image_url"),
  transAbs: text("trans_abs").default(""),
  compressed: text("compressed").default(""),
  keywords: jsonb("keywords").default([]),
  subTopic: text("sub_topic").default("未知"),
  recommendation: text("recommendation").default("一般推荐"),
  oneLiner: text("one_liner"),
  coreRecommendation: text("core_recommendation"),
  status: text("status").default("pending"),
  errorMessage: text("error_message"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
}, (table) => [
  index("papers_published_idx").on(table.published),
]);

export const ascanGithubRepos = pgTable("github_repos", {
  id: serial("id").primaryKey(),
  fullName: text("full_name").notNull().unique(),
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  stars: integer("stars").default(0),
  forks: integer("forks").default(0),
  language: text("language"),
  topics: jsonb("topics").default([]),
  url: text("url").notNull(),
  pushedAt: text("pushed_at"),
  repoCreatedAt: text("repo_created_at"),
  oneLiner: text("one_liner"),
  positioning: text("positioning"),
  coreTech: text("core_tech"),
  useCases: text("use_cases"),
  comparison: text("comparison"),
  watchReason: text("watch_reason"),
  relevance: text("relevance"),
  firstSeenDate: text("first_seen_date"),
  lastSeenDate: text("last_seen_date"),
  seenCount: integer("seen_count").default(1),
  starsHistory: jsonb("stars_history").default({}),
  analyzed: boolean("analyzed").default(false),
  createdAtTs: timestamp("created_at_ts").defaultNow(),
  updatedAtTs: timestamp("updated_at_ts").defaultNow(),
}, (table) => [
  index("github_repos_first_seen_idx").on(table.firstSeenDate),
]);

export const ascanOfficialItems = pgTable("official_items", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),
  slug: text("slug").notNull().unique(),
  url: text("url").notNull(),
  title: text("title"),
  date: text("date"),
  category: text("category"),
  itemType: text("item_type").default("article"),
  summary: text("summary"),
  content: text("content"),
  oneLiner: text("one_liner"),
  summaryCn: text("summary_cn"),
  coreInsight: text("core_insight"),
  ecommerceConnection: text("ecommerce_connection"),
  relevance: text("relevance"),
  sitemapLastmod: text("sitemap_lastmod"),
  firstSeenDate: text("first_seen_date"),
  lastSeenDate: text("last_seen_date"),
  analyzed: boolean("analyzed").default(false),
  createdAtTs: timestamp("created_at_ts").defaultNow(),
  updatedAtTs: timestamp("updated_at_ts").defaultNow(),
}, (table) => [
  index("official_items_source_idx").on(table.source),
]);

export const ascanBlogPosts = pgTable("blog_posts", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),
  slug: text("slug").notNull().unique(),
  url: text("url").notNull(),
  title: text("title"),
  date: text("date"),
  sourceLabel: text("source_label"),
  summary: text("summary"),
  content: text("content"),
  oneLiner: text("one_liner"),
  summaryCn: text("summary_cn"),
  ecommerceConnection: text("ecommerce_connection"),
  relevance: text("relevance"),
  firstSeenDate: text("first_seen_date"),
  lastSeenDate: text("last_seen_date"),
  analyzed: boolean("analyzed").default(false),
  createdAtTs: timestamp("created_at_ts").defaultNow(),
  updatedAtTs: timestamp("updated_at_ts").defaultNow(),
}, (table) => [
  index("blog_posts_source_idx").on(table.source),
]);

export const ascanConferencePapers = pgTable("conference_papers", {
  id: serial("id").primaryKey(),
  paperKey: text("paper_key").notNull().unique(),
  title: text("title").notNull(),
  authors: jsonb("authors").default([]),
  abstract: text("abstract"),
  venue: text("venue").notNull(),
  venueFullName: text("venue_full_name"),
  rank: text("rank").notNull(),
  category: text("category"),
  year: integer("year"),
  publicationDate: text("publication_date"),
  doi: text("doi"),
  url: text("url"),
  pdfUrl: text("pdf_url"),
  citationCount: integer("citation_count").default(0),
  tldr: text("tldr"),
  keywords: jsonb("keywords").default([]),
  paperType: text("paper_type"),
  oneLiner: text("one_liner"),
  summaryCn: text("summary_cn"),
  coreContribution: text("core_contribution"),
  ecommerceConnection: text("ecommerce_connection"),
  relevance: text("relevance"),
  source: text("source").default("papers_cool"),
  firstSeenDate: text("first_seen_date"),
  lastSeenDate: text("last_seen_date"),
  analyzed: boolean("analyzed").default(false),
  createdAtTs: timestamp("created_at_ts").defaultNow(),
  updatedAtTs: timestamp("updated_at_ts").defaultNow(),
}, (table) => [
  index("conference_papers_venue_idx").on(table.venue),
]);

export const ascanWechatArticles = pgTable("wechat_articles", {
  id: serial("id").primaryKey(),
  articleId: text("article_id").notNull().unique(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  mpId: text("mp_id").notNull(),
  mpName: text("mp_name"),
  publishTime: text("publish_time"),
  author: text("author"),
  summary: text("summary"),
  content: text("content"),
  coverUrl: text("cover_url"),
  oneLiner: text("one_liner"),
  summaryCn: text("summary_cn"),
  keywords: jsonb("keywords").default([]),
  coreRecommendation: text("core_recommendation"),
  relevance: text("relevance"),
  firstSeenDate: text("first_seen_date"),
  lastSeenDate: text("last_seen_date"),
  analyzed: boolean("analyzed").default(false),
  createdAtTs: timestamp("created_at_ts").defaultNow(),
  updatedAtTs: timestamp("updated_at_ts").defaultNow(),
}, (table) => [
  index("wechat_articles_mp_id_idx").on(table.mpId),
]);
