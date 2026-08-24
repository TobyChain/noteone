# NoteOne 代码审查报告（漏洞 / Bug / 功能不足 / 迭代建议）

> 审查日期：2026-06-11
> 审查范围：`server/`（Node + Express + Drizzle + pgvector）、`mcp-server/`、`server/src/mcp.ts`、`apple/`（iOS + macOS SwiftUI 客户端 + Share Extension）
> 审查方式：全量静态阅读 + 架构对照设计文档 `docs/design/2026-06-08-noteone-design.md`

---

## 0. 结论速览

| 类别 | 数量 | 最高严重度 |
|------|------|-----------|
| 安全漏洞 | 11 | 🔴 Critical（认证绕过、SSRF） |
| 功能性 Bug | 12 | 🔴 高（核心捕获/同步链路断裂） |
| 功能缺口（对照设计文档） | 9 | — |

**两个必须最先修的致命问题：**
1. 🔴 **Apple 登录认证绕过** —— 服务端未校验 Apple 身份令牌，知道任意用户的 `appleId` 即可登录其账号（`server/src/routes/auth.ts`）。
2. 🔴 **核心捕获链路断裂** —— iOS Share Extension 写入的笔记主 App 永不读取，离线队列 `flush()` 从未被调用，"顺手记"主功能实际不生效（`SyncQueue.swift` / `ShareViewController.swift`）。

---

## 1. 安全漏洞

### 🔴 S1 — Apple Sign-In 认证绕过 / 账号接管（Critical）
**位置：** `server/src/routes/auth.ts:11-39`；客户端 `apple/NoteOne/Sources/Services/AuthService.swift:42`

服务端 `/auth/apple` 直接信任请求体中的 `appleId` 字段并据此签发 30 天 JWT，**完全没有校验 Apple 的 `identityToken`**。客户端发送的 `credential.user` 是一个稳定但**非保密**的标识符。

```ts
router.post("/apple", async (req, res) => {
  const { appleId, email, name } = req.body;   // ← 直接信任
  ...
  const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: "30d" });
```

**影响：** 任何人只要拿到/猜到受害者的 Apple user id，POST `{ "appleId": "<victim>" }` 即可获得合法 token，读取/删除其全部笔记 —— 完整账号接管。
**修复：** 客户端改传 `credential.identityToken`；服务端用 Apple 公钥（`https://appleid.apple.com/auth/keys`）验签该 JWT，校验 `iss`、`aud`(bundleId)、`exp`、`nonce`，从令牌的 `sub` 取 appleId，绝不信任 body 中的明文 appleId。

---

### 🔴 S2 — 服务端 URL 抓取 SSRF（Critical）
**位置：** `server/src/services/web-fetch.ts:9`；触发点 `pipeline.ts`（笔记 `sourceUrl`）、`routes/chat-sessions.ts` 的 `web_fetch` 工具

`fetchUrlContent` 对**用户可控 URL** 发起服务端请求，`redirect: "follow"`，无任何 host/IP 白名单或内网拦截，抓取结果还会回传给用户。

**影响：** 攻击者构造 `http://169.254.169.254/latest/meta-data/`（云元数据/临时凭证）、`http://127.0.0.1:3000`、内网 RFC1918 地址等，实现内网探测与数据外带。`redirect:"follow"` 还可绕过简单的前置校验。
**修复：**
- 解析目标域名 → 解析 IP → 拒绝回环/私网/链路本地/保留段（含 IPv6 `::1`、`fc00::/7`、`fe80::/10`）；
- 仅允许 `http/https`；禁用或手动跟踪重定向并对每跳重新校验 IP；
- 限制响应体大小（当前 `res.text()` 无上限，仅事后截断 15000 字）、限制 content-type；
- 出网走独立可控的 egress（如代理/允许域名清单）。

---

### 🟠 S3 — MCP 搜索存在 SQL 拼接（High）
**位置：** `server/src/mcp.ts:166-176`

```ts
await db.execute(`... '${vectorStr}'::vector ... user_id = '${USER_ID}' ... LIMIT ${limit}`);
```

与 HTTP 路由 `routes/search.ts` 使用参数化 `sql\`\`` 模板不同，此处是**裸字符串拼接**。当前 `limit` 被 `z.number()` 约束、`USER_ID` 来自环境变量，暂不可被外部直接注入，但属于危险范式：一旦未来引入字符串型过滤条件即成注入点。
**修复：** 统一改用 drizzle 的 `sql` 标签模板参数化（与 `routes/search.ts` 一致）。

