// Helpers for integration tests that need a real Postgres + pgvector. Tests skip cleanly
// when TEST_DATABASE_URL isn't set, so unit-only `vitest run` stays green offline.
//
// To run integration tests:
//   1) docker compose up db -d  (or any Postgres with pgvector available)
//   2) createdb noteone_test  &&  drizzle-kit migrate (or run the existing migrations)
//   3) TEST_DATABASE_URL=postgres://noteone:noteone@localhost:5432/noteone_test npm run test:run

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql as raw } from "drizzle-orm";
import * as schema from "../db/schema.js";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const integrationEnabled = Boolean(TEST_DATABASE_URL);

let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

export function getTestDb() {
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
    if (_client) {
        await _client.end({ timeout: 1 });
        _client = null;
        _db = null;
    }
}

/** Wipe all rows in dependency order — fast, doesn't touch schema. */
export async function resetTables() {
    if (!_db) return;
    await _db.execute(raw`
    TRUNCATE TABLE chat_messages, chat_sessions, note_tags, notes, tags, users RESTART IDENTITY CASCADE
  `);
}

/** Convenience: insert a fresh user and return its id. */
export async function createTestUser(opts: { name?: string; email?: string } = {}): Promise<string> {
    const { users } = schema;
    const db = getTestDb();
    const [created] = await db.insert(users).values({
        appleId: `test-${Math.random().toString(36).slice(2)}`,
        email: opts.email ?? null,
        name: opts.name ?? "Test User",
    }).returning();
    return created.id;
}
