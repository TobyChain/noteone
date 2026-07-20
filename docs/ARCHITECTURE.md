# NoteOne 架构与实现现状（ARCHITECTURE）

> 状态：实现现状权威文档 · 截至 2026-06-15（迭代 6 之后）
> 本文档以**代码为准**，描述系统当前真实形态；产品愿景与决策背景见 [design/2026-06-08-noteone-design.md](design/2026-06-08-noteone-design.md)。
> 文件路径均相对仓库根 `noteone/`。

> **注**：2026-07 系列变更尚未全面回写本文档。主要差异：
> - 删除"记实"模块（Writer）—— 本文中涉及 记实/WriterView/WriterAssistantView/markdown 编辑器/writer-messages 路由的部分均已移除
> - 微信抓取改用 [wechat-article-exporter](https://github.com/wechat-article/wechat-article-exporter)（原生 Node 部署，无需 Docker），详见 [wechat-wae-setup.md](wechat-wae-setup.md)
> - 新增 `scheduled_tasks` 表 + `services/scheduler.ts` + `services/schedule-tools.ts`（闹闹可创建 cron 定时任务）
> - 新增 `services/local-tools.ts`（闹闹可调白名单本地终端命令）
> - ascan 拆分为 `services/ascan/{config,reports,runner,tools}.ts` 子模块
> - 多模块去重机制全面修复（WeChat known_ids、arXiv 跨日、Conference days_recent + DOI 跨模块）
> - 完整变更见 `git log --since=2026-06-15`

---

## 1. 系统总览

NoteOne 由四个可独立部署的部分组成：

| 组件 | 目录 | 运行形态 |
|------|------|----------|
| Apple 客户端 | `apple/` | iOS / macOS SwiftUI（Swift 6，iOS 17 / macOS 14） |
| REST API + 内嵌 MCP | `server/` | Node.js / Express 5（`:3000`） |
| 独立 MCP Server | `mcp-server/` | Node.js / stdio（HTTP 代理 REST API） |
| 数据库 | docker-compose | PostgreSQL 16 + pgvector（`127.0.0.1:5432`） |

数据流：客户端经 HTTPS+JWT 访问 REST API；笔记创建后由后端**异步流水线**抓取链接、打标、摘要、向量化；外部 AI 经 MCP 读写笔记。

---

## 2. 数据模型（`server/src/db/schema.ts`）

### 2.1 枚举

| 枚举 | 取值 |
|------|------|
| `content_type` | `text` · `image` · `video` · `link` · `mixed` |
| `note_status` | `pending_ai` · `active` · `archived` · `trashed` · `failed` |
| `tag_dimension` | `format` · `topic` · `domain` · `module` |

### 2.2 表

**users**：`id` · `apple_id`(UNIQUE) · `email` · `name` · `avatar_url` · `settings`(jsonb，含用户 LLM 配置) · `created_at` · `updated_at`。

**notes**：`id` · `user_id`(FK→users，级联删) · `content_type`(默认 text) · `title`(可空，AI 生成) · `content`(NOT NULL) · `raw_content`(jsonb，存抓取的页面 meta) · `source_url` · `source_app` · `author` · `author_org` · `ai_summary` · `embedding`(vector(1536)) · `status`(默认 pending_ai) · `deleted_at` · 时间戳。索引：user_id / status / created_at。

**tags**：`id` · `user_id`(可空 FK，遗留全局标签兼容；新标签均 user-scoped) · `name` · `dimension` · `parent_id`(自引用层级) · `description` · `created_at`。索引：user_id / dimension / parent_id。

**note_tags**（关联）：`note_id`(FK) · `tag_id`(FK) · `confidence`(0–1) · `is_manual`(默认 false)。唯一索引 (note_id, tag_id)。

**chat_sessions**：`id` · `user_id`(FK) · `title`(首条消息自动生成，≤50 字) · 时间戳。

**chat_messages**：`id` · `session_id`(FK) · `role`(user/assistant) · `content` · `is_summary`(标记压缩摘要) · `created_at`。

### 2.3 迁移（`server/drizzle/`）

| 文件 | 内容 |
|------|------|
| `0000_sudden_darkstar` | 初始 schema：枚举 + users/notes/tags/note_tags |
| `0001_parallel_johnny_storm` | 新增 chat_sessions + chat_messages |
| `0002_tired_captain_midlands` | note_status 增 `trashed`；notes 增 `deleted_at` |
| `0003_huge_madrox` | note_status 增 `failed`；tags 增 `user_id`（多租户）；note_tags 加唯一约束 |
| `0004_flippant_layla_miller` | 时间列统一转 `timestamptz`（按 `Asia/Shanghai` 保留历史数据） |

---

## 3. 后端结构（`server/src/`）

```
config.ts            环境变量加载 + 校验(JWT_SECRET 强度、必填项)
index.ts             Express 入口:helmet/cors/限流,挂载所有路由,启动垃圾箱清理 cron
db/
  client.ts          Drizzle + postgres-js 连接
  schema.ts          全部表/枚举定义
middleware/auth.ts   JWT Bearer 校验,挂 req.userId
routes/
  auth.ts            POST /auth/apple · /auth/dev-token
  notes.ts           笔记 CRUD + 软删/恢复/硬删/retry/tags
  tags.ts            标签 CRUD(user-scoped)
  search.ts          POST /api/search(pgvector 余弦相似度)
  chat.ts            POST /api/chat(无状态旧版,无工具,UI 已不用)
  chat-sessions.ts   Notty 持久化会话 + 工具调用 + 历史压缩
  uploads.ts         POST /api/uploads/image(multer,静态服务 /uploads)
  settings.ts        GET/PATCH /api/settings(apiKey GET 时脱敏)
  account.ts         DELETE /api/account(级联硬删 + 清图)
  export.ts          GET /api/export(ZIP 导出,剔除 apiKey)
  stats.ts           GET /api/stats(计数 + 类型分布 + Top20 标签)
services/
  pipeline.ts        新笔记异步处理编排
  enrichment.ts      摘要 + 标题 + 向量,置 status=active(失败置 failed)
  tagging.ts         LLM 多维打标 + 输出校验 + DB upsert
  prompt-tagging.ts  MCP prompt 捕获的同步 format 打标(#prompt + #app)
  llm.ts             chatCompletion / chatCompletionWithTools / generateEmbedding
  user-config.ts     解析每用户 LLM 覆盖(回退全局默认)
  web-fetch.ts       抓取并清洗网页正文 + 提取 meta + 跟随重定向
  url-guard.ts       SSRF 防护(私网/回环/CGNAT/链路本地/DNS 全记录校验)
  trash-cleanup.ts   每小时 cron:硬删 30 天前的 trashed 笔记 + 清上传文件
  upload-cleanup.ts  安全删除 /uploads(UUID 校验 + 路径穿越防护)
mcp.ts               内嵌 MCP(stdio,直连 DB,7 工具);导出 mcpCreateNote 供测试
test/                集成测试辅助(db.ts / setup.ts)
```

---

## 4. REST API 端点

> 所有 `/api/*` 需 `Authorization: Bearer <JWT>`（`middleware/auth.ts`）。`/auth/*` 公开。
> 限流：`/auth/*` 20 次/15 分钟；`/api/*` 300 次/分钟。

### Auth（公开）
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/auth/apple` | 验 Apple identityToken（JWKS），upsert 用户，发 30 天 JWT |
| POST | `/auth/dev-token` | 仅 `ENABLE_DEV_LOGIN=true` 且非生产；按名字建/取用户 |

### Notes
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/notes` | 创建笔记，触发异步流水线，返回 201 |
| GET | `/api/notes` | 列表（排除 trashed），分页（1–100，默认 50），含 tags |
| GET | `/api/notes/trash` | trashed 列表，按 deletedAt 排序 |
| GET | `/api/notes/:id` | 单条 + tags（非本人 404） |
| PATCH | `/api/notes/:id` | 改 content/title/sourceUrl/author/authorOrg/status |
| DELETE | `/api/notes/:id` | 软删（status→trashed，记 deletedAt） |
| POST | `/api/notes/:id/restore` | 从垃圾箱恢复（→active） |
| DELETE | `/api/notes/:id/permanent` | 硬删（仅 trashed） |
| POST | `/api/notes/:id/retry` | failed 笔记重跑流水线（→pending_ai） |
| POST | `/api/notes/:id/tags` | 给笔记挂标签（校验标签同属一人） |
| GET | `/api/notes/:id/tags` | 取笔记全部标签 |

### Tags / Search / Stats
| 方法 | 路径 | 说明 |
|------|------|------|
| POST/GET | `/api/tags` | 创建 / 列出（可 `?dimension=` 过滤），user-scoped |
| DELETE | `/api/tags/:id` | 删除（本人） |
| POST | `/api/search` | pgvector 语义检索 + 可选 contentType 过滤，返回相似度 |
| GET | `/api/stats` | totalNotes + byContentType + Top20 标签 |

### Notty 会话
| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | `/api/chat-sessions` | 列出 / 新建会话 |
| GET/DELETE | `/api/chat-sessions/:id` | 取会话(含消息) / 删会话(级联) |
| POST | `/api/chat-sessions/:id/messages` | 发消息；LLM 可调 read_note/search_notes/web_fetch；满 30 条自动压缩 |
| POST | `/api/chat` | 无状态旧版（无工具，当前 UI 未调用） |

### 其他
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/uploads/image` | 表单字段 `file`，≤10MB，PNG/JPEG/GIF/WebP/HEIC/HEIF |
| GET/PATCH | `/api/settings` | 用户 LLM 覆盖（GET 把 apiKey 脱敏为 hasApiKey） |
| DELETE | `/api/account` | 注销 + 级联硬删 + 清图（GDPR） |
| GET | `/api/export` | ZIP（notes/tags/chat/images，剔除 apiKey） |

---

## 5. AI 流水线（`services/pipeline.ts`）

笔记创建后 `processNote(noteId, userId, content, contentType, sourceUrl)` **fire-and-forget** 异步执行：

```
1. 解析用户 LLM 配置(getUserChatConfig，回退全局 Qwen 配置)
2. URL 检测
     image/video → 不抓取
     mixed       → 仅从正文找 URL
     text/link   → 先 sourceUrl,再扫正文 http(s)://
3. 抓取 fetchUrlContent(url)  [services/web-fetch.ts]
     · 每跳经 assertSafeUrl(SSRF 防护),最多 5 跳重定向
     · 10s 超时 / 2MB 上限 / 仅 text|html|xml|json
     · 去 script/style/nav/header/footer,实体解码,截断 15k
     · 提取 title / author / siteName / publishedDate
     · 成功:更新 raw_content,COALESCE 回填 sourceUrl/author/authorOrg/sourceApp
            正文仅为 URL 时重分类为 link
     · 失败:正文非 URL 文本 <10 字 → 标记 failed
4. 并行 Promise.allSettled([tagNote, enrichNote])
     tagNote   : LLM 出 JSON[{dimension,name,confidence}],校验维度/非空,
                 user-scoped upsert tags + 插 note_tags(非致命)
     enrichNote: 并行 generateSummary(≤100字) / generateTitle(≤30字,COALESCE)
                 / generateEmbedding,然后 status→active(致命:失败→failed)
```

**LLM 客户端（`services/llm.ts`）**
- Chat：OpenAI 兼容 `/chat/completions`，默认 DashScope `https://dashscope.aliyuncs.com/compatible-mode/v1`，默认模型 `gpt-5.4-mini`（`config.ts` 缺省值），温度 0.3。
- Embedding：`text-embedding-3-small`，1536 维，**恒走默认 provider**（不随用户覆盖切换，保证向量空间一致）。
- 工具调用：`chatCompletionWithTools` 支持多轮 function-calling（默认 3 轮，Notty 5 轮）。

---

## 6. Notty AI 助手

**持久化形态（`routes/chat-sessions.ts`）**——客户端实际使用的形态。System prompt 注入用户笔记索引（编号 + 标题 + 摘要 + 标签），声明可用工具：

| 工具 | 作用 |
|------|------|
| `read_note` | 按索引号 `[N]` 或 UUID 读全文 + 引用块（作者/单位/URL/日期）+ 标签，user-scoped |
| `search_notes` | pgvector 语义检索（≤20，user-scoped） |
| `web_fetch` | 经同一 SSRF 防护抓任意 URL，返回清洗后正文 |

**历史压缩**：会话满 30 条触发后台 `compactSession`（进程内 Set 锁防并发），把最近 6 条之外的消息 LLM 摘要成单条 `[对话摘要]`（`is_summary=true`），事务内删旧插新。

**无状态旧版（`routes/chat.ts`）**：全笔记索引进 system prompt，可选 `noteIds` 注入全文，无工具无持久化，当前 UI 未调用。

---

## 7. MCP 双实现

### 7.1 内嵌（`server/src/mcp.ts`）—— 直连 DB，本机自托管
`npm run mcp`（`tsx src/mcp.ts`）启动，stdio transport，用户身份取自 `MCP_USER_ID` 环境变量。

| 工具 | 参数 | 作用 |
|------|------|------|
| `list_notes` | limit?, offset? | 列笔记(≤50)，标签格式化 `#name` |
| `get_note` | id | 全文 + 引用块 |
| `create_note` | content, source_url?, title?, source_app? | 建笔记；`source_app` 有值时同步打 `#prompt`+`#{规范化app}`，再异步流水线 |
| `update_note` | id, title?, content? | 改字段 |
| `delete_note` | id | 软删 |
| `restore_note` | id | 恢复 |
| `search_notes` | query, limit? | 向量检索(≤50，参数化 SQL) |
| `list_tags` | dimension? | 按维度列标签 |

> 入口守卫：仅 `tsx src/mcp.ts` 直接执行才启动 stdio，被 import 时不挂起。`mcpCreateNote(userId,args)` 导出供集成测试直调。

### 7.2 独立（`mcp-server/src/index.ts`）—— HTTP 代理，供外部 AI
无 DB 依赖，经 `NOTEONE_API_URL`(默认 `http://localhost:3000`) + `NOTEONE_TOKEN`(Bearer) 代理 REST API。

| 工具 | 代理端点 |
|------|----------|
| `search_notes` | POST /api/search |
| `get_note` | GET /api/notes/:id |
| `list_tags` | GET /api/tags |
| `list_notes` | GET /api/notes |
| `get_topic_summary` | POST /api/search → 精简摘要集 |

---

## 8. Apple 客户端（`apple/NoteOne/Sources/`）

**Bundle**：主 App `com.noteone.app`，分享扩展 `com.noteone.app.share`，App Group `group.com.noteone.app`。

### 8.1 文件清单
- **Models/**：`Note`（含 `ContentType` / `NoteStatus`） · `Tag`(`TagDimension`) · `NoteTag` · `ChatMessage`(会话模型) · `NoteDragPayload`(Transferable 拖出) · `AuthModels`。
- **Views/**：`ContentView`(根 split/tab + iOS 顶层 onDrop) · `CaptureView`(统一录入,图文+剪贴板+拖拽+离线兜底) · `NoteListView`(分时段分组+轮询+语义搜索+NoteRowView 可拖) · `NoteDetailView`(详情+AIProcessing/Failed/Trashed 三态 banner+FlowTags+懒分块) · `NottyView`(会话 UI+SessionListPopover+ChatBubble) · `SettingsView`(主题/账户/服务器/快捷键/LLM/统计/标签) · `LoginView`(Apple 登录+DEBUG 快捷登录) · `TrashView`(恢复/永久删/清空) · `MCPInstallView`(macOS 一键装 MCP)。
- **Services/**：`APIClient`(actor，全部 API) · `AuthService`(@MainActor，Apple 登录+401 自动登出) · `KeychainHelper`(jwt_token) · `SyncQueue`(actor，离线队列+消化 App Group 共享待传) · `DropPayloadStore`(actor，跨视图拖拽内存中转)。
- **macOS/**：`HotkeyManager`(全局快捷键+选中文本/剪贴板图片/浏览器 meta 捕获) · `FloatingPanel`(非激活悬浮 NSPanel)。
- **Theme/**：`Theme`(system/light/dark + 命名色板)。

### 8.2 捕获流
- **macOS**：`⌘⇧O`(默认) → `HotkeyManager.togglePanel()` → 抓浏览器 URL+标题(AppleScript) + 选中文本(合成 ⌘C 轮询剪贴板) + 剪贴板图片 → `FloatingPanel` 内 `CaptureView` 预填 → 保存。
- **iOS 手动**：「记一条」Tab → CaptureView（无剪贴板自动读，检查 DropPayloadStore）。
- **iOS Share Extension**：分享菜单 → 写 App Group `UserDefaults["pendingNotes"]` + 图片落 `share-images/` → 主 App 激活 `SyncQueue.drainSharedPending()` → `flush()` 补传。
- **iOS 拖入**：顶层 `.onDrop([.image,.url,.plainText])`（image>url>text）→ DropPayloadStore → 通知切到「记一条」Tab。
- **拖出**：`NoteRowView.draggable(NoteDragPayload)`，导出标题+摘要+正文+引用纯文本。

### 8.3 客户端状态可视化
- 笔记 `pending_ai`：列表脉冲 sparkle，详情「Notty 正在细品…」，详情每 2s 轮询直至状态变化；列表有 pending 时每 3s 轮询。
- `failed`：列表红色 ⚠，详情 `FailedBanner`「生成失败」+「重试」。
- `trashed`：`TrashedBanner`「恢复 / 永久删除」。
- 标签按维度配色：format 蓝 / topic 绿 / domain 橙 / module 紫。

### 8.4 构建系统
`NoteOne.xcodeproj` 为日常实际构建工程；`Project.swift`(Tuist) 与 `project.yml`(XcodeGen) 为等价生成清单（早期生成用，当前未驱动构建）。iOS 17 / macOS 14，Swift 6 严格并发。

---

## 9. 部署与配置

### docker-compose.yml
- `db`：`pgvector/pgvector:pg16`，仅绑 `127.0.0.1:5432`，卷 `pgdata`。
- `api`：`build ./server`，`3000:3000`，`POSTGRES_PASSWORD` / `JWT_SECRET` 缺失即 fail-fast。

### 环境变量
| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `DATABASE_URL` | 是 | — | PG 连接串 |
| `JWT_SECRET` | 是 | — | ≥16 位；生产拒绝弱/默认值 |
| `NODE_ENV` | 否 | development | 生产守卫开关 |
| `PORT` | 否 | 3000 | 监听端口 |
| `APPLE_CLIENT_IDS` | 否 | com.noteone.app | Apple JWT 受众 |
| `ALLOWED_ORIGINS` | 否 | ""(反射) | CORS 允许名单 |
| `ENABLE_DEV_LOGIN` | 否 | false | 启用 dev-token（生产恒不生效） |
| `QWEN_API_KEY` | 否 | "" | LLM Key |
| `QWEN_BASE_URL` | 否 | DashScope compatible-mode | LLM Base URL |
| `QWEN_MODEL` | 否 | `gpt-5.4-mini` | 默认 chat 模型 |
| `MCP_USER_ID` | 内嵌 MCP 必填 | "" | 笔记所有者 UUID |
| `NOTEONE_API_URL` | 独立 MCP | http://localhost:3000 | REST API 基址 |
| `NOTEONE_TOKEN` | 独立 MCP 必填 | "" | Bearer JWT |

---

## 10. 安全（详）

- **Apple 验签**：`jose` 对 `https://appleid.apple.com/auth/keys` 验签 + 校 iss/aud，仅取 `sub` 作 `apple_id`（忽略 body 传入）。JWT 30 天。
- **SSRF（`url-guard.ts`）**：拦 IPv4 私网/回环/CGNAT(100.64/10)/链路本地(含 169.254.169.254 元数据)/多播保留；IPv6 ::1 / fc00::/7 / fe80::/10 / IPv4-mapped；仅 http/https；DNS 全 A/AAAA 记录校验；每跳重定向复检。
- **限流**：auth 20/15min，api 300/min（标准头开，legacy 头关）。
- **HTTP**：helmet（CSP/HSTS/X-Frame-Options…）、关 x-powered-by、CORS 名单、10MB JSON 上限。
- **上传/路径**：UUID basename 正则 + 扩展名白名单 + `path.resolve/relative` 防穿越。
- **数据隔离**：所有查询 `eq(*.userId, req.userId)`；挂标签前双向校验归属。
- **注入**：Drizzle / 参数化 `sql\`\`\`；向量检索用 `${vec}::vector` 参数化。
- **配置守卫**：生产弱 `JWT_SECRET` 拒启；dev-login 双重门控（env + 非生产）。

---

## 11. 测试（`server/`，Vitest + Supertest）

| 文件 | 覆盖 |
|------|------|
| `routes/auth.test.ts` | Apple 登录：签名/受众/签发者/body-appleId 注入攻击 |
| `routes/integration.test.ts` | 标签多租户、账户硬删+清图、导出、MCP 建笔记（需 `TEST_DATABASE_URL`，缺省 skip） |
| `services/tagging.test.ts` | LLM 输出校验（非 JSON / 坏维度 / 空名） |
| `services/prompt-tagging.test.ts` | source_app 规范化、幂等、长度截断 |
| `services/web-fetch.test.ts` | HTML 解析、重定向、content-type 拒绝、截断 |
| `services/url-guard.test.ts` | 全 IPv4/IPv6 私网段、DNS 多记录、失败用例 |
| `services/upload-cleanup.test.ts` | 路径穿越、UUID 校验、批量删除 |

iteration 6 记录：`tsc` 通过，`vitest run` 54 用例全绿，macOS + iOS 两端 `xcodebuild` 均 BUILD SUCCEEDED。

---

## 12. 已知待办 / 缺口

1. **用户 LLM `apiKey` 明文落库**：存于 `users.settings` jsonb；GET 与导出已脱敏，但 DB 内未加密 → 应加静态加密。
2. **内嵌 MCP `list_tags` 缺 `user_id` 过滤**：单用户自托管下无碍，多用户需补。
3. **客户端「服务器」设置项未实际生效**：`SettingsView` 的服务器地址字段当前不调 `APIClient.configure`。
4. **iOS 笔记拖出仅文本**：`NoteDragPayload` 只导出文本表征；图片原图拖出需加 `FileRepresentation` + 先下载。
5. **iPhone 跨 App「长按上滑即记」**：受系统限制，最完整入口仍是 Share Extension；拖拽路径主要服务 iPad / 未来 visionOS。
6. **MCP `source_app` 自动识别**：当前由调用方 AI 显式填；可读 MCP `clientInfo` 做 fallback。
7. **静默整理引擎 / 混合检索 / 写作模式 UI / 浏览器扩展 / prompt 收藏柜视图**：设计文档中规划，尚未实现。
