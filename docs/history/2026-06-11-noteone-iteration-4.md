# NoteOne 迭代 4 实施记录(P1 写作闭环与个性化)

> 日期:2026-06-11
> 依据:`docs/2026-06-11-noteone-code-review.md` 第 4 节路线图(迭代 4)
> 验证:server `tsc` 通过;**macOS 与 iOS 两端 xcodebuild 均 BUILD SUCCEEDED**

---

## 一、F4 — 用户级 LLM 配置

### 服务端
- 新增 `server/src/services/user-config.ts`:`getUserChatConfig(userId)` 从 `users.settings.llm` 解析 apiKey/baseUrl/model,缺省回退全局 `config.qwen`。
- 新增 `server/src/routes/settings.ts`:
  - `GET /api/settings` 返回 `{ llm: { baseUrl, model, hasApiKey } }`(**apiKey 脱敏**,只回是否已设置);
  - `PATCH /api/settings` 合并写入 llm 配置(空串清除、未传保留)。
- 接线:`pipeline.processNote` 内部按 userId 解析 chatConfig 传给 tagNote/enrichNote;`chat.ts`、`chat-sessions.ts` 解析并传给 chatCompletion(WithTools)。
- **embedding 始终用默认提供方**(`enrichment.ts` 的 `generateEmbedding(content)` 去掉用户 config),保证向量空间维度/分布一致,避免换 provider 导致检索错乱。

### 客户端
- `APIClient`:`getSettings()` / `updateLLMSettings(apiKey:baseUrl:model:)`;模型 `SettingsResponse` / `LLMSettingsInfo`。
- `SettingsView`:新增「AI 模型」段(SecureField apiKey + baseUrl + model + 保存),进入时拉取当前配置;apiKey 仅在用户输入时提交。

## 二、F3 — 来源/作者抽取 + 引用信息
- `web-fetch.ts`:`FetchResult` 增加 `author/siteName/publishedDate`,新增 `extractMeta()` 解析 `<meta name|property=...>`(author/article:author/byl/twitter:creator、og:site_name/application-name、article:published_time/date 等)。
- `pipeline.ts`:抓取成功后用 `COALESCE` 回填 `note.author/authorOrg/sourceApp`(仅在原值为空时),为引用提供数据基础。
- `mcp.ts` `get_note`:输出新增「作者/单位/来源」与一行「引用信息」(作者 | 单位 | 链接 | 日期),供写作 LLM 直接引用。

## 三、F5 — 检索 contentType 过滤
- `search.ts`:此前 `contentType` 入参被解构却忽略,现接入(校验枚举后 `AND content_type = $`),保持向量排序。
- 客户端 `APIClient.searchNotes(query:contentType:limit:)`;`NoteListView` 搜索时带上当前 `filterType`。

## 四、B9 — 客户端 401 自动登出
- `APIClient`:`request`/`uploadImage` 命中 401 时发 `.unauthorized` 通知。
- `AuthService`:init 订阅 `.unauthorized`,在主线程 `signOut()` 切回登录态,避免"表面已登录、实际全失败"。

---

## 五、验证状态

| 项 | 状态 |
|----|------|
| server `npx tsc --noEmit` | ✅ exit 0 |
| xcodebuild NoteOne_macOS | ✅ BUILD SUCCEEDED |
| xcodebuild NoteOne_iOS(含 ShareExtension) | ✅ BUILD SUCCEEDED |

---

## 六、后续注意 / 仍待办

1. **用户 apiKey 明文存 DB**(`users.settings.llm.apiKey`):个人自部署可接受;多租户/SaaS 场景建议加密存储(KMS/对称加密)。GET 已脱敏,不回传明文。
2. **F3 仅做数据抽取与 MCP 透出**;客户端"写作模式 / 一键带引用插入"UI 仍缺(无写作编辑器),留待后续。
3. **F5 为向量 + contentType 过滤**;完整混合检索(关键词 BM25 + 向量融合排序)留待后续。
4. 仍待办(迭代 5):F7 测试补齐、B7 聊天压缩事务化、F9 账号注销/数据导出、S8 生产 HTTPS/ATS 收紧、F2 完整 iOS 拖拽手势、视频多模态。
