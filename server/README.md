# NoteOne Server

Express + Drizzle + PostgreSQL/pgvector backend for the NoteOne apps and MCP integration.

## Quick start

```bash
# Boot Postgres + the API
docker compose up -d
# Or run only the API after creating .env (see .env.example)
npm install
npm run db:migrate
npm run dev
```

Required `.env` keys (validated at startup):

| Key | Notes |
|-----|-------|
| `DATABASE_URL` | Postgres connection string with pgvector available |
| `JWT_SECRET` | >= 16 chars; service refuses to start with the default placeholder in production |
| `HOST` | Bind address; defaults to `127.0.0.1` |
| `NOTEONE_ACCESS_TOKEN` | Required when `HOST` is not loopback; send as `X-NoteOne-Access-Token` to `/auth/local` |
| `TRUST_EXTERNAL_LOOPBACK_BINDING` | Container-only escape hatch when an outer port mapping is verifiably loopback-only |
| `ENABLE_DEV_LOGIN` | `true` enables `POST /auth/dev-token` (never in production) |
| `ALLOWED_ORIGINS` | Comma list of origins for the CORS allow-list |
| `QWEN_API_KEY` / `QWEN_BASE_URL` / `QWEN_MODEL` | Default LLM credentials; users can override per account via `/api/settings` |

## Tests

The test suite includes deterministic unit tests and database integration tests. The
integration command uses disposable embedded PGlite by default and can optionally target
a dedicated Postgres + pgvector database.

```bash
# Unit tests only — always works
npm run test:run

# Integration suite against disposable embedded PGlite
rm -rf /tmp/noteone-integration-pglite
npm run test:integration

# Or run against a Postgres + pgvector test DB you can wipe
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/noteone_test \
  npm run db:migrate && npm run test:integration:postgres
```

Setup for the integration database (one time):

```sql
CREATE DATABASE noteone_test;
\c noteone_test
CREATE EXTENSION IF NOT EXISTS vector;
```

Then run `TEST_DATABASE_URL=... npm run db:migrate` to apply the schema. The test
helpers `TRUNCATE` all tables between tests, so use a dedicated DB.

Coverage focus:

- `services/url-guard.test.ts` — IPv4/IPv6 private/reserved address rejection, DNS lookup paths
- `services/web-fetch.test.ts` — redirect cap, content-type filter, body truncation
- `services/tagging.test.ts` — model output schema validation
- `services/upload-cleanup.test.ts` — UUID-only deletion, path-traversal refusal, batch
- `routes/auth.test.ts` — local-session bootstrap boundary and `dev-token` gate
- `routes/integration.test.ts` (skips without `TEST_DATABASE_URL`) — tag tenant isolation,
- `routes/integration.test.ts` — tag tenant isolation, stable note pagination, import ownership,
  account cascade + file cleanup, and export contents; runs against PGlite by default

## API

In addition to notes / tags / search / chat-sessions / settings / uploads, the server
exposes:

### NewLore pipeline (`/api/newlore/*`)

> `/api/newlore/` is the canonical API. `/api/newsee/` and `/api/ascan/` remain compatibility aliases for existing clients.

The NewLore pipeline runs in-process (TypeScript, `src/services/newlore/pipeline/`).
The server reads/writes its config in `.newlore/.env`（dev 模式；内嵌模式为数据目录下 `newlore/.env`）and tracks run status in-memory. Existing `.newsee` and `.ascan` configuration is read as a compatibility fallback and copied forward on the next update.

| Endpoint | Purpose |
|----------|---------|
| `GET /api/newlore/reports` · `/:date` · `/:date/path` | List / read / get file path for daily reports |
| `DELETE /api/newlore/reports/:date` | Delete a daily report (+ sidecar files) |
| `GET` / `PATCH /api/newlore/config` | Read / update NewLore config (writes to `.newlore/.env`) |
| `POST /api/newlore/trigger` | Fire-and-forget full pipeline run |
| `POST /api/newlore/run-module` | Run a single module (blocking, for 闹闹 orchestration) |
| `POST /api/newlore/merge` | Merge already-run module fragments into a report |
| `POST /api/newlore/abort` | Abort a running pipeline (kills pid) |
| `GET /api/newlore/status` | Check run status + recent log lines |
| `GET /api/newlore/wechat-health` | Check the built-in WeChat MP integration (login state) |
| `POST /api/newlore/summarize` | Generate LLM one-sentence summary for a report |

### 闹闹 tools (chat-sessions)

闹闹 (Notty) chat sessions expose tools beyond basic chat:
- **NewLore**: `start_newlore_supplement` (non-blocking), `get_newlore_status`, `list/get/delete_newlore_report`; the old `ascan` action/tool names remain compatibility aliases.

### FarView rolling seven-day heat (`/api/farview/*`)

| Endpoint | Purpose |
|---|---|
| `GET /api/farview/overview` | Read the latest cached top-ten ranking for the last seven days |
| `GET /api/farview/topics/:id` | Read one topic with heat, source mix, and representative items |
| `POST /api/farview/refresh` | Start an asynchronous global seven-day heat refresh |
| `GET /api/farview/status` | Read refresh status and the latest generated period |

FarView filters built-in English/Chinese stopwords, source boilerplate, URLs, versions, and pervasive template phrases. Add installation-specific exclusions through `farview_blocked_topics` in the NewLore configuration page.
- **Local files**: `search_files`, `list_files`, `read_file` — structured operations without a shell, restricted to resolved paths under `~/Documents`, `~/Desktop`, and `~/Downloads`
- **Scheduled tasks**: `schedule_task` (cron), `list_scheduled_tasks`, `cancel_scheduled_task` — DB-persisted, auto-restored on server boot via `node-cron`

### Compliance endpoints (both require auth)

### `DELETE /api/account`

Permanently delete all installation-local data: user-owned rows, NewLore history, WeChat
sessions, reports, logs, configuration, and uploaded files. **Irrevocable.**

Response: `204 No Content`.

### `GET /api/export`

Streams a zip with the caller's full data export:

- `noteone-export.json` — notes, tags, note-tag links, chats, daily reports, scheduled
  tasks, NewLore deduplication history, and user settings. Secrets are excluded by default.
- `uploads/<uuid>.<ext>` — image files referenced by image/mixed notes.
- `newlore-reports/` — generated NewLore HTML, Markdown, and summary files.
- `README.txt` — schema version + export timestamp.

Response: `200 application/zip` with a friendly filename.

## MCP

See [MCP.md](./MCP.md) for installing the stdio MCP server into Claude Code, Cursor,
VS Code, Gemini CLI, and Codex. The `create_note` tool accepts an optional `source_app`
argument for capturing user prompts from external AI clients — the note keeps
`contentType=text` and gets `#prompt` + `#{source_app}` format tags attached server-side,
so read paths (`list_notes` / `get_note` / `search_notes`) need no special handling.
