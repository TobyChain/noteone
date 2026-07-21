#!/usr/bin/env node
/**
 * Bundle the NoteOne server into a self-contained directory for packaging
 * inside the macOS .app:
 *
 *   bundle/
 *     server.mjs            — esbuild single-file bundle (ESM, node platform)
 *     node_modules/         — only @electric-sql/* (PGlite WASM assets can't be inlined)
 *     drizzle/              — migration files (applied on first embedded boot)
 *     public/               — /wechat config page
 *     config.schema.json    — ascan config schema
 *     data/                 — pipeline data assets (ccf_conferences.yaml)
 *
 * Usage: node scripts/bundle.mjs
 */
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "bundle");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

await build({
  entryPoints: [join(ROOT, "src/index.ts")],
  outfile: join(OUT, "server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: ["@electric-sql/pglite", "@electric-sql/pglite-pgvector"],
  // express and friends are CJS; provide require() for the ESM bundle.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: "info",
});

// PGlite (WASM + extension tarballs) must stay as real packages on disk.
for (const pkg of ["@electric-sql/pglite", "@electric-sql/pglite-pgvector"]) {
  cpSync(join(ROOT, "node_modules", pkg), join(OUT, "node_modules", pkg), { recursive: true });
}

cpSync(join(ROOT, "drizzle"), join(OUT, "drizzle"), { recursive: true });
cpSync(join(ROOT, "public"), join(OUT, "public"), { recursive: true });
cpSync(join(ROOT, "../ascan/config.schema.json"), join(OUT, "config.schema.json"));
cpSync(join(ROOT, "src/services/ascan/pipeline/data"), join(OUT, "data"), { recursive: true });

console.log(`bundle ready at ${OUT}`);
