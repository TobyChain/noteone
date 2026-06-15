# NoteOne 迭代 1 + 2 实施记录(P0)

> 日期:2026-06-11
> 依据:`docs/2026-06-11-noteone-code-review.md` 第 4 节路线图
> 范围:迭代 1(安全与可用性急救)+ 迭代 2(多租户隔离 + 处理状态机)
> 验证策略:先实现,最后统一验证(server `tsc` 通过、迁移已生成)

---

## 一、迭代 1(P0 安全与可用性急救)

### S1 — Apple 登录验签(消除账号接管)
- `server/src/routes/auth.ts`:`/auth/apple` 改为用 `jose` 拉取 Apple JWKS(`https://appleid.apple.com/auth/keys`)验签 `identityToken`,校验 `iss=https://appleid.apple.com`、`aud ∈ APPLE_CLIENT_IDS`,从 `sub` 取 appleId;不再信任 body 中的明文 appleId。email 优先取自令牌。
- `apple/.../Services/AuthService.swift`:改为提取 `credential.identityToken`(缺失则中止)。
- `apple/.../Services/APIClient.swift`:`signInWithApple(identityToken:email:name:)`,请求体发送 `identityToken`。
- 新增依赖:`jose`。

### S2 — SSRF 拦截
- 新增 `server/src/services/url-guard.ts`:`assertSafeUrl()` 解析 DNS→IP,拦截回环/私网/链路本地/CGNAT/保留段(IPv4 + IPv6 + IPv4-mapped),仅允许 http/https。
- `server/src/services/web-fetch.ts`:改为 `redirect:"manual"` 手动跟随并逐跳校验(最多 5 跳);响应体流式读取,硬上限 2MB。
- 该守卫同时覆盖笔记 `sourceUrl` 抓取与聊天 `web_fetch` 工具(S10 部分缓解)。

### B1/B2 — iOS 同步链路修复
- `apple/.../Services/SyncQueue.swift`:队列文件改存 **App Group 容器**;新增 `drainSharedPending()` 读取 Share Extension 写入的 `UserDefaults(suiteName:"group.com.noteone.app")["pendingNotes"]` 并合并入队后清空;`flush()` 返回成功条数。
- `apple/.../NoteOneApp.swift`:启动时 `warmUp()`→`flush()`;`scenePhase==.active` 回前台再次 `flush()`;成功后发 `.noteCreated` 刷新列表。

### S6/S9 — env 强校验 + dev-token 开关
- `server/src/config.ts`:启动期强校验 `DATABASE_URL`、`JWT_SECRET`(生产环境拒绝弱/默认值);新增 `enableDevLogin`(`ENABLE_DEV_LOGIN=true && !prod`)、`apple.clientIds`、`allowedOrigins`。
- `server/src/routes/auth.ts`:`/auth/dev-token` 改为依赖 `config.enableDevLogin`,默认关闭。
- `docker-compose.yml`:移除弱 `JWT_SECRET` 默认值(改 `${JWT_SECRET:?...}` 必填);DB 端口绑定 `127.0.0.1`;新增 env 透传。
- `server/.env.example`:补全新变量说明。

### S7 — 安全中间件
- `server/src/index.ts`:接入 `helmet`、`cors`(白名单来自 `ALLOWED_ORIGINS`)、`express-rate-limit`(`/auth` 15min/20 次,`/api` 1min/300 次)、统一错误处理(生产不回传堆栈)、`disable("x-powered-by")`。
- 新增依赖:`helmet`、`cors`、`express-rate-limit`、`@types/cors`。

---

## 二、迭代 2(P0 多租户隔离 + 处理状态机)

### S4/S5/B12 — 标签多租户隔离
- `server/src/db/schema.ts`:`tags` 增加 `userId`(可空 FK,非破坏式迁移)+ 索引;`note_tags` 增加 `(note_id, tag_id)` 唯一索引。
- `server/src/routes/tags.ts`:创建/查询/删除全部按 `req.userId` 过滤。
- `server/src/services/tagging.ts`:打标按用户去重;模型输出做数组/字段/枚举校验(S11);写入 `onConflictDoNothing()`。
- `server/src/routes/notes.ts`:`POST /:id/tags` 用 zod 校验 `tagId(uuid)`,并校验该标签属当前用户;`onConflictDoNothing()`。

