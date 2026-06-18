# NoteOne · 顺手记一条

> **NoteOne** is an AI-powered personal knowledge system: capture text / images / links from anywhere, let AI silently tag, summarize, and embed them, then write deep, well-cited articles with Notty (your AI co-writer) and bring your notes into Claude / Cursor via MCP.
>
> 顺手把看到的文本 / 图片 / 链接收进口袋，AI 静默打标、摘要、向量化；写作时让 Claude / Cursor 等 AI 通过 MCP 直连你的笔记；内置本地 Markdown 编辑器和 AI 写作助手，带来源、带引用地复盘与创作。

[English](#english) · [中文](#中文) · [License](#license)

---

## 中文

### ✨ 核心功能

| 模块 | 能力 |
|---|---|
| **顺手捕获** | macOS 全局快捷键悬浮窗（默认 ⌘⇧O）/ iOS Share Extension / 拖拽。自动抓取浏览器 URL+标题、选中文本、剪贴板图片 |
| **AI 静默整理** | 异步流水线：抓链接正文 → 生成标题/一句话摘要 → 四维度打标（format/topic/domain/module）→ 1536 维向量入库 |
| **本地写作模式** | Obsidian 风格的 `.md` 编辑器（macOS 三栏内联，iOS 独立 Tab）；编辑/预览/并排切换；自动保存；右栏可常驻 Notty 写作助手 |
| **Notty 写作助手** | 看见你的整篇文档和当前选区，可执行 4 种结构化操作：插入到光标 / 替换选中 / 追加末尾 / 整篇重写；可在过程中检索笔记和联网取材 |
| **笔记参考** | 写作时左栏笔记列表自动显示「插入引用」按钮，一键插入带摘要、作者、来源的 markdown blockquote |
| **MCP Server** | 让 Claude / Cursor / Codex 等 AI 直连笔记数据库：检索、读取、创建、更新、软删、恢复 |
| **每日报告** | Notty 读取当天笔记 → 联网检索关键词 → 抓取扩展知识 → 生成 4 种风格 × 3 种深度的 HTML 报告 |
| **数据主权** | 完整 ZIP 导出（笔记/标签/对话/图片）；级联硬删账户；垃圾箱 30 天自动清理 |

### 🏗 架构

```
┌──────────────────────── 客户端 ────────────────────────┐
│  iOS App        macOS App        Share Extension       │
│  (SwiftUI)      (SwiftUI)        (iOS 离线入队)         │
│   · 拖拽          · ⌘⇧ 全局快捷键   · 写入 App Group      │
│   · Share Sheet   · 三栏主界面      共享容器，主 App 联网补传│
│   · Notty Tab     · 内联 Markdown 写作 + Notty 写作助手    │
└───────────────┬───────────────────────┬────────────────┘
                │ HTTPS (JWT)            │ stdio
                ▼                        ▼
┌──────────── REST API (server/) ──────┐  ┌─ MCP Servers ─────────┐
│ Express 5 + Drizzle ORM              │  │ server/src/mcp.ts      │
│  auth / notes / tags / search        │◄─┤  (直连 DB, 7 工具)      │
│  chat-sessions / writer-messages     │  │ mcp-server/            │
│  uploads / settings / account / export│  │  (HTTP 代理, 5 只读工具) │
│            │                         │  └────────────────────────┘
│            ▼  异步流水线               │
│  抓取链接正文 → 打标 → 摘要/标题 → 向量  │
│            │                         │
│            ▼                         │
│  PostgreSQL 16 + pgvector            │
│  notes / tags / chat / reports       │
│            │                         │
│            ▼                         │
│  LLM (任意 OpenAI 兼容 API,自带 Key) │
└──────────────────────────────────────┘
```

### 🚀 安装

#### 后端 + 数据库（推荐 Docker）

```bash
git clone https://github.com/TobyChain/noteone.git
cd noteone

cp server/.env.example server/.env
# 至少填 JWT_SECRET（≥16 位）

POSTGRES_PASSWORD=your-strong-pwd \
JWT_SECRET=$(openssl rand -hex 24) \
docker compose up -d
```

API 监听 `127.0.0.1:3000`，PostgreSQL 仅监听本机 `127.0.0.1:5432`。

#### 后端本地开发

```bash
cd server
cp .env.example .env       # 填 DATABASE_URL / JWT_SECRET
npm install
npm run db:migrate         # 应用迁移（需先建库 + 启用 pgvector 扩展）
npm run dev                # 默认 :3000
npm test                   # Vitest（集成用例需 TEST_DATABASE_URL）
```

可在 `.env` 设 `ENABLE_DEV_LOGIN=true`，用 `POST /auth/dev-token` 跳过 Apple 登录（仅非生产生效）。

#### Apple 客户端

```bash
open apple/NoteOne.xcodeproj
```

要求 **Xcode 16 / iOS 17 / macOS 14 / Swift 6**。

- DEBUG 默认连 `http://localhost:3000`，Release 连 `https://api.noteone.app`，可在「设置 → 服务器」修改
- DEBUG 登录页提供「开发者快速登录」
- macOS 选中文本捕获需「辅助功能」权限（首次会弹）

### 📖 使用

#### 1. 配置 LLM（必填）

NoteOne 是开源项目，**不内置 LLM 服务**，所有 AI 功能（自动打标、摘要、Notty 聊天、写作助手、报告）需要你自带 API Key。打开「设置 → AI 模型」：

| 字段 | 示例 |
|---|---|
| API Key | 你的 OpenAI / DashScope / 自部署 vLLM 的 key |
| Base URL | `https://dashscope.aliyuncs.com/compatible-mode/v1` 或 `https://api.openai.com/v1` |
| Model | `qwen-turbo` / `gpt-4o-mini` / 任意 OpenAI 兼容模型 |

未配置时笔记仍可正常保存，AI 步骤会自动跳过。

#### 2. 顺手记一条

- **macOS**: 默认 `⌘⇧O` 唤起悬浮窗（菜单中可改快捷键）。会自动抓取前台浏览器 URL+标题、选中文本、剪贴板图片
- **iOS**: 在任意 App 里点「分享 → NoteOne」一步入档，离线时入队，下次联网自动补传
- **拖拽**: iOS 把内容拖到 NoteOne / macOS 拖入主窗口都会唤起捕获页

笔记保存后会自动进入 AI 流水线（抓链接正文 → 打标 → 摘要 → 向量）。

#### 3. 主界面（macOS）

```
┌─────────────────────────────────────────────────────────────┐
│ 写作文件 (md)             │                       │ Notty   │
│  ├ 周末灵感整理           │   笔记详情 / Markdown │ 写作助手 │
│  ├ 2026-06 思考           │   编辑器             │  ▌      │
├──────────────────────────┤   (自动切换)         │ 让我帮你 │
│ 笔记                      │                       │ 续写… │
│  🔎 搜索  🎯 类型筛选      │                       │         │
│  · 今天 · 昨天 · 本月      │                       │         │
│  ↪ 插入引用 (写作中可见)   │                       │         │
└─────────────────────────────────────────────────────────────┘
```

- 点笔记 → 中间显示笔记详情
- 点 md 文件 → 中间变成 Markdown 编辑器，右侧 Notty 自动切换为「写作助手」模式
- 写作时左栏笔记每条多一个 ↪️ 按钮，点击直接插入 markdown 引用块到光标处

#### 4. Notty 写作助手

写作页打开时，右栏 Notty 会自动看到你的整篇文档和当前选区。试试这些指令：

- 「帮我把第二段改得更专业一些」（替换选中段落）
- 「在光标处续写一段对照案例」（光标处插入）
- 「在文末加上参考文献」（追加到末尾）
- 「先帮我搜一下笔记里关于 RAG 的，再用一段话总结」（先 search_notes 再 insert）

整篇重写会要求二次确认。

#### 5. MCP 接入（让 Claude / Cursor 直连笔记）

macOS「设置 → MCP 一键安装」可以一键写入 Claude Code / Cursor 配置。手动配置示例（内嵌 MCP，直连 DB）：

```jsonc
{
  "mcpServers": {
    "noteone": {
      "command": "npx",
      "args": ["tsx", "src/mcp.ts"],
      "cwd": "/path/to/noteone/server",
      "env": {
        "DATABASE_URL": "postgresql://...",
        "MCP_USER_ID": "<你的用户 UUID>",
        "QWEN_API_KEY": "...",
        "QWEN_BASE_URL": "...",
        "QWEN_MODEL": "..."
      }
    }
  }
}
```

工具：`list_notes` `get_note` `create_note` `update_note` `delete_note` `restore_note` `search_notes` `list_tags`。`create_note` 接受 `source_app` 入参，会自动打 `#prompt + #{app}` 标签——可把 Claude / Cursor 的对话沉淀为笔记。

### 🔒 安全

- Apple `identityToken` 经 jose 对 Apple JWKS 验签
- SSRF 防护：链接抓取过滤私网/回环/CGNAT/链路本地/云元数据，逐跳重定向校验
- `/auth/*` 20 次/15 分；`/api/*` 300 次/分
- helmet 加固 / 上传 UUID 命名 + 扩展名白名单 / 路径穿越校验
- 多租户隔离：所有查询按 `user_id` 限定
- 生产环境拒绝弱 `JWT_SECRET`，`ENABLE_DEV_LOGIN` 在生产恒不生效

### 📂 仓库结构

```
noteone/
├── apple/                  # iOS + macOS SwiftUI 客户端
│   ├── NoteOne/Sources/    #   Models / Views / Services / macOS / Theme
│   └── NoteOneShareExtension/  # iOS 分享扩展
├── server/                 # REST API + 内嵌 MCP（Node.js + TS + Express 5）
│   ├── src/routes/         #   auth notes tags search chat reports …
│   ├── src/services/       #   pipeline enrichment tagging llm web-fetch
│   ├── src/middleware/     #   auth logger
│   ├── src/db/             #   Drizzle schema + client
│   └── src/mcp.ts          #   内嵌 MCP（直连 DB, 7 工具）
├── mcp-server/             # 独立 MCP（HTTP 代理 REST API, 5 只读工具）
├── docs/                   # 设计文档 / 架构文档 / 迭代记录
├── docker-compose.yml
└── README.md
```

---

## English

### ✨ Highlights

- **Hands-free capture** — macOS global hotkey (default ⌘⇧O) and iOS Share Extension. Grabs browser URL + title, selected text, clipboard image, and even DnD targets in one step.
- **Silent AI organization** — async pipeline fetches the linked article, generates a 30-char title and 100-char summary, tags it across four dimensions, and writes a 1536-d embedding for semantic search.
- **Local Markdown writer** — Obsidian-style `.md` editor lives at `~/Documents/NoteOne/`, never synced to the server. Edit / preview / split-pane modes with auto-save.
- **Notty co-writer** — sees your whole document + current selection, and can `insert_text` / `replace_selection` / `append_text` / `rewrite_document`. It can also search your notes or fetch web pages mid-flight to ground its writing.
- **Notes-as-references in writer** — when you're editing a markdown file, every note in the sidebar shows an "insert citation" button that drops a clean markdown blockquote (title + summary + author/source) at the caret.
- **MCP for external AIs** — let Claude / Cursor / Codex talk to your notes through `@modelcontextprotocol/sdk`. Eight tools cover read + write + soft-delete + restore.
- **Daily reports** — Notty reads today's notes, web-searches the keywords, fetches related pages, and renders an HTML report in one of four styles (minimal / academic / dashboard / handwritten) × three depths (brief / deep / action).
- **Bring-your-own LLM** — open-source builds ship without a bundled provider. Plug in any OpenAI-compatible endpoint (DashScope, OpenAI, self-hosted vLLM, ...). When unconfigured, AI steps are simply skipped — notes still save fine.
- **Data sovereignty** — full ZIP export (notes / tags / chats / images), GDPR-compliant cascade account deletion, 30-day trash auto-purge.

### 🚀 Quick start

```bash
git clone https://github.com/TobyChain/noteone.git
cd noteone

cp server/.env.example server/.env
POSTGRES_PASSWORD=your-strong-pwd \
JWT_SECRET=$(openssl rand -hex 24) \
docker compose up -d

open apple/NoteOne.xcodeproj   # Xcode 16, iOS 17, macOS 14, Swift 6
```

Then in **Settings → AI Model**, paste your API key, base URL, and model. Done.

### 🧰 Tech stack

| Layer | Choice |
|-------|--------|
| Client | SwiftUI (iOS 17 / macOS 14, Swift 6 strict concurrency), Sign in with Apple |
| Backend | Node.js + TypeScript, Express 5, Drizzle ORM |
| DB | PostgreSQL 16 + pgvector |
| AI | Any OpenAI-compatible API (chat temp 0.3, `text-embedding-3-small` 1536-d) |
| MCP | `@modelcontextprotocol/sdk` (stdio) |
| Auth | Apple Sign In (JWKS-verified) + JWT (30 d) |
| Tests | Vitest + Supertest |

### 🛠 API surface

All `/api/*` need `Authorization: Bearer <JWT>`. `/auth/*` is public but rate-limited.

| Group | Endpoints |
|-------|-----------|
| Auth | `POST /auth/apple`, `POST /auth/dev-token` (dev) |
| Notes | `POST/GET /api/notes`, `GET/PATCH/DELETE /api/notes/:id`, `/restore`, `/permanent`, `/retry`, `/tags`, `GET /api/notes/trash` |
| Tags | `POST/GET /api/tags`, `DELETE /api/tags/:id` |
| Search | `POST /api/search` (pgvector) |
| Notty | `GET/POST /api/chat-sessions`, `GET/DELETE /api/chat-sessions/:id`, `POST /api/chat-sessions/:id/messages`, `POST /api/chat-sessions/:id/writer-messages` |
| Reports | `GET /api/reports`, `POST /api/reports/daily`, `GET/DELETE /api/reports/:id` |
| Misc | `POST /api/uploads/image`, `GET /api/stats`, `GET/PATCH /api/settings`, `GET /api/export`, `DELETE /api/account` |

### 🔍 Architecture details

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full data model, async pipeline, security posture, and MCP tool surface.

---

## License

See [LICENSE](LICENSE). Half-open-source: client / MCP servers / schema / migrations / deploy configs are open-source. Advanced AI tagging prompts, advanced retrieval, and ops modules are not in scope. /
半开源策略：客户端、MCP Server、Schema/迁移、部署配置开源；AI 打标 Prompt 工程、高级检索、运营模块不在开源范围。
