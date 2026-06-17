# NoteOne · 顺手记一条

> 顺手把看到的文本 / 图片 / 链接收进口袋，AI 静默打标、摘要、向量化；写作时让 Claude / Cursor 等 AI 通过 MCP 直连你的笔记，带来源、带引用地复盘与创作。

NoteOne 是一个**多端碎片捕获 + AI 静默整理 + MCP 深度复用**的个人知识系统：

- **顺手捕获**：iOS Share Extension / 拖拽、macOS 全局快捷键悬浮窗，一步入档文本、图片、链接，自动带上来源、作者、页面 meta。
- **静默整理**：后端异步流水线自动抓取链接正文、生成标题与一句话摘要、四维度打标、生成向量。
- **深度复用**：内置 AI 助手 **Notty**（带工具调用），以及对外的 **MCP Server**，让外部 AI 客户端直接检索、读取、创建笔记。

---

## 目录

- [整体架构](#整体架构)
- [核心功能](#核心功能)
- [仓库结构](#仓库结构)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [MCP 接入](#mcp-接入)
- [API 一览](#api-一览)
- [安全设计](#安全设计)
- [文档索引](#文档索引)

> 更详细的实现现状见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)；产品设计与决策记录见 [docs/design/2026-06-08-noteone-design.md](docs/design/2026-06-08-noteone-design.md)。

---

## 整体架构

```
┌──────────────────────── 客户端 ────────────────────────┐
│  iOS App        macOS App        Share Extension        │
│  (SwiftUI)      (SwiftUI)        (iOS 离线入队)          │
│   · 拖拽          · ⌘⇧ 全局快捷键   · 写入 App Group       │
│   · Share Sheet   · 悬浮捕获窗      共享容器,主 App 联网补传 │
│   · Notty Tab     · Notty Sheet                          │
└───────────────┬───────────────────────┬─────────────────┘
                │ HTTPS (JWT)            │ stdio
                ▼                        ▼
┌──────────── REST API (server/) ──────┐  ┌─ MCP Servers ─────────┐
│ Express 5 + Drizzle ORM              │  │ server/src/mcp.ts      │
│  auth / notes / tags / search        │◄─┤  (直连 DB,7 工具,本机)  │
│  chat-sessions / uploads / stats     │  │ mcp-server/            │
│  settings / account / export         │  │  (HTTP 代理,5 工具,外接) │
│            │                         │  └────────────────────────┘
│            ▼  异步流水线               │
│  抓取链接正文 → 打标 → 摘要/标题 → 向量  │
│            │                         │
│            ▼                         │
│  PostgreSQL + pgvector               │
│  notes / tags / note_tags / users    │
│  chat_sessions / chat_messages       │
│            │                         │
│            ▼                         │
│  LLM (OpenAI 兼容 API,默认 DashScope) │
└──────────────────────────────────────┘
```

---

## 核心功能

### 捕获
- **macOS 全局快捷键悬浮窗**：默认 `⌘⇧O`（应用内菜单 `⌘⇧N`），可在设置中自定义。唤起时自动抓取：前台浏览器 URL+标题（Safari / Chromium 系 / Firefox via AppleScript）、选中文本（合成 `⌘C`）、剪贴板图片。
- **iOS Share Extension**：任意 App 分享菜单一步入档；离线写入 App Group 共享容器，主 App 激活时自动补传。
- **iOS 拖拽闭环**：从其他 App 拖内容到 NoteOne（注册了 `CFBundleDocumentTypes` 作为合法落点），也可把笔记 `.draggable` 拖到备忘录/邮件（导出标题+摘要+正文+引用）。
- **剪贴板图片**（macOS）、**多模态**内容类型：`text / image / video / link / mixed`。

### AI 静默整理（异步流水线）
- **链接正文抓取**：检测笔记中的 URL，抓取并清洗正文（去 script/style/nav，HTML 实体解码，截断 15k 字符），提取标题/作者/站点名/发布日期回填（不覆盖用户已填字段）。
- **四维度打标**：`format`（格式）/ `topic`（主题）/ `domain`（领域）/ `module`（模块），带置信度，用户隔离去重。
- **摘要 + 标题**：≤100 字一句话摘要、≤30 字标题（用户未填时才生成）。
- **向量化**：`text-embedding-3-small`（1536 维）写入 pgvector，供语义检索。
- **失败可重试**：抓取失败且正文过短 → 标记 `failed`，客户端「重试」按钮重跑流水线。

### Notty —— 内置 AI 助手
- 持久化会话（`chat_sessions` / `chat_messages`），支持多会话切换、历史压缩（满 30 条自动摘要保留最近 6 条）。
- **工具调用**：`read_note`（按序号/UUID 读全文+引用）、`search_notes`（pgvector 语义检索）、`web_fetch`（带 SSRF 防护抓网页）。
- 客户端：iOS 独立 Tab，macOS 右下角悬浮按钮 → Sheet；笔记处理中显示「Notty 正在细品…」。

### 管理与数据主权
- **垃圾箱**：软删 → 30 天后自动硬删（每小时 cron），可恢复/立即永久删除。
- **数据导出**：`GET /api/export` 打包 ZIP（笔记/标签/会话/图片，剔除 API Key）。
- **账户注销**：`DELETE /api/account` 级联硬删 + 清理上传文件（GDPR / App Store 合规）。
- **个性化**：每用户可配置自定义 LLM（apiKey / baseUrl / model）；主题（跟随系统/浅色/深色）。

---

## 仓库结构

```
noteone/
├── apple/                  # iOS + macOS SwiftUI 客户端（Swift 6,iOS 17 / macOS 14）
│   ├── NoteOne/Sources/    #   Models / Views / Services / macOS / Theme
│   ├── NoteOneShareExtension/  # iOS 分享扩展(离线入队)
│   ├── NoteOne.xcodeproj/  #   实际构建工程
│   ├── Project.swift       #   Tuist 清单(与 project.yml 等价)
│   └── project.yml         #   XcodeGen 清单
├── server/                 # REST API + 内嵌 MCP（Node.js / TypeScript / Express 5）
│   ├── src/routes/         #   auth notes tags search chat chat-sessions uploads settings account export stats
│   ├── src/services/       #   pipeline enrichment tagging llm web-fetch url-guard 等
│   ├── src/db/             #   Drizzle schema + client
│   ├── src/mcp.ts          #   内嵌 MCP(直连 DB,7 工具)
│   └── drizzle/            #   迁移(0000–0004)
├── mcp-server/             # 独立 MCP（HTTP 代理 REST API,5 只读向工具,供外部 AI 接入）
├── docs/                   # 设计文档 / 架构文档 / 迭代记录
├── docker-compose.yml      # pgvector + api 一键部署
└── README.md
```

---

## 技术栈

| 层 | 选型 |
|----|------|
| 客户端 | SwiftUI（iOS 17 / macOS 14，Swift 6 严格并发），Sign in with Apple |
| 后端 | Node.js + TypeScript，Express 5，Drizzle ORM |
| 数据库 | PostgreSQL 16 + pgvector（向量检索 + JSONB 多维标签） |
| AI | OpenAI 兼容 API（默认 DashScope `compatible-mode`），chat 温度 0.3；Embedding `text-embedding-3-small`(1536) |
| MCP | `@modelcontextprotocol/sdk`（stdio） |
| 认证 | Apple Sign In（JWKS 验签） + JWT（30 天） |
| 测试 | Vitest + Supertest（7 个测试文件，含 SSRF/上传/打标/集成） |

> ⚠️ **默认模型说明**：环境变量沿用 `QWEN_*` 命名、`baseUrl` 指向 DashScope，但 `config.ts` 中 `QWEN_MODEL` 的缺省值当前为 `gpt-5.4-mini`（见 [server/src/config.ts](server/src/config.ts)）。Embedding 始终走默认 provider，**不随用户自定义 LLM 切换**，以保证向量空间一致。

---

## 快速开始

### 1. 后端 + 数据库（Docker，推荐）

```bash
cd noteone
cp server/.env.example server/.env   # 至少填 JWT_SECRET(≥16 位) 与 QWEN_API_KEY
# docker-compose 通过环境变量注入 POSTGRES_PASSWORD / JWT_SECRET,二者缺失会 fail-fast
POSTGRES_PASSWORD=xxx JWT_SECRET=$(openssl rand -hex 24) docker compose up -d
```

数据库映射在 `127.0.0.1:5432`（仅本机），API 在 `:3000`。

### 2. 本地开发后端

```bash
cd server
cp .env.example .env       # 填 DATABASE_URL / JWT_SECRET / QWEN_API_KEY
npm install
npm run db:migrate         # 应用 drizzle 迁移(需先建库并启用 pgvector 扩展)
npm run dev                # tsx watch,默认 :3000
npm run test               # Vitest;集成用例需 TEST_DATABASE_URL,缺省自动 skip
```

本地联调可在 `.env` 设 `ENABLE_DEV_LOGIN=true`，用 `POST /auth/dev-token`（仅非生产生效）跳过 Apple 登录。

### 3. Apple 客户端

```bash
open apple/NoteOne.xcodeproj   # 直接用 Xcode 构建工程
```

- DEBUG 构建默认连 `http://localhost:3000`，Release 连 `https://api.noteone.app`，也可在「设置」里改服务器地址。
- DEBUG 登录页提供「开发者快速登录」按钮（走 dev-token）。
- macOS 选中文本捕获需授予「辅助功能」权限（首次会弹系统授权）。

---

## MCP 接入

两套 MCP 实现，用途不同：

| | `server/src/mcp.ts`（内嵌） | `mcp-server/`（独立） |
|---|---|---|
| 连接方式 | **直连数据库** | **HTTP 代理 REST API** |
| 工具数 | 7（含增删改 CRUD） | 5（只读向） |
| 鉴权 | `MCP_USER_ID` 环境变量 | `NOTEONE_TOKEN`（Bearer JWT） |
| 适用 | 本机个人自托管 | 外部 AI 客户端接入 |
| 工具 | `list_notes` `get_note` `create_note` `update_note` `delete_note` `restore_note` `search_notes` `list_tags` | `search_notes` `get_note` `list_tags` `list_notes` `get_topic_summary` |

> `create_note` 支持 `source_app` 入参：传值时会同步打 `#prompt` + `#{规范化的来源应用}` 两个 format 标签，可把 Claude/Cursor 的对话 prompt 沉淀为笔记。

macOS 客户端「设置 → MCP」提供一键安装（写入 `~/.claude/settings.json` 或 `~/.cursor/mcp.json`）。手动配置示例（内嵌 MCP）：

```jsonc
{
  "mcpServers": {
    "noteone": {
      "command": "npx",
      "args": ["tsx", "src/mcp.ts"],
      "cwd": "/path/to/noteone/server",
      "env": { "DATABASE_URL": "...", "MCP_USER_ID": "<你的用户 UUID>", "QWEN_API_KEY": "..." }
    }
  }
}
```

---

## API 一览

所有 `/api/*` 需 `Authorization: Bearer <JWT>`；`/auth/*` 公开但限流。

| 分组 | 端点 |
|------|------|
| Auth | `POST /auth/apple`、`POST /auth/dev-token`(dev) |
| Notes | `POST/GET /api/notes`、`GET /api/notes/:id`、`PATCH /api/notes/:id`、`DELETE /api/notes/:id`、`/restore`、`/permanent`、`/retry`、`/tags`、`GET /api/notes/trash` |
| Tags | `POST/GET /api/tags`、`DELETE /api/tags/:id` |
| Search | `POST /api/search`（pgvector 语义检索） |
| Notty | `GET/POST /api/chat-sessions`、`GET/DELETE /api/chat-sessions/:id`、`POST /api/chat-sessions/:id/messages`；`POST /api/chat`(无状态,旧) |
| 其他 | `POST /api/uploads/image`、`GET /api/stats`、`GET/PATCH /api/settings`、`GET /api/export`、`DELETE /api/account` |

完整字段与流水线细节见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

---

## 安全设计

- **认证**：Apple `identityToken` 经 `jose` 对 Apple JWKS 验签 + 校验 iss/aud，仅取 `sub` 为 `apple_id`（忽略 body 传入，防注入）。
- **SSRF 防护**：链接抓取 / `web_fetch` 经 `url-guard` 拦截私网/回环/CGNAT/链路本地/云元数据地址，逐跳重定向校验，DNS 解析全记录检查。
- **限流**：`/auth/*` 20 次 / 15 分钟；`/api/*` 300 次 / 分钟。
- **HTTP 加固**：helmet、关闭 `x-powered-by`、CORS 允许名单、10MB body 上限。
- **上传安全**：扩展名白名单（PNG/JPEG/GIF/WebP/HEIC/HEIF）、UUID 文件名、路径穿越校验。
- **数据隔离**：所有查询按 `user_id` 限定；标签关联前校验同属一人。
- **配置守卫**：生产环境弱/默认 `JWT_SECRET` 拒绝启动；`ENABLE_DEV_LOGIN` 在生产恒不生效。
- **已知缺口**：用户自定义 LLM `apiKey` 当前以**明文**存于 `users.settings`（GET/导出已脱敏，但落库未加密）；内嵌 MCP 的 `list_tags` 缺 `user_id` 过滤。详见架构文档「待办」。

---

## 文档索引

| 文档 | 说明 |
|------|------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | **实现现状权威文档**（架构 / 数据模型 / API / MCP / 流水线 / 安全） |
| [docs/design/2026-06-08-noteone-design.md](docs/design/2026-06-08-noteone-design.md) | 产品设计与技术决策记录（v2.0，含实现现状对照） |
| [docs/plans/](docs/plans/) | 早期实现计划 |
| [docs/](docs/) | 各轮迭代实施记录（iteration 1–6、code review、修复记录） |

---

## License

见 [LICENSE](LICENSE)。半开源策略：客户端、MCP Server、Schema/迁移、部署配置开源；AI 打标 Prompt 工程、高级检索、运营模块不在开源范围。
