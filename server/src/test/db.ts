// Helpers for integration tests that use disposable embedded PGlite by default or an
// explicitly configured Postgres + pgvector database.
//
// To run integration tests:
//   npm run test:integration
// Or set TEST_DATABASE_URL and use npm run test:integration:postgres.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql as raw } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { db as appDb, dbReady } from "../db/client.js";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const integrationEnabled = Boolean(TEST_DATABASE_URL || process.env.TEST_PGLITE_DIR);

let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

export function getTestDb() {
    if (process.env.TEST_PGLITE_DIR) return appDb;
    if (!TEST_DATABASE_URL) {
        throw new Error("TEST_DATABASE_URL not set");
    }
    if (!_db) {
        _client = postgres(TEST_DATABASE_URL);
        _db = drizzle(_client, { schema });
    }
    return _db;
}

export async function closeTestDb() {
    if (process.env.TEST_PGLITE_DIR) return;
    if (_client) {
        await _client.end({ timeout: 1 });
        _client = null;
        _db = null;
    }
}

/** Wipe all rows in dependency order — fast, doesn't touch schema. */
export async function resetTables() {
    const target = process.env.TEST_PGLITE_DIR ? appDb : _db;
    if (!target) return;
    await dbReady();
    await target.execute(raw`
    TRUNCATE TABLE farview_snapshots, wechat_articles, conference_papers, blog_posts, official_items, github_repos, papers,
      chat_messages, chat_sessions, note_tags, notes, tags, users RESTART IDENTITY CASCADE
  `);
}

/** Convenience: insert a fresh user and return its id. */
export async function createTestUser(opts: { name?: string; email?: string } = {}): Promise<string> {
    const { users } = schema;
    const target = getTestDb();
    await dbReady();
    const [created] = await target.insert(users).values({
        appleId: `test-${Math.random().toString(36).slice(2)}`,
        email: opts.email ?? null,
        name: opts.name ?? "Test User",
    }).returning();
    return created.id;
}