---

### 🟠 S4 — 标签表非租户隔离，跨租户篡改（High）
**位置：** `server/src/db/schema.ts:62`（`tags` 无 `userId`）；`server/src/routes/tags.ts`（DELETE/POST 无归属校验）

`tags` 为全局表，`note_tags` 外键 `onDelete: cascade`。任意已登录用户可 `DELETE /api/tags/:id` 删除**系统中任意标签**，级联删除**所有其他用户**笔记上的该标签关联。`POST /api/tags` 同理共享全局命名空间。
**修复：** `tags` 增加 `userId` 并在所有标签查询/写入/删除加 `eq(tags.userId, req.userId)`；或将标签设计为"全局只读字典 + 用户私有覆盖"。

---

### 🟠 S5 — `POST /api/notes/:id/tags` 入参未校验（High）
**位置：** `server/src/routes/notes.ts:243-261`

`tagId` 直接取自 body，无 zod、无 UUID 校验、无存在性校验：
- 非 UUID → 抛 DB 异常（500，可能泄露堆栈，见 S7）；
- 合法但属他人的 `tagId` → 把他人标签挂到自己笔记（配合 S4 更糟）；
- `note_tags(note_id, tag_id)` 无唯一约束 → 重复挂载（见 B12）。

**修复：** 用 zod 校验 UUID；校验该 tag 存在且属当前用户；`ON CONFLICT DO NOTHING`。

---

### 🟡 S6 — 弱默认密钥与暴露的数据库（Medium）
**位置：** `docker-compose.yml`、`server/src/config.ts`

- `JWT_SECRET: ${JWT_SECRET:-change-me-in-production}` —— 默认弱密钥可直接伪造任意用户 token。
- DB 账号密码 `noteone/noteone`，端口 `5432:5432` 直接对宿主机 `0.0.0.0` 暴露。
- `config.ts` 用 `process.env.JWT_SECRET!` 非空断言，未设置时不在启动期失败，而是在首次签发/校验时运行时报错。

**修复：** 启动期强校验关键环境变量（缺失即拒绝启动）；移除弱默认值；DB 端口不对外暴露或绑定 `127.0.0.1`。

---

### 🟡 S7 — 缺失安全中间件与统一错误处理（Medium）
**位置：** `server/src/index.ts`

无 `helmet`、无 CORS 策略、无限流、无统一错误处理器。Express 5 会把 async 异常交给默认错误处理器，**非生产环境会把堆栈返回给客户端**（信息泄露）。`/auth/apple`、`/auth/dev-token` 无限流 → 可被暴力枚举（放大 S1）。
**修复：** 接入 `helmet`、显式 CORS 白名单、`express-rate-limit`（尤其认证端点）、统一错误处理中间件（生产环境不回传堆栈、统一日志）。

---

### 🟡 S8 — ATS 全开 + 明文 HTTP 硬编码（Medium）
**位置：** `apple/Project.swift:16`（`NSAllowsArbitraryLoads: true`）、`APIClient.swift:26`、`SettingsView.swift:6`

客户端默认 `http://localhost:3000` 且完全放开 App Transport Security。30 天全权限 JWT 走明文 HTTP，非本机部署时可被任意中间人嗅探/篡改。
**修复：** 生产强制 HTTPS；移除 `NSAllowsArbitraryLoads`，仅对本地开发用 `NSAllowsLocalNetworking` 或域名例外；服务地址区分 dev/prod。

---

### 🟡 S9 — `dev-token` 开放签发（Medium）
**位置：** `server/src/routes/auth.ts:41`

仅靠 `NODE_ENV !== "production"` 守卫即可为任意 name 签发 token。若线上 `NODE_ENV` 未正确设置即成开放认证绕过。
**修复：** 额外要求显式开关（如 `ENABLE_DEV_LOGIN=true`），且默认关闭。

---

### 🟡 S10 — AI 工具链提示注入面（Medium）
**位置：** `server/src/routes/chat-sessions.ts`（`web_fetch` 抓取内容直接进入 LLM 上下文）

