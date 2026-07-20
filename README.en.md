# NoteOne · 壹识

> I saw the mountains so enchanting, I suppose the mountains see me the same.
> —— Xin Qiji

NoteOne is an AI-powered personal knowledge system.

- **Capture → Organize**: Capture anything, AI silently tags / summarizes / embeds
- **Notty (闹闹)**: Core agent — runs local terminal commands, schedules tasks, orchestrates the Ascan pipeline
- **Ascan (新知)**: Daily scan of arXiv / GitHub / official blogs / conference papers / WeChat, curated HTML report
- **MCP**: Claude / Cursor / Codex talk directly to your note database

[中文](README.md) · [English](README.en.md) · [License](#license)

---

### Highlights

| Module | Capability |
|---|---|
| **Capture** | macOS global hotkey, iOS Share Extension, drag-and-drop. Auto-grabs URL, title, selected text, clipboard image |
| **AI Pipeline** | Async: fetch link → title/summary → 4-dim tagging → 1536-d embedding |
| **Notes (往事)** | Time-grouped list, semantic search, tag filter, one-tap new note, AI summary cards |
| **Notty (闹闹)** | 3-layer context mgmt, doom-loop detection, tool persistence, Markdown. Tools: terminal / cron / Ascan / web / notes |
| **Ascan (新知)** | 6-module daily pipeline (arXiv · GitHub · official · blog · conference · WeChat), TOC-navigated HTML report |
| **Scheduled Tasks** | Natural-language cron via Notty, DB-persisted, auto-restored on boot |
| **MCP** | 8 tools for Claude / Cursor / Codex to read/write notes |
| **Reports** | Notty reads today's notes → web search → 4 styles × 3 depths HTML report |
| **Sovereignty** | ZIP export · cascade deletion · 30-day trash auto-purge |

### Architecture

```
                          NoteOne · 壹识
  ┌──────────────────────────────────────────────────────────────┐
  │                        Client (SwiftUI)                        │
  │                                                               │
  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
  │  │  Notes   │  │  Ascan   │  │ Capture  │  │  Notty   │     │
  │  │  往事     │  │  新知     │  │  记一条   │  │  闹闹     │     │
  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘     │
  │       └─────────────┴─────────────┴─────────────┘            │
  │                  Settings · Reports · Trash                    │
  └────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS (JWT)
  ┌────────────────────────┴──────────────────────────────────────┐
  │                   REST API (Express 5 + TypeScript)            │
  │                                                                │
  │  auth · notes · tags · search · chat-sessions · reports        │
  │  uploads · settings · account · export                         │
  │  ascan (reports / config / run-module / merge / status)        │
  │  sidecar (scheduler · local-tools)                             │
  │                                                                │
  │  ┌─────────────────────┐  ┌──────────────────────────────┐    │
  │  │  Async AI Pipeline  │  │  Notty Context Manager        │    │
  │  │  fetch → tag → sum  │  │  token trim · compaction      │    │
  │  │  → embed            │  │  doom-loop detection           │    │
  │  └─────────────────────┘  └──────────────────────────────┘    │
  │                                                                │
  │  PostgreSQL 16 + pgvector          Ascan Python Pipeline       │
  │  notes · tags · chat · reports     arXiv · GitHub · blog ...   │
  │  scheduled_tasks                                                  │
  └────────────────────────────────────────────────────────────────┘
                           │ stdio (MCP)
  ┌────────────────────────┴──────────────────────────────────────┐
  │  MCP Servers — Claude / Cursor / Codex direct DB access        │
  └────────────────────────────────────────────────────────────────┘
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

### Quick Start

```bash
git clone https://github.com/TobyChain/noteone.git
cd noteone

cp server/.env.example server/.env
# At minimum, set JWT_SECRET (>= 16 chars)

POSTGRES_PASSWORD=your-strong-pwd \
JWT_SECRET=$(openssl rand -hex 24) \
docker compose up -d
```

API listens on `127.0.0.1:3000`, Postgres on localhost only.

#### Local dev (no Docker)

```bash
cd server
cp .env.example .env       # Fill DATABASE_URL / JWT_SECRET
npm install
npm run db:migrate         # Apply migrations (requires DB + pgvector extension)
npm run dev                # Default :3000
npm test                   # Vitest
```

Set `ENABLE_DEV_LOGIN=true` in `.env` to use `POST /auth/dev-token` (bypasses Apple Sign In, dev-only).

#### Apple client

```bash
# Requires XcodeGen
cd apple && xcodegen generate
open NoteOne.xcodeproj
```

Requires Xcode 16 / iOS 17 / macOS 14 / Swift 6. See [apple/README.md](apple/README.md).

- DEBUG defaults to `http://localhost:3000`, Release to `https://api.noteone.app`
- DEBUG login page offers dev quick-login
- macOS global hotkey requires Accessibility permission

### Usage

#### Configure LLM

NoteOne is open-source and does not bundle an LLM. All AI features (tagging, summaries, Notty chat, reports, Ascan daily) require your own API key. Open **Settings → AI Model**:

| Field | Example |
|---|---|
| API Key | Your OpenAI / DashScope / self-hosted vLLM key |
| Base URL | `https://api.openai.com/v1` or `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| Model | `qwen-turbo` / `gpt-4o-mini` / any OpenAI-compatible model |

> Base URL should include the version prefix; the system auto-appends `/chat/completions` and `/embeddings`.

Without config, notes still save normally — AI steps are skipped.

#### Ascan config

**Settings → Ascan** configures daily report parameters: arXiv categories, GitHub topics, paper limits, conference rank filter, blog sources, WeChat public accounts. Click "Run" or tell Notty "supplement today's new knowledge" to trigger the pipeline.

WeChat crawling uses [wechat-article-exporter](https://github.com/wechat-article/wechat-article-exporter) (native Node.js, no Docker required). See [docs/wechat-wae-setup.md](docs/wechat-wae-setup.md).

#### MCP integration

macOS settings can one-click install into Claude Code / Cursor. Manual config (embedded MCP, direct DB):

```jsonc
{
  "mcpServers": {
    "noteone": {
      "command": "npx",
      "args": ["tsx", "src/mcp.ts"],
      "cwd": "/path/to/noteone/server",
      "env": {
        "DATABASE_URL": "postgresql://...",
        "MCP_USER_ID": "<your user UUID>",
        "QWEN_API_KEY": "...",
        "QWEN_BASE_URL": "...",
        "QWEN_MODEL": "..."
      }
    }
  }
}
```

Tools: `list_notes` · `get_note` · `create_note` · `update_note` · `delete_note` · `restore_note` · `search_notes` · `list_tags`. `create_note` accepts `source_app` and auto-tags `#prompt + #{app}`.

### Security

- **Auth**: Apple identityToken verified via jose against Apple JWKS; JWT 30 days
- **SSRF guard**: link fetch filters private/loopback/CGNAT/link-local/cloud-metadata
- **Rate limit**: `/auth/*` 20 req/15 min; `/api/*` 300 req/min
- **Multi-tenant**: all queries scoped by `user_id`
- **Upload safety**: UUID naming + extension whitelist + path-traversal guard
- **Production hardening**: weak `JWT_SECRET` rejected; `ENABLE_DEV_LOGIN` never effective in production
- **Notty terminal**: whitelist commands + restricted dirs (`~/Documents` `~/Desktop` `~/Downloads`) + shell metachar blocking
- **helmet** HTTP headers

### Tech Stack

| Layer | Choice |
|-------|--------|
| Client | SwiftUI (iOS 17 / macOS 14, Swift 6 strict concurrency), Sign in with Apple |
| Backend | Node.js + TypeScript, Express 5, Drizzle ORM |
| DB | PostgreSQL 16 + pgvector |
| AI | Any OpenAI-compatible API (chat temp 0.3, text-embedding-3-small 1536-d) |
| Ascan | Python 3.11+, Pydantic, SQLAlchemy, loguru |
| MCP | @modelcontextprotocol/sdk (stdio) |
| Auth | Apple Sign In (JWKS-verified) + JWT (30 d) |

### API Surface

All `/api/*` need `Authorization: Bearer <JWT>`.

| Group | Endpoints |
|-------|-----------|
| Auth | `POST /auth/apple` · `POST /auth/dev-token` (dev) |
| Notes | `POST/GET /api/notes` · `GET/PATCH/DELETE /api/notes/:id` · `/restore` · `/permanent` · `/retry` · `/tags` · `GET /api/notes/trash` |
| Tags | `POST/GET /api/tags` · `DELETE /api/tags/:id` |
| Search | `POST /api/search` (pgvector) |
| Notty | `GET/POST /api/chat-sessions` · `GET/DELETE /api/chat-sessions/:id` · `POST /:id/messages` |
| Ascan · Reports | `GET /api/ascan/reports` · `/:date` · `/:date/path` · `DELETE /:date` |
| Ascan · Config | `GET` / `PATCH /api/ascan/config` |
| Ascan · Run | `POST /api/ascan/trigger` · `/run-module` · `/merge` · `/abort` · `GET /status` |
| Ascan · Misc | `GET /api/ascan/wechat-health` · `POST /api/ascan/summarize` |
| Reports | `GET /api/reports` · `POST /api/reports/daily` · `GET/DELETE /api/reports/:id` |
| Misc | `POST /api/uploads/image` · `GET /api/stats` · `GET/PATCH /api/settings` · `GET /api/export` · `DELETE /api/account` |

---

## License

> 落红不是无情物，化作春泥更护花。
> —— 龚自珍《己亥杂诗》

[Apache License 2.0](LICENSE) © 2026 TobyChain

All NoteOne code (client, backend, Ascan pipeline, MCP servers, schema, migrations, deploy configs, browser extension) is open-sourced under Apache 2.0.

Why Apache 2.0 over MIT:
- **Patent protection**: explicit patent grant + retaliation clause
- **No endorsement** (Section 6): no using "NoteOne" / "壹识" / "TobyChain" names to endorse derivatives without written consent
- **Contributor agreement**: PR submission auto-grants patent rights
- **Attribution required**: fork / modify / distribute must retain copyright notice

Allowed: commercial use · modification · distribution · private use · SaaS deployment
Required: retain copyright notice · state changes · no author-name endorsement

"NoteOne" / "壹识" names are reserved trademarks — unauthorized use in derivative promotion is prohibited.
