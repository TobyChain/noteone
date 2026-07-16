# 壹识 · NoteOne

> 问渠那得清如许？为有源头活水来。
> —— 朱熹《观书有感》

壹识是一个以 AI 为内核的个人知识系统。随手捕获所见所闻，AI 静默整理、打标、向量化；写作时让 AI 携你的笔记为引用，从容落笔；新知引擎每日扫遍 arXiv、GitHub、官方博客与独立笔耕，汇成一份科技前沿日报。MCP 协议让 Claude、Cursor 等外部 AI 直连你的笔记库，如遇故人。

[中文](#中文) · [English](#english) · [License](#license)

---

## 中文

### 核心功能

> 随风潜入夜，润物细无声。
> —— 杜甫《春夜喜雨》

| 模块 | 能力 |
|---|---|
| **顺手捕获** | macOS 全局快捷键悬浮窗（默认 Cmd+Shift+O）/ iOS Share Extension / 拖拽。自动抓取浏览器 URL 与标题、选中文本、剪贴板图片 |
| **AI 静默整理** | 异步流水线：抓链接正文，生成标题与一句话摘要，四维度打标（format/topic/domain/module），1536 维向量入库 |
| **往事（笔记）** | 时间分组列表，语义搜索，标签筛选。每条笔记附 AI 摘要、来源、作者、标签胶囊 |
| **记实（写作）** | Obsidian 风格的本地 .md 编辑器（macOS 三栏内联，iOS 独立页）；编辑/预览/并排切换；自动保存至 ~/Documents/NoteOne/ |
| **Notty 写作助手** | 看见你的整篇文档和当前选区，可执行四种结构化操作：插入到光标 / 替换选中 / 追加末尾 / 整篇重写；可在过程中检索笔记和联网取材 |
| **新知（Ascan）** | 每日自动运行 Python pipeline，抓取 arXiv 论文、GitHub 热门项目、官方研究动态、独立博客、会议论文、微信公众号，LLM 筛选翻译，生成带大纲导航的 HTML 日报 |
| **Notty 多轮对话** | 三层上下文管理（token 预算裁剪、渐进式摘要、保护区）、doom-loop 检测、工具调用持久化、Markdown 渲染 |
| **MCP Server** | 让 Claude / Cursor / Codex 等 AI 直连笔记数据库：检索、读取、创建、更新、软删、恢复 |
| **每日报告** | Notty 读取当天笔记，联网检索关键词，抓取扩展知识，生成四种风格 x 三种深度的 HTML 报告 |
| **数据主权** | 完整 ZIP 导出（笔记/标签/对话/图片）；级联硬删账户；垃圾箱 30 天自动清理 |

### 架构

> 横看成岭侧成峰，远近高低各不同。
> —— 苏轼《题西林壁》

```
                          壹识 NoteOne
  ┌──────────────────────────────────────────────────────────────┐
  │                        客户端 (SwiftUI)                        │
  │                                                               │
  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
  │  │  往事    │  │  记一条  │  │  Notty   │  │  记实    │     │
  │  │  笔记    │  │  捕获    │  │  对话    │  │  写作    │     │
  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘     │
  │       │             │             │             │             │
  │  ┌────┴─────────────┴─────────────┴─────────────┴──────┐     │
  │  │  新知 (Ascan) · 报告 · 设置 (壹识/新知 统一配置)      │     │
  │  └─────────────────────────────────────────────────────┘     │
  └────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS (JWT)
  ┌────────────────────────┴──────────────────────────────────────┐
  │                   REST API (Express 5 + TypeScript)            │
  │                                                                │
  │  auth / notes / tags / search / chat-sessions / reports        │
  │  uploads / settings / account / export                         │
  │  ascan (reports / config / trigger / status)                   │
  │                                                                │
  │  ┌─────────────────────┐  ┌──────────────────────────────┐    │
  │  │  异步 AI 流水线      │  │  上下文管理器                 │    │
  │  │  抓取 > 打标 > 摘要  │  │  token 裁剪 / 渐进摘要       │    │
  │  │  > 向量化            │  │  doom-loop 检测              │    │
  │  └─────────────────────┘  └──────────────────────────────┘    │
  │                                                                │
  │  PostgreSQL 16 + pgvector          新知 Python Pipeline        │
  │  notes / tags / chat / reports     arXiv / GitHub / 博客 ...   │
  └────────────────────────────────────────────────────────────────┘
                           │ stdio (MCP)
  ┌────────────────────────┴──────────────────────────────────────┐
  │  MCP Servers — Claude / Cursor / Codex 直连笔记库              │
  └────────────────────────────────────────────────────────────────┘
```

### 安装

> 工欲善其事，必先利其器。
> —— 《论语·卫灵公》

#### 后端 + 数据库（Docker 推荐）

```bash
git clone https://github.com/TobyChain/noteone.git
cd noteone

cp server/.env.example server/.env
# 至少填 JWT_SECRET（>= 16 位）

POSTGRES_PASSWORD=your-strong-pwd \
JWT_SECRET=$(openssl rand -hex 24) \
docker compose up -d
```

API 监听 `127.0.0.1:3000`，PostgreSQL 仅监听本机。

#### 后端本地开发

```bash
cd server
cp .env.example .env       # 填 DATABASE_URL / JWT_SECRET
npm install
npm run db:migrate         # 应用迁移（需先建库 + 启用 pgvector 扩展）
npm run dev                # 默认 :3000
npm test                   # Vitest
```

可在 `.env` 设 `ENABLE_DEV_LOGIN=true`，用 `POST /auth/dev-token` 跳过 Apple 登录（仅非生产生效）。

#### Apple 客户端

```bash
# 需先安装 XcodeGen
cd apple && xcodegen generate
open NoteOne.xcodeproj
```

要求 Xcode 16 / iOS 17 / macOS 14 / Swift 6。

- DEBUG 默认连 `http://localhost:3000`，Release 连 `https://api.noteone.app`，可在设置中修改
- DEBUG 登录页提供开发者快速登录
- macOS 全局快捷键捕获需辅助功能权限

### 使用

#### 配置 LLM

> 巧妇难为无米之炊。
> —— 《古诗源》

壹识是开源项目，不内置 LLM 服务。所有 AI 功能（打标、摘要、Notty 聊天、写作助手、报告、新知日报）需要你自带 API Key。打开「设置 → AI 模型」：

| 字段 | 示例 |
|---|---|
| API Key | 你的 OpenAI / DashScope / 自部署 vLLM 的 key |
| Base URL | `https://dashscope.aliyuncs.com/compatible-mode/v1` 或 `https://api.openai.com/v1` |
| Model | `qwen-turbo` / `gpt-4o-mini` / 任意 OpenAI 兼容模型 |

未配置时笔记仍可正常保存，AI 步骤自动跳过。

#### 新知配置

在「设置 → 新知」中配置科技日报的爬取参数：ArXiv 分类、GitHub topics、论文数量上限、会议等级过滤、博客源、微信公众号 RSS 等。点击「运行」即可触发 pipeline 生成当日日报。

#### MCP 接入

> 海内存知己，天涯若比邻。
> —— 王勃《送杜少府之任蜀州》

macOS 设置中可一键写入 Claude Code / Cursor 配置。手动配置示例（内嵌 MCP，直连 DB）：

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

工具：`list_notes` `get_note` `create_note` `update_note` `delete_note` `restore_note` `search_notes` `list_tags`。`create_note` 接受 `source_app` 入参，会自动打 `#prompt + #{app}` 标签。

### 安全

> 君子以思患而豫防之。
> —— 《周易·既济》

- Apple identityToken 经 jose 对 Apple JWKS 验签
- SSRF 防护：链接抓取过滤私网/回环/CGNAT/链路本地/云元数据
- 速率限制：/auth/* 20 次/15 分；/api/* 300 次/分
- helmet 加固 / 上传 UUID 命名 + 扩展名白名单 / 路径穿越校验
- 多租户隔离：所有查询按 user_id 限定
- 生产环境拒绝弱 JWT_SECRET，ENABLE_DEV_LOGIN 在生产恒不生效

### 仓库结构

```
noteone/
├── apple/                  # iOS + macOS SwiftUI 客户端
│   └── NoteOne/Sources/    #   Models / Views / Services / Theme
├── server/                 # REST API + 内嵌 MCP（Express 5 + TypeScript）
│   ├── src/routes/         #   auth notes tags search chat ascan reports
│   ├── src/services/       #   pipeline llm context-manager ascan-bridge
│   └── src/db/             #   Drizzle schema + client
├── ascan/                  # 新知 Python Pipeline（arXiv/GitHub/博客/会议）
│   ├── src/                #   pipeline / tools / trackers / config
│   ├── docs/               #   生成的 HTML 日报（含大纲导航）
│   └── scripts/            #   launchd 定时任务 / TOC 注入工具
├── mcp-server/             # 独立 MCP（HTTP 代理, 5 只读工具）
├── browser-extension/      # Chrome 扩展（Manifest V3）
├── docker-compose.yml
└── README.md
```

---

## English

### Highlights

> I saw the mountains so enchanting, I suppose the mountains see me the same.
> —— Xin Qiji

NoteOne is an AI-powered personal knowledge system. Capture anything from anywhere; AI silently tags, summarizes, and embeds it. Write with Notty, your AI co-writer that sees your document and can search your notes mid-flight. The Ascan engine scans arXiv, GitHub, official blogs, and conference papers daily, producing a curated tech-frontier report with table-of-contents navigation. MCP protocol lets Claude / Cursor talk directly to your note database.

| Module | Capability |
|---|---|
| Capture | macOS global hotkey, iOS Share Extension, drag-and-drop. Auto-grabs URL, title, selected text, clipboard image |
| AI Pipeline | Async: fetch link content, generate title/summary, 4-dimension tagging, 1536-d embedding |
| Notes (往事) | Time-grouped list, semantic search, tag filter, AI summary cards, tag pills |
| Writer (记实) | Local .md editor, edit/preview/split modes, auto-save, Notty co-writer with 4 structured actions |
| Ascan (新知) | Daily Python pipeline: arXiv, GitHub, official blogs, RSS, conference papers, WeChat. HTML report with TOC outline navigation |
| Notty Chat | Three-layer context management, doom-loop detection, tool call persistence, Markdown rendering |
| MCP | 8 tools for Claude / Cursor / Codex to read/write your notes directly |
| Reports | Notty reads today's notes, web-searches keywords, renders 4 styles x 3 depths HTML report |
| Sovereignty | Full ZIP export, GDPR cascade deletion, 30-day trash auto-purge |

### Quick Start

```bash
git clone https://github.com/TobyChain/noteone.git
cd noteone

cp server/.env.example server/.env
POSTGRES_PASSWORD=your-strong-pwd \
JWT_SECRET=$(openssl rand -hex 24) \
docker compose up -d

cd apple && xcodegen generate && open NoteOne.xcodeproj
```

Then in Settings, paste your API key, base URL, and model. Done.

### Tech Stack

| Layer | Choice |
|-------|--------|
| Client | SwiftUI (iOS 17 / macOS 14, Swift 6 strict concurrency), Sign in with Apple |
| Backend | Node.js + TypeScript, Express 5, Drizzle ORM |
| DB | PostgreSQL 16 + pgvector |
| AI | Any OpenAI-compatible API (chat temp 0.3, text-embedding-3-small 1536-d) |
| Ascan | Python 3.11+, Pydantic, SQLite, loguru |
| MCP | @modelcontextprotocol/sdk (stdio) |
| Auth | Apple Sign In (JWKS-verified) + JWT (30 d) |

### API Surface

All `/api/*` need `Authorization: Bearer <JWT>`.

| Group | Endpoints |
|-------|-----------|
| Auth | `POST /auth/apple`, `POST /auth/dev-token` (dev) |
| Notes | `POST/GET /api/notes`, `GET/PATCH/DELETE /api/notes/:id`, `/restore`, `/permanent`, `/retry`, `/tags`, `GET /api/notes/trash` |
| Tags | `POST/GET /api/tags`, `DELETE /api/tags/:id` |
| Search | `POST /api/search` (pgvector) |
| Notty | `GET/POST /api/chat-sessions`, `GET/DELETE /api/chat-sessions/:id`, `POST /:id/messages`, `POST /:id/writer-messages` |
| Ascan | `GET /api/ascan/reports`, `GET /api/ascan/reports/:date`, `GET/PATCH /api/ascan/config`, `POST /api/ascan/trigger`, `GET /api/ascan/status` |
| Reports | `GET /api/reports`, `POST /api/reports/daily`, `GET/DELETE /api/reports/:id` |
| Misc | `POST /api/uploads/image`, `GET /api/stats`, `GET/PATCH /api/settings`, `GET /api/export`, `DELETE /api/account` |

---

## License

> 落红不是无情物，化作春泥更护花。
> —— 龚自珍《己亥杂诗》

Half-open-source: client, MCP servers, schema, migrations, deploy configs, and Ascan pipeline are open-source. Advanced AI tagging prompts, advanced retrieval, and ops modules are not in scope.