抓取到的网页正文未做隔离即拼入对话上下文，配合 SSRF（S2）与工具自主调用，恶意页面可注入指令操纵助手行为。
**修复：** 抓取内容明确包裹为"不可信数据"，限制工具递归调用与作用域；对 `web_fetch` 复用 S2 的内网拦截。

---

### 🟡 S11 — LLM/Embedding 响应未做防御性解析（Medium）
**位置：** `server/src/services/llm.ts`（`data.choices[0].message.content`）、`services/tagging.ts:48`（`JSON.parse(cleaned)`）

模型返回异常结构时直接下标访问会抛错；`tagging.ts` 对模型输出 `JSON.parse` 后未校验 `dimension` 是否属于枚举即入库，可能违反枚举约束或污染标签体系（并使整条 pipeline reject）。
**修复：** 用 zod 校验模型输出结构与枚举；解析失败走降级而非抛出。

---

## 2. 功能性 Bug

### 🔴 B1 — 离线同步队列 `flush()` 从未被调用
**位置：** `apple/NoteOne/Sources/Services/SyncQueue.swift:25`；`NoteOneApp.swift:29` 仅调用 `warmUp()`

网络失败时 `CaptureView.swift:117` 会 `enqueue` 到磁盘，但全工程无任何地方调用 `flush()`，也无网络恢复监听。→ 离线笔记永久滞留、静默丢失。
**修复：** App 启动 / 进入前台 / 网络恢复时调用 `flush()`；加入重试与失败可视化。

### 🔴 B2 — iOS Share Extension 笔记成为孤儿数据
**位置：** `apple/NoteOneShareExtension/Sources/ShareViewController.swift`（写入 App Group `UserDefaults` 的 `pendingNotes`）vs `SyncQueue.swift`（读写 Application Support 下的文件）

Share Extension 把内容写入 App Group `UserDefaults(suiteName:"group.com.noteone.app")`，**主 App 从不读取该 key**（全局 grep 无消费方），且 SyncQueue 用的是另一套存储（文件）。→ iOS 端"顺手记"分享流程捕获的内容永远到不了服务端，**核心功能实质失效**。
**修复：** 统一队列存储到 App Group 容器；主 App 启动/前台读取并合并 `pendingNotes` → 同步 → 清空。

### 🔴 B3 — 设计中的 `failed` 状态未落地
**位置：** `plan.md` Part 1 已规划；`server/src/db/schema.ts:7` 仍只有 4 个状态，无 `failed`、无 retry 路由、无迁移

URL 抓取或 AI 富化失败时，`pipeline.ts` 不设置终态，笔记永久卡在 `pending_ai`，UI 一直显示"Notty 正在细品"。
**修复：** 落地 plan.md：加 `failed` 枚举 + 迁移、pipeline 失败置 `failed`、`POST /api/notes/:id/retry`、客户端失败态与重试按钮。

### 🔴 B4 — 剪贴板/分享的图片捕获不可用
**位置：** `plan.md` Part 2 未实现；无 `server/src/routes/uploads.ts`、无静态服务；`HotkeyManager.captureSelectedText()` / `CaptureView.pasteFromClipboard()` 仅读 `.string`；Share Extension 对图片仅存 `"图片: <filename>"` 占位文本

多模态捕获（设计文档核心卖点之一）实际为纯文本。
**修复：** 落地 plan.md Part 2：图片上传端点 + 存储 + 客户端图片读取/预览/上传 + `contentType:"image"`。

### 🟠 B5 — 分页参数未校验（负数/NaN → 500 或 DoS）
**位置：** `routes/notes.ts:101`（`offset` 允许负数，PG 报错）、`routes/search.ts:13`（`limit` 取自 body，无类型/上限/下限校验，可超大导致 DoS）
**修复：** zod 校验 + `Math.max(0, ...)` + 上限封顶。

### 🟠 B6 — 聊天每轮加载全表 note_tags ⨝ tags
**位置：** `routes/chat.ts:34`、`routes/chat-sessions.ts`（约第 95 行）

每次对话都 `SELECT` **全系统**所有用户的 note-tag 关联再在内存建 map，无 user/note 过滤。→ O(全表) 的每轮开销，扩展性 Bug，且隐含跨租户读取面。
**修复：** 按 `req.userId` 的笔记集过滤 join；或仅对涉及的 noteIds 取标签。

### 🟠 B7 — 聊天压缩无事务，存在竞态/不一致
**位置：** `routes/chat-sessions.ts` `compactSession()`