### B3/B8 — failed 状态机 + 重试
- `server/src/db/schema.ts`:`note_status` 枚举新增 `failed`。
- `server/src/services/pipeline.ts`:`processNote` 增加 `userId` 参数;URL 抓取失败且无有效正文 → `failed`("内容获取失败…");enrichment 失败 → `failed`("AI 处理失败");整体兜底 try/catch。
- `server/src/routes/notes.ts`:新增 `POST /api/notes/:id/retry`(重置 `pending_ai` 并重跑 pipeline)。
- 客户端:`Note.swift` 增加 `.failed`;`NoteDetailView` 增加 `FailedBanner` + 重试;`NoteListView` 行内失败指示;`APIClient.retryNote(id:)`。

### S3/B5/B6 — 查询安全与收敛
- `server/src/mcp.ts`:`search_notes` 改用参数化 `sql\`\`` 模板(消除字符串拼接),`limit` 封顶 50;`create_note` 透传 `USER_ID` 到 `processNote`。
- `server/src/routes/search.ts`:`limit` 入参 clamp 到 [1,100]。
- `server/src/routes/notes.ts`:列表 `limit/offset` clamp(offset 不再为负)。
- `server/src/routes/chat.ts` & `chat-sessions.ts`:标签查询改为 `inArray(noteTags.noteId, 当前用户笔记ids)`,不再全表扫描。

---

## 三、数据库迁移

生成迁移 `server/drizzle/0003_huge_madrox.sql`:
```sql
ALTER TYPE "public"."note_status" ADD VALUE 'failed';
ALTER TABLE "tags" ADD COLUMN "user_id" uuid;
ALTER TABLE "tags" ADD CONSTRAINT "tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
CREATE UNIQUE INDEX "note_tags_note_tag_uniq" ON "note_tags" ("note_id","tag_id");
CREATE INDEX "tags_user_id_idx" ON "tags" ("user_id");
```
应用:`npm run db:migrate`(需 `DATABASE_URL`)。

⚠️ 注意:
- `note_tags_note_tag_uniq` 唯一索引创建前,若库中已有重复 `(note_id, tag_id)` 行需先去重,否则迁移失败。
- `tags.user_id` 为可空:历史"全局标签"将不归属任何用户(查询被过滤),新标签均带 userId。如需保留旧标签,迁移后可手动回填。

---

## 四、验证状态

| 项 | 状态 |
|----|------|
| server `npx tsc --noEmit` | ✅ 通过(exit 0) |
| `npm install` 新依赖 | ✅ jose/helmet/cors/express-rate-limit |
| drizzle 迁移生成 | ✅ 0003_huge_madrox.sql |
| 所有 processNote/tagNote 调用点 arity | ✅ 一致 |
| 客户端无残留 appleId/credential.user | ✅ |
| **Swift/Xcode 编译** | ⏳ 待在 Xcode 中验收(本机未跑 xcodebuild) |
| 运行时联调(登录验签/SSRF/同步/重试) | ⏳ 待起 DB+服务联调 |

---

## 五、后续注意 / 部署须知

1. **本地开发登录**:开发者快速登录按钮(`LoginView` #if DEBUG)现依赖服务端 `ENABLE_DEV_LOGIN=true`,否则返回 403。本地 `.env` 需显式开启。
2. **生产 env**:必须设置强 `JWT_SECRET`(≥16 字符)、正确 `APPLE_CLIENT_IDS`(应用 bundle id);否则服务拒绝启动 / 登录失败。
3. **Apple 登录**:真机需用真实 Apple 账号返回的 `identityToken` 才能通过验签(dev-token 走另一条链路)。
4. 未纳入本轮(后续迭代):F1/F2 多模态捕获、F3 引用闭环、F4 用户级 LLM Key、F5 混合检索、B7 聊天压缩事务化、B9 客户端 401 自动登出、S8 生产 HTTPS/ATS 收紧、F7 测试补齐。
