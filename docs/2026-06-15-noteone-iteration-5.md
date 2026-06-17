# NoteOne 迭代 5 实施记录(M5 上架准备)

> 日期:2026-06-15
> 依据:`docs/2026-06-11-noteone-code-review.md` 第 4 节路线图(迭代 5)+ M5 上架准备方案
> 验证:server `tsc` 通过;`vitest run` 47 单测全绿;集成测试在无 `TEST_DATABASE_URL` 时优雅跳过

---

## 一、目标

让 NoteOne 满足 App Store 5.1.1(v) / GDPR 数据可携带与可删除要求,并把当前两处数据一致性短板(Notty 压缩无事务、image 文件无级联清理)一并堵住,配套补关键路径回归测试。

不引入任何新业务能力。

---

## 二、Task 1 — 账号注销 `DELETE /api/account`

**新增** `server/src/routes/account.ts`:
- 注销前先用 `removeUploadedImagesForNotes()` 清理该用户 image / mixed 笔记的本地文件;
- `DELETE FROM users WHERE id = req.userId` —— schema 所有 FK 都是 `onDelete: cascade`,notes / tags / chat_sessions / chat_messages / note_tags 全部自动级联;
- 找不到行(token 还在但行已删)时 idempotent 204;
- 写入审计日志 `[account] hard-deleted user X, removed N image refs`。