先插入 summary（`createdAt` 设为首条消息时间）再循环删除原始消息，**无事务**；压缩期间并发新消息或中途崩溃会导致摘要重复/原始消息半删等不一致；且 fire-and-forget。
**修复：** 包裹事务；加并发保护（会话级锁/标记）。

### 🟠 B8 — `processNote` 完全脱管
**位置：** `routes/notes.ts:90` `processNote(...).catch(console.error)`

后台富化失败仅打印日志，不改状态、无可观测（与 B3 相关）。
**修复：** 引入任务状态机/重试/队列（轻量可先用 DB 状态 + 重试端点）。

### 🟠 B9 — 客户端不处理 token 过期
**位置：** `apple/NoteOne/Sources/Services/AuthService.swift` / `APIClient.swift`

30 天 token 过期后服务端返回 401，客户端抛 `.unauthorized` 但不会把 `isAuthenticated` 置回 false 或引导重新登录 → 表面已登录、实际所有请求失败。
**修复：** 拦截 401 → 清理 token、切回登录态。

### 🟡 B10 — 字段更新能力不一致
**位置：** `routes/notes.ts` `updateNoteSchema`

创建支持 `sourceApp`/`authorOrg`/`rawContent`，PATCH 不支持；状态可设 `archived` 但无法在客户端往返设置 `trashed`（虽有独立删除端点，但语义不统一）。
**修复：** 对齐可更新字段集。

### 🟡 B11 — macOS 取词覆盖剪贴板 + 固定 100ms 睡眠竞态
**位置：** `apple/NoteOne/Sources/macOS/HotkeyManager.swift:captureSelectedText()`

合成 Cmd+C 后固定 `Thread.sleep(0.1)` 再恢复剪贴板：慢应用会漏取；clear 与 restore 之间崩溃会丢失用户剪贴板；依赖辅助功能权限但无被拒后的引导。
**修复：** 轮询 `changeCount`（带超时）而非固定睡眠；权限缺失时给出引导。

### 🟡 B12 — `note_tags` 缺少 (note_id, tag_id) 唯一约束
**位置：** `server/src/db/schema.ts:71`

自动打标 + 手动打标可产生重复关联，导致 `stats` 标签计数重复。
**修复：** 加复合唯一约束 / 主键，写入 `ON CONFLICT DO NOTHING`。

---

## 3. 功能缺口（对照设计文档）

| # | 设计文档要求 | 现状 | 缺口 |
|---|--------------|------|------|
| F1 | §2.1/2.5 多模态（图片/视频）捕获 + meta | 仅存链接，图片链路断裂(B2/B4) | 图片/视频捕获与存储 |
| F2 | §2.3 iOS 长按拖拽即拍 | 未实现，仅 Share Extension 且失效 | 拖拽/长按入档交互 |
| F3 | §2.1 写作模式引用与来源标注（核心价值） | MCP `get_topic_summary` 返回来源，但 `author/authorOrg/sourceApp` 从未从抓取页面提取填充 | 自动抽取作者/单位/日期 + 一键带引用插入 |
| F4 | §2.7 用户自定义 API Key 切换供应商 | `users.settings` 字段存在但无读写端点；`llm.ts` 永远用全局 `config.qwen` | 每用户 LLM 配置贯通 |
| F5 | §三 全文检索 + 向量混合检索 | 仅向量检索；`search` 接收 `contentType` 参数但**从未使用**(`routes/search.ts:13`) | 关键词/标签过滤 + 混合排序 |
| F6 | §2.6 数据统计 / 读书记录 | 仅基础计数 | 时间序列、阅读记录概念 |
| F7 | 质量保障 | `vitest` 已配置但**零测试文件** | 单测/集成测试 |
| F8 | 可观测性 | 后台任务（trash-cleanup、pipeline）无监控 | 日志/任务健康度 |
| F9 | §2.8 开放/合规 | 无账号注销、数据导出 | App Store 账号删除要求、导出 |

---

## 4. 功能迭代实施建议（优先级排序路线图）

> 原则:**先堵致命安全与断裂链路,再补多模态与写作闭环,最后做体验与质量。**

