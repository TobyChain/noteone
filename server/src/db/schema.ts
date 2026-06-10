import { pgTable, pgEnum, text, timestamp, uuid, real, boolean, jsonb, index, vector } from "drizzle-orm/pg-core";

export const contentTypeEnum = pgEnum("content_type", [
  "text", "image", "video", "link", "mixed",
]);

export const noteStatusEnum = pgEnum("note_status", [
  "pending_ai", "active", "archived",
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("notes_user_id_idx").on(table.userId),
  index("notes_status_idx").on(table.status),
  index("notes_created_at_idx").on(table.createdAt),
]);

export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  dimension: tagDimensionEnum("dimension").notNull(),
  parentId: uuid("parent_id"),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
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
]);

export const chatSessions = pgTable("chat_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("chat_sessions_user_id_idx").on(table.userId),
]);

export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => chatSessions.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  isSummary: boolean("is_summary").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("chat_messages_session_id_idx").on(table.sessionId),
]);