**客户端** [APIClient.swift](file:///Users/bingtao/Documents/ai.alibaba/noteone/apple/NoteOne/Sources/Services/APIClient.swift):
- `deleteAccount() async throws`;201 后客户端调 `authService.signOut()` 切回登录态。

**UI** [SettingsView.swift](file:///Users/bingtao/Documents/ai.alibaba/noteone/apple/NoteOne/Sources/Views/SettingsView.swift):
- 「账户」段落新增「注销账号」(`role: .destructive`)+ 二次 `confirmationDialog` 警示「不可撤销,所有笔记/标签/对话/图片永久删除」+ 提示先导出。

---

## 三、Task 2 — 数据导出 `GET /api/export`

**新增** `server/src/routes/export.ts`(依赖 `archiver`):
- `noteone-export.json`:notes(含 status=trashed,不含 embedding)、tags、noteTags、chat_sessions(含 messages)、user profile(`settings.llm.apiKey` 已剔除);
- `uploads/<uuid>.<ext>`:仅当前用户的 image / mixed 笔记 sourceUrl 指向的本地文件,UUID 校验 + 路径越界防御;
- `README.txt`:schema 版本 + 导出时间;
- 流式 `archive.pipe(res)`,`Content-Disposition: attachment; filename="noteone-export-YYYYMMDD.zip"`。

**客户端**:
- `exportData() async throws -> URL`:`URLSession.download(for:)` 落到 `temporaryDirectory/noteone-export-YYYYMMDD.zip`;
- macOS:`NSWorkspace.activateFileViewerSelecting` 在 Finder 高亮;
- iOS:新增 `ShareSheet` 包裹 `UIActivityViewController` → 用户挑选保存位置或共享。

新依赖:`archiver` + `@types/archiver`。

---

## 四、Task 3 — 数据一致性遗留点

### 3a. Notty 压缩事务化(B7)
[chat-sessions.ts](file:///Users/bingtao/Documents/ai.alibaba/noteone/server/src/routes/chat-sessions.ts) `compactSession()`:
- 进程内 `Set<string>` 做 per-session 锁,杜绝并发触发产生重复摘要;
- LLM 调用留在事务外(慢 + 可重试),仅「插入 summary + 批量删除原始消息」用 `db.transaction` 包裹原子化;
- 删除从 N 次 `eq` 改为单次 `inArray`,减少往返。

### 3b. image 文件级联清理
- 新增 `server/src/services/upload-cleanup.ts`:
  - `removeUploadedImagesForNotes()` 为公共清理工具;
  - URL 解析仅认 `/uploads/<UUID>.<allow-listed ext>`,任何不规范路径(traversal、外部链接、非 UUID basename)直接拒绝;
  - 缺失文件 idempotent。
- `services/trash-cleanup.ts` 永久删除前先快照 image 笔记 sourceUrl → 调用清理 → 再 `DELETE FROM notes`;
- `routes/account.ts` 复用同一工具。

---

## 五、Task 4 — 客户端 ATS 收紧 + dev/prod baseURL

[APIClient.swift](file:///Users/bingtao/Documents/ai.alibaba/noteone/apple/NoteOne/Sources/Services/APIClient.swift):
- `#if DEBUG` baseURL = `http://localhost:3000`,否则 `https://api.noteone.app`;
- 自部署用户仍可通过设置页「服务器」字段 `configure(baseURL:token:)` 覆写。

[Project.swift](file:///Users/bingtao/Documents/ai.alibaba/noteone/apple/Project.swift)(Tuist):
- 移除 `NSAllowsArbitraryLoads: true`;
- 改为 `NSAllowsLocalNetworking: true` + `NSExceptionDomains.localhost.NSExceptionAllowsInsecureHTTPLoads = true`,仅放行本地开发域名;
- release 走默认 ATS:强制 HTTPS、禁明文。

[project.yml](file:///Users/bingtao/Documents/ai.alibaba/noteone/apple/project.yml)(xcodegen):同步上述配置;改为显式 `info.path` 写入 `NoteOne/Info.plist`(原 `GENERATE_INFOPLIST_FILE` + `INFOPLIST_KEY_*` 路径在嵌套 ATS 字典上不便表达)。

---

## 六、Task 5 — 关键路径回归测试

新增 `server/vitest.config.ts` + `src/test/setup.ts`(测试期 env 兜底)。新增 `supertest` + `@types/supertest` 依赖。

**单元测试(无外部依赖,5 文件 47 case)**:
- `services/url-guard.test.ts` — IPv4/IPv6 私网/CGNAT/链路本地/multicast、IPv4-mapped、DNS 失败/为空、纯公网放行;
- `services/web-fetch.test.ts` — 重定向 5 跳上限、内容类型白名单、404、按 maxLength 截断;
- `services/tagging.test.ts` — 非 JSON 降级返回 []、`json` 围栏剥离、非法 dimension 过滤、空 name 过滤、非数组兜底;
- `services/upload-cleanup.test.ts` — UUID basename 限制、绝对/裸路径都识别、忽略 text/link 笔记、忽略外链、拒绝 traversal、批量、缺失文件 idempotent;
- `routes/auth.test.ts` — 缺失 token / 错误签名 / 错误 audience / 错误 issuer 全部 401/400;body 中的 `appleId` 被忽略,以 token `sub` 为准;`dev-token` 在 `ENABLE_DEV_LOGIN=false` 时 403。

**集成测试(`TEST_DATABASE_URL` 时启用,1 文件 3 case)**:
- 标签多租户:用户 A 创建标签后,B 既看不到也删不掉;
- 注销级联:删除 user 后 notes / tags / note_tags / chat_sessions / chat_messages 全清空,本地图片文件被删,他人数据完整;
- 导出隔离:zip 仅含本人 notes / uploads,不含他人,`apiKey` 不出现在 JSON 中。

新增 npm script:`test:integration`(自动注入 `TEST_DATABASE_URL` 缺省值,允许 CLI 覆盖)。

---

## 七、验证状态

| 项 | 状态 |
|----|------|
| `npx tsc --noEmit` | ✅ exit 0 |
| `npm run test:run`(单测) | ✅ 5 文件 47/47 通过,集成 3 case 优雅 skip |
| `npm install`(archiver / supertest 等新依赖) | ✅ |
| 集成测试本地真跑 | ⚠️ 本机 PG 用户无 CREATEDB 权限,需先以管理员身份 `CREATE DATABASE noteone_test OWNER noteone;` 后即可运行 |
| xcodebuild macOS / iOS | ⏳ 待在 Xcode 中验收 |

---

## 八、后续注意 / 部署须知

1. **生产 baseURL** 当前占位 `https://api.noteone.app`,正式发布前需替换为真实域名;TLS 证书与反向代理由部署侧负责。
2. **集成测试 DB** 需要独立的可清空数据库;不要复用 dev 库(每个 case 都会 `TRUNCATE`)。
3. **archiver 依赖体积** 比较克制(~150KB),无原生扩展依赖,跨平台无问题。
4. **导出 zip 不含 embedding**:1536 维向量数据量大且与 provider 强绑定,导入侧应在账号迁移后用当前 LLM 配置重新生成。
5. 仍待办(M6+):F2 完整 iOS 长按拖拽源、BM25+向量混合检索、写作模式 UI / 引用插入、image 笔记多模态视觉理解、Android 端、浏览器扩展。
