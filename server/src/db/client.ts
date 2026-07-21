import { drizzle as drizzlePostgres, PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { join } from "path";
import { config } from "../config.js";
import * as schema from "./schema.js";

export type Database = PostgresJsDatabase<typeof schema>;

// Embedded mode (packaged .app): PGlite runs Postgres in-process under the data
// dir — no external database. Dev/server mode: plain postgres.js connection.
// The PGlite drizzle instance is API-compatible with the postgres-js one for
// everything this codebase uses (query API, execute, transactions), so both are
// exposed under the same Database type.
let db: Database;
let bootstrapPromise: Promise<void> = Promise.resolve();

if (config.isEmbedded) {
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite-pgvector");
  const { drizzle: drizzlePglite } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");

  const pglite = new PGlite(join(config.dataDir, "db"), { extensions: { vector } });
  const pgliteDb = drizzlePglite(pglite, { schema });
  db = pgliteDb as unknown as Database;

  const migrationsFolder = process.env.NOTEONE_MIGRATIONS_DIR
    || new URL("../../drizzle", import.meta.url).pathname;
  bootstrapPromise = (async () => {
    await pglite.exec("CREATE EXTENSION IF NOT EXISTS vector;");
    await migrate(pgliteDb, { migrationsFolder });
    console.log("[db] embedded PGlite ready at", join(config.dataDir, "db"));
  })();
} else {
  db = drizzlePostgres(postgres(config.databaseUrl), { schema });
}

/** Resolves when the database is ready (runs migrations in embedded mode). */
export function dbReady(): Promise<void> {
  return bootstrapPromise;
}

/** db.execute() returns an array (postgres-js) or { rows } (pglite); normalize. */
export function rowsOf<T = any>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as any)?.rows ?? []) as T[];
}

export { db };
