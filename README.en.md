# NoteOne · 壹识

> I saw the mountains so enchanting, I suppose the mountains see me the same.
> —— Xin Qiji

NoteOne is an AI-powered personal knowledge system.

- **Capture → Organize**: Capture anything, AI silently tags / summarizes / embeds
- **Notty (闹闹)**: Core agent — runs local terminal commands, schedules tasks, orchestrates the NewSee pipeline
- **NewSee (新知)**: Daily scan of arXiv / GitHub / official blogs / conference papers / WeChat, curated HTML report
- **MCP**: Claude / Cursor / Codex talk directly to your note database

[中文](README.md) · [English](README.en.md) · [License](#license)

---

### Highlights

| Module | Capability |
|---|---|
| **Capture** | macOS global hotkey, iOS Share Extension, drag-and-drop. Auto-grabs URL, title, selected text, clipboard image |
| **AI Pipeline** | Async: fetch link → title/summary → 4-dim tagging → 1536-d embedding |
| **OldScene (往事)** | Time-grouped list, semantic search, tag filter, one-tap new note, AI summary cards |
| **Notty (闹闹)** | 3-layer context mgmt, doom-loop detection, tool persistence, Markdown. Tools: terminal / cron / NewSee / web / notes |
| **NewSee (新知)** | 6-module daily pipeline (arXiv · GitHub · official · blog · conference · WeChat), TOC-navigated HTML report |
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
  │  │ OldScene │  │  NewSee  │  │ Capture  │  │  Notty   │     │
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
  │  PGlite embedded (WASM) / PostgreSQL 16   NewSee TS Pipeline     │
  │  notes · tags · chat · reports           arXiv · GitHub · blog   │
  │  scheduled_tasks · ascan_*                                       │
  └────────────────────────────────────────────────────────────────┘
                           │ stdio (MCP)
  ┌────────────────────────┴──────────────────────────────────────┐
  │  MCP Servers — Claude / Cursor / Codex direct DB access        │
  └────────────────────────────────────────────────────────────────┘
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

### Quick Start

#### macOS app (recommended)

**Homebrew (recommended):**

```bash
brew tap TobyChain/tap https://github.com/TobyChain/homebrew-tap.git
brew install --cask noteone
```

Update to the latest version:

```bash
brew update && brew upgrade --cask noteone
```

Uninstall:

```bash
brew uninstall --cask noteone
```

> Data is not automatically removed on uninstall (stored in `~/Library/Application Support/NoteOne`). Remove that directory manually to fully clean up.

**DMG download:**

Download the latest `NoteOne.dmg` from [Releases](https://github.com/TobyChain/noteone/releases), drag to Applications, and double-click. The app bundles a Node runtime and PGlite database — no external dependencies, auto-migrates on first launch.

> If macOS says "cannot verify the developer", go to System Settings → Privacy & Security and click "Open Anyway" (ad-hoc signed, personal use).

**Homebrew installation notes:**

- **Apple Silicon only (arm64)**: The DMG is built for darwin-arm64; Intel Macs are not currently supported
- **macOS 14+ (Sonoma)**: The app uses SwiftUI 6 + WKWebView system frameworks requiring macOS 14 or later
- **Gatekeeper prompt on first launch**: Due to ad-hoc signing (no Apple Developer certificate), you may see "cannot verify developer" — go to System Settings → Privacy & Security → "Open Anyway"
- **Tap is a separate repo**: `TobyChain/tap` points to `github.com/TobyChain/homebrew-tap`, separate from the main noteone repo — Cask version updates must be pushed to the tap repo
- **Version upgrades**: `brew upgrade` downloads the new DMG and replaces the app binary. Data lives in `~/Library/Application Support/NoteOne`, separate from the app, so upgrades are non-destructive
- **Migrating from DMG to Homebrew**: If previously installed via DMG, remove `/Applications/NoteOne.app` first, then `brew install --cask noteone` — your data directory is unaffected

#### Backend + database (Docker)

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

No registration or login is required. The app starts its localhost service first, then calls `POST /auth/local` to open the installation's single local data space. The returned JWT only protects internal calls between the app and its localhost service. Notes, tags, chats, and settings persist under `~/Library/Application Support/NoteOne`.

#### Apple client

```bash
# Requires XcodeGen
cd apple && xcodegen generate
open NoteOne.xcodeproj
```

Requires Xcode 16 / iOS 17 / macOS 14 / Swift 6. See [apple/README.md](apple/README.md).

- The macOS app connects to its embedded service at `http://localhost:3000`
- There is no account or login flow; startup opens the local data space automatically
- macOS global hotkey requires Accessibility permission

### Usage

#### Configure LLM

NoteOne is open-source and does not bundle an LLM. All AI features (tagging, summaries, Notty chat, reports, NewSee daily) require your own API key. Open **Settings → AI Model**:

| Field | Example |
|---|---|
| API Key | Your OpenAI / DashScope / self-hosted vLLM key |
| Base URL | `https://api.openai.com/v1` or `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| Model | `qwen-turbo` / `gpt-4o-mini` / any OpenAI-compatible model |

> Base URL should include the version prefix; the system auto-appends `/chat/completions` and `/embeddings`.

Without config, notes still save normally — AI steps are skipped.

#### NewSee config

**Settings → NewSee** configures daily report parameters: arXiv categories, GitHub topics, paper limits, conference rank filter, blog sources, WeChat public accounts. Click "Run" or tell Notty "supplement today's new knowledge" to trigger the pipeline.

WeChat crawling is built into the NoteOne server (`/api/wechat`). Open "Settings → WeChat" to scan the login QR code and manage subscribed accounts — no external service required.

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

- **Local session**: no account is required; the embedded server binds to `127.0.0.1`, and the app opens the internal local data owner after the service becomes healthy. An in-memory JWT protects localhost API calls
- **SSRF guard**: link fetch filters private/loopback/CGNAT/link-local/cloud-metadata
- **Rate limit**: `/auth/*` 20 req/15 min; `/api/*` 300 req/min
- **Data ownership**: queries remain scoped by an internal `user_id`; the desktop app uses one local data owner
- **Upload safety**: UUID naming + extension whitelist + path-traversal guard
- **Production hardening**: weak `JWT_SECRET` rejected
- **Notty terminal**: whitelist commands + restricted dirs (`~/Documents` `~/Desktop` `~/Downloads`) + shell metachar blocking
- **helmet** HTTP headers

### Tech Stack

| Layer | Choice |
|-------|--------|
| Client | SwiftUI (iOS 17 / macOS 14, Swift 6 strict concurrency) |
| Backend | Node.js + TypeScript, Express 5, Drizzle ORM |
| DB | PGlite (WASM, embedded) / PostgreSQL 16 + pgvector |
| AI | Any OpenAI-compatible API (chat temp 0.3, text-embedding-3-small 1536-d) |
| NewSee | TypeScript pipeline (6 modules, in-process) |
| MCP | @modelcontextprotocol/sdk (stdio) |
| Local session | Single local data owner + internal JWT (30 d) |

### API Surface

All `/api/*` need `Authorization: Bearer <JWT>`.

| Group | Endpoints |
|-------|-----------|
| Session | `POST /auth/local` (open local data space) · `POST /auth/dev-token` (development compatibility) |
| Notes | `POST/GET /api/notes` · `GET/PATCH/DELETE /api/notes/:id` · `/restore` · `/permanent` · `/retry` · `/tags` · `GET /api/notes/trash` |
| Tags | `POST/GET /api/tags` · `DELETE /api/tags/:id` |
| Search | `POST /api/search` (pgvector) |
| Notty | `GET/POST /api/chat-sessions` · `GET/DELETE /api/chat-sessions/:id` · `POST /:id/messages` |
| NewSee · Reports | `GET /api/ascan/reports` · `/:date` · `/:date/path` · `DELETE /:date` |
| NewSee · Config | `GET` / `PATCH /api/ascan/config` |
| NewSee · Run | `POST /api/ascan/trigger` · `/run-module` · `/merge` · `/abort` · `GET /status` |
| NewSee · Misc | `GET /api/ascan/wechat-health` · `POST /api/ascan/summarize` |
| Reports | `GET /api/reports` · `POST /api/reports/daily` · `GET/DELETE /api/reports/:id` |
| Misc | `POST /api/uploads/image` · `GET /api/stats` · `GET/PATCH /api/settings` · `GET /api/export` · `DELETE /api/account` |

---

## License

> 落红不是无情物，化作春泥更护花。
> —— 龚自珍《己亥杂诗》

[Apache License 2.0](LICENSE) © 2026 TobyChain

All NoteOne code (client, backend, NewSee pipeline, MCP servers, schema, migrations, deploy configs, browser extension) is open-sourced under Apache 2.0.

Why Apache 2.0 over MIT:
- **Patent protection**: explicit patent grant + retaliation clause
- **No endorsement** (Section 6): no using "NoteOne" / "壹识" / "TobyChain" names to endorse derivatives without written consent
- **Contributor agreement**: PR submission auto-grants patent rights
- **Attribution required**: fork / modify / distribute must retain copyright notice

Allowed: commercial use · modification · distribution · private use · SaaS deployment
Required: retain copyright notice · state changes · no author-name endorsement

"NoteOne" / "壹识" names are reserved trademarks — unauthorized use in derivative promotion is prohibited.
