# NoteOne · 壹识

[中文](README.md) · [English](README.en.md) · [License](#license)

## TL;DR

**Capture once. Reuse it from any AI, with provenance intact.**

NoteOne is a local-first personal context library for AI. It captures text, links, and images on macOS and iOS; preserves the original material, author, source, and time; creates summaries, tags, and semantic indexes; and makes the result available through in-app search, Notty, and MCP.

The macOS package embeds its Node.js service and PGlite database, so it needs no separate backend. NoteOne does not bundle an LLM: notes remain usable without an API key, while AI-dependent steps are explicitly skipped.

## Introduction

Most note-taking tools preserve information but leave organization, review, and rediscovery to the user. Ordinary AI chats only see temporary conversation context. NoteOne connects both sides in one local workflow: low-friction capture, asynchronous organization, retrieval with provenance, and reuse from any AI.

The product follows one primary workflow:

- **Capture:** receive material through shortcuts, system sharing, drag-and-drop, or MCP.
- **Contextualize:** preserve originals and provenance, then create summaries, tags, and semantic indexes.
- **Retrieve and cite:** find material by topic, copy it with provenance, or continue with Notty and external AI clients.
- **Optional sources:** NewLore collects public information, while FarView provides a seven-day trend view.

## What NoteOne Adds

| Area | What it does |
|---|---|
| **Capture** | Saves text, URLs, selections, and clipboard images through a macOS global shortcut, iOS Share Extension, and drag-and-drop |
| **Quiet AI organization** | Fetches source content, creates titles and summaries, applies format/topic/domain/module tags, and writes embeddings asynchronously |
| **Personal context library** | Provides Today, Library, hybrid search, processing states, and copy-with-citation actions |
| **Context assistant** | Notty reads the source material before retrieving, comparing, summarizing, and producing cited output |
| **NewLore daily** | Runs five information modules concurrently and produces TOC-navigated HTML and Markdown reports after LLM filtering and translation |
| **FarView trends** | Removes generic noise and shows seven-day topic heat, source composition, and representative items |
| **MCP server** | Lets Claude, Cursor, Codex, and other clients search, read, create, update, and manage notes |
| **Data control** | Offers complete ZIP export, secret exclusion by default, a 30-day trash, and full local-data deletion |

## How It Works

```text
                         NoteOne client (SwiftUI)
          Today · Library · Capture · Search · More · Context Assistant
                                  │
                         localhost HTTP + JWT
                                  │
                  Embedded Express 5 + TypeScript service
       notes · tags · search · chat · reports · scheduler · MCP
                     │                         │
          Async AI organization          NewLore five-module pipeline
       fetch → summarize → tag → embed   arXiv · GitHub · official · blog · conference
                     │                         │
                     └──────────┬──────────────┘
                                │
                  PGlite (embedded) / PostgreSQL 16
```

The macOS app starts the embedded service and calls `/auth/local` to create or reuse one local data owner. Desktop data lives in PGlite under `~/Library/Application Support/NoteOne`; development and self-hosted deployments can use PostgreSQL 16 with pgvector.

See [Architecture](docs/ARCHITECTURE.md) for the detailed design.

## Getting Started

### Requirements

- Apple Silicon Mac
- macOS 14 or newer
- Xcode 16, Swift 6, and XcodeGen when building from source

### Install with Homebrew

```bash
brew tap TobyChain/tap https://github.com/TobyChain/homebrew-tap.git
brew install --cask noteone
```

Open `/Applications/NoteOne.app`. Because the current DMG is ad-hoc signed rather than notarized, the first launch may require **System Settings → Privacy & Security → Open Anyway**.

Update:

```bash
brew update
brew upgrade --cask noteone
```

Uninstall the app:

```bash
brew uninstall --cask noteone
```

Uninstalling does not remove data from `~/Library/Application Support/NoteOne`.

### Install from DMG

Download the latest `NoteOne.dmg` from [GitHub Releases](https://github.com/TobyChain/noteone/releases) and drag the app into Applications. Updating replaces only the app bundle; it does not overwrite the external data directory.

## Configure and Use

### Configure an LLM

Open **Settings → AI Model** and enter an OpenAI-compatible endpoint:

| Field | Example |
|---|---|
| API Key | An OpenAI, DashScope, or self-hosted service key |
| Base URL | `https://api.openai.com/v1` |
| Model | `gpt-4o-mini`, `qwen-turbo`, or another compatible model |

Provide the version-level Base URL; NoteOne appends `/chat/completions` and `/embeddings`. Without an LLM, capture and basic note management remain available.

### Configure NewLore

Use **Settings → NewLore** to choose enabled modules and configure arXiv categories, GitHub topics, paper limits, conference ranks, and blog sources. Start it in the UI or ask Notty to supplement today's NewLore.

### Connect through MCP

The macOS settings page can install MCP configuration for Claude Code or Cursor. Manual example:

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

The server exposes `list_notes`, `get_note`, `create_note`, `update_note`, `delete_note`, `restore_note`, `search_notes`, and `list_tags`. `create_note` accepts `source_app` and automatically applies `#prompt` and `#{app}` tags.

## Storage and Security

- The embedded service binds to `127.0.0.1`; the app uses an internal JWT for localhost API calls.
- Binding `HOST` to a non-loopback address requires a `NOTEONE_ACCESS_TOKEN` of at least 16 characters.
- Link fetching blocks private, loopback, CGNAT, link-local, and cloud-metadata addresses.
- Uploads use UUID filenames, an extension allowlist, and path-traversal checks.
- Notty exposes structured local file operations rather than a general shell, with resolved paths restricted to `~/Documents`, `~/Desktop`, and `~/Downloads`.
- Exports omit API keys by default and include them only after explicit selection.
- Production rejects a weak `JWT_SECRET`; authentication and API routes use separate rate limits.

## Documentation

| Document | Purpose |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | Runtime components, data model, security boundaries, and migrations |
| [Apple client](apple/README.md) | Xcode project, platform requirements, and client structure |
| [Backend](server/README.md) | Service configuration, API, NewLore pipeline, and data maintenance |
| [Design](docs/design/) | Product goals and early design rationale |
| [History](docs/history/) | Implementation records from completed iterations |

## Development

### Backend and database

Run with Docker:

```bash
git clone https://github.com/TobyChain/noteone.git
cd noteone
cp server/.env.example server/.env

POSTGRES_PASSWORD=your-strong-pwd \
JWT_SECRET=$(openssl rand -hex 24) \
docker compose up -d
```

Run locally:

```bash
cd server
cp .env.example .env
npm install
npm run db:migrate
npm run dev
npm test
```

### Apple client

```bash
cd apple
xcodegen generate
open NoteOne.xcodeproj
```

### Technology

| Layer | Technology |
|---|---|
| Client | SwiftUI, iOS 17, macOS 14, Swift 6 |
| Backend | Node.js, TypeScript, Express 5, Drizzle ORM |
| Database | PGlite (WASM) or PostgreSQL 16 + pgvector |
| AI | OpenAI-compatible chat and embedding APIs |
| Agent interface | MCP stdio server |

## Project Status

NoteOne is a personal open-source project. The macOS distribution is ad-hoc signed, and current release builds target Apple Silicon. Report bugs and improvement requests through GitHub Issues.

## License

NoteOne is licensed under the [Apache License 2.0](LICENSE).
