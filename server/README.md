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
| `APPLE_CLIENT_IDS` | Comma list of bundle ids accepted as the audience of Apple identityTokens |
| `ENABLE_DEV_LOGIN` | `true` enables `POST /auth/dev-token` (never in production) |
| `ALLOWED_ORIGINS` | Comma list of origins for the CORS allow-list |
| `QWEN_API_KEY` / `QWEN_BASE_URL` / `QWEN_MODEL` | Default LLM credentials; users can override per account via `/api/settings` |

## Tests

The test suite mixes deterministic unit tests (no external dependency) with optional
integration tests that require a real Postgres + pgvector.

```bash
# Unit tests only — always works
npm run test:run

# With the integration suite (requires a Postgres + pgvector test DB you can wipe)
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/noteone_test \
  npm run db:migrate && npm run test:integration
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
- `routes/auth.test.ts` — Apple JWKS verification (signature/iss/aud), `dev-token` gate
- `routes/integration.test.ts` (skips without `TEST_DATABASE_URL`) — tag tenant isolation,
  account cascade + file cleanup, export contents

## API

In addition to notes / tags / search / chat-sessions / settings / uploads, the server
exposes:

### Ascan pipeline (`/api/ascan/*`)

The Ascan Python pipeline runs as a child process spawned via `child_process.spawn`.
The server reads/writes its config in `ascan/.env` and tracks run status in-memory.

| Endpoint | Purpose |
|----------|---------|
| `GET /api/ascan/reports` · `/:date` · `/:date/path` | List / read / get file path for daily reports |
| `DELETE /api/ascan/reports/:date` | Delete a daily report (+ sidecar files) |
| `GET` / `PATCH /api/ascan/config` | Read / update ascan config (writes to `ascan/.env`) |
| `POST /api/ascan/trigger` | Fire-and-forget full pipeline run |
| `POST /api/ascan/run-module` | Run a single module (blocking, for 闹闹 orchestration) |
| `POST /api/ascan/merge` | Merge already-run module fragments into a report |
| `POST /api/ascan/abort` | Abort a running pipeline (kills pid) |
| `GET /api/ascan/status` | Check run status + recent log lines |
| `GET /api/ascan/wechat-health` | Probe the configured WAE (wechat-article-exporter) service |
| `POST /api/ascan/summarize` | Generate LLM one-sentence summary for a report |

### 闹闹 tools (chat-sessions)

闹闹 (Notty) chat sessions expose tools beyond basic chat:
- **Ascan**: `start_ascan_supplement` (non-blocking), `get_ascan_status`, `list/get/delete_ascan_report`
- **Local terminal**: `run_command` (whitelist: grep/find/ls/cat/wc/head/tail/stat/file/diff/which/echo + more), `search_files`, `list_files`, `read_file` — restricted to `~/Documents` `~/Desktop` `~/Downloads`, blocks shell metacharacters
- **Scheduled tasks**: `schedule_task` (cron), `list_scheduled_tasks`, `cancel_scheduled_task` — DB-persisted, auto-restored on server boot via `node-cron`

### Compliance endpoints (both require auth)

### `DELETE /api/account`

Permanently delete the authenticated user and all dependent rows (notes, tags, chat
sessions, chat messages, note-tag links). Image and mixed notes' uploaded files are
removed from disk. **Irrevocable.** Required by Apple App Review 5.1.1(v) and GDPR.

Response: `204 No Content`.

### `GET /api/export`

Streams a zip with the caller's full data export:

- `noteone-export.json` — notes, tags, note-tag links, chat sessions + messages,
  user profile (apiKey stripped from settings).
- `uploads/<uuid>.<ext>` — image files referenced by image/mixed notes.
- `README.txt` — schema version + export timestamp.

Response: `200 application/zip` with a friendly filename.

## MCP

See [MCP.md](./MCP.md) for installing the stdio MCP server into Claude Code, Cursor,
VS Code, Gemini CLI, and Codex. The `create_note` tool accepts an optional `source_app`
argument for capturing user prompts from external AI clients — the note keeps
`contentType=text` and gets `#prompt` + `#{source_app}` format tags attached server-side,
so read paths (`list_notes` / `get_note` / `search_notes`) need no special handling.