### 迭代 1（P0 · 安全与可用性急救,约 1 个 sprint）
目标:消除账号接管、修复核心捕获链路、堵住 SSRF。
1. **S1 修复**:客户端传 `identityToken`,服务端 Apple 公钥验签(`iss/aud/exp/nonce`),body appleId 不再可信。
2. **S2 修复**:`web-fetch` 增加 DNS→IP 内网拦截 + 协议限制 + 响应体大小上限 + 重定向逐跳校验。
3. **B1 + B2 修复**:统一离线/分享队列到 App Group;启动/前台/网络恢复触发 `flush()`;主 App 消费 `pendingNotes`。
4. **S6/S9**:启动期强校验环境变量;`dev-token` 加显式开关默认关闭;移除弱默认 secret。
5. **S7**:接入 helmet + CORS 白名单 + 认证端点限流 + 统一错误处理(生产不回传堆栈)。

**验收**:伪造 appleId 无法登录;请求内网地址被拒;iOS 分享的笔记能同步到服务端;离线创建联网后自动补传。

### 迭代 2（P0 · 多租户隔离 + 处理状态机,约 1 个 sprint）
1. **S4/S5/B12**:`tags` 增加 `userId` 并全链路按用户过滤;`note_tags` 加唯一约束 + `ON CONFLICT`;打标入参 zod 校验。
2. **B3/B8**:落地 plan.md `failed` 状态 + 迁移 + `retry` 端点 + 客户端失败态/重试。
3. **S3**:MCP 搜索改参数化 `sql` 模板。
4. **B5**:分页/搜索入参统一 zod 校验与封顶。
5. **B6**:聊天上下文标签查询按用户/笔记过滤。

**验收**:用户 A 无法删除/读取用户 B 标签;失败笔记显示"生成失败"且可重试;搜索/分页对异常入参返回 400 而非 500。

### 迭代 3（P1 · 多模态捕获闭环,约 1–2 个 sprint）
1. **B4/F1**:落地 plan.md Part 2 —— 图片上传端点(限类型/大小,UUID 命名)+ 静态服务(或对接 OSS/MinIO)、客户端剪贴板/分享图片读取→预览→上传。
2. **F2**:iOS 长按拖拽/选区即拍交互。
3. **B11**:macOS 取词改为轮询 `changeCount` + 权限引导。

**验收**:复制图片→⌘⇧N→预览→保存为 image 笔记;iOS 拖拽片段成功入档(含来源 meta)。

### 迭代 4（P1 · 写作闭环与个性化,约 1–2 个 sprint）
1. **F3**:抓取页面时抽取 `author/authorOrg/date` 填充笔记 meta;MCP/写作流程提供"带引用插入"。
2. **F4**:每用户 LLM 配置(`users.settings`)读写端点 + `llm.ts` 按用户取 key;SettingsView 接入。
3. **F5**:向量 + 关键词 + 标签/`contentType` 过滤的混合检索(先把被忽略的 `contentType` 参数接上)。
4. **B9**:客户端 401 自动登出。

### 迭代 5（P2 · 质量、可观测与合规)
1. **F7**:补关键路径单测/集成测试(认证、SSRF 拦截、pipeline、检索)。
2. **F8**:后台任务日志与健康度;**B7** 聊天压缩事务化。
3. **F9**:账号注销 + 数据导出;**S8** 生产 HTTPS、收紧 ATS。

---

## 附录:按文件索引的问题清单

- `server/src/routes/auth.ts` — S1, S9
- `server/src/services/web-fetch.ts` — S2, S10
- `server/src/mcp.ts` — S3
- `server/src/db/schema.ts` — S4, B12
- `server/src/routes/tags.ts` — S4
- `server/src/routes/notes.ts` — S5, B5, B8, B10
- `server/src/index.ts` / `config.ts` / `docker-compose.yml` — S6, S7
- `server/src/services/llm.ts` / `tagging.ts` — S11
- `server/src/routes/chat.ts` / `chat-sessions.ts` — B6, B7
- `server/src/services/pipeline.ts` — B3, B8
- `apple/NoteOne/Sources/Services/SyncQueue.swift` — B1
- `apple/NoteOneShareExtension/Sources/ShareViewController.swift` — B2
- `apple/NoteOne/Sources/macOS/HotkeyManager.swift` — B11
- `apple/NoteOne/Sources/Services/AuthService.swift` / `APIClient.swift` — B9
- `apple/Project.swift` / `SettingsView.swift` — S8
- `plan.md`（已规划未落地）— B3, B4
