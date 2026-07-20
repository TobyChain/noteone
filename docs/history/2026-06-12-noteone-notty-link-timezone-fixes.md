# NoteOne 修复记录:Notty 读正文 / 链接抓取归正 / 时间时区

> 日期:2026-06-12
> 范围:服务端为主(已落库 + 重启生效),客户端 1 处日期解码硬化
> 验证:server `tsc` 通过;迁移已应用到本地 DB;服务已重启健康(401/404 符合预期)

---

## 一、Notty 无法读取笔记正文 → 补「读正文」工具

### 问题
右下角悬浮助手 Notty 走 `POST /api/chat-sessions/:id/messages`(`chat-sessions.ts`)。该链路:
- 查询笔记时 `columns` **不含 `content`**,只注入「标题 + 80 字摘要 + 标签」的索引到 system prompt;
- 工具箱**只有 `web_fetch`**(抓外部 URL),没有任何读取库内笔记正文的工具。

结果:模型从头到尾拿不到正文,摘要为空时连这条笔记都「一无所知」。对比 `mcp.ts` 链路本就有 `get_note` / `search_notes`,Notty 这条偏偏被砍掉了。

### 修复(`server/src/routes/chat-sessions.ts`)
给 `NOTTY_TOOLS` 新增两个工具 + 改 system prompt 明确「索引≠正文,引用前必须先读」:

| 工具 | 作用 |
|------|------|
| `read_note(index \| id)` | 按索引序号 `[N]` 或笔记 id 读取**完整正文** + 摘要/标签/引用信息(作者\|单位\|链接\|日期)。`renderNoteFull()` 全程按 `req.userId` 作用域,杜绝越权。 |
| `search_notes(query, limit)` | pgvector 语义检索,`req.userId` 过滤、`generateEmbedding` 默认 provider 保证向量空间一致;返回 id+标题+摘要+相似度,模型据此再 `read_note`。 |
| `web_fetch` | 保留。 |

- `chatCompletionWithTools` 的 `maxIterations` 由 3 提到 **5**,给 search→read→read→答留足轮次。
- 设计取舍:不把所有正文塞进 prompt(撑爆 token),让模型按需拉取。
- 前端 `NottyView` / `APIClient` 无需改动。

---

## 二、链接类型笔记的标题/摘要/标签 → 进入链接抓正文

### 问题
旧 pipeline 抓取条件是 `!!sourceUrl`。但客户端对纯链接也只发 `contentType:"text"`,且 URL 常常只在 `content` 里、`sourceUrl` 为空 → `shouldFetch=false` → AI 只能对着裸 URL 字符串瞎编标题/摘要/标签。

### 修复(`server/src/services/pipeline.ts`)
| 环节 | 新行为 |
|------|--------|
| 抓取触发 | `sourceUrl` 或**从正文自动识别的 URL**(`extractFirstUrl`),非媒体笔记都抓 |
| 生成依据 | **页面正文为主**:纯链接→只用页面正文;带评论→`用户笔记 + 页面正文`,让标题/摘要/标签描述文章本身 |
| 类型归正 | 纯链接抓取成功后自动改判 `contentType="link"`,format 标签与 UI 图标/筛选随之正确 |
| 回填 | 额外回填 `sourceUrl`(记录真正抓的链接)与 `contentType`;作者/单位/来源沿用 `COALESCE` 仅补空 |
| 失败判定 | 改用 `userText`(去掉检测到的 URL 后)<10 字才算硬失败,抓不动的纯链接标 `failed` 可重试 |

与「一」衔接:Notty 的 `read_note` 现在读到的链接笔记,正文/摘要/标签都基于真实文章,问答才言之有物。

---

## 三、笔记时间「时区问题」→ timestamp 改 timestamptz

### 实测定位(重要)
`schema.ts` 所有时间列原为 `timestamp without time zone`(裸时间,不记时区)。本地实测:

- DB 会话时区 = **Asia/Shanghai**(非 UTC);
- 历史裸值是**上海 wall-clock**(`now()` 按会话时区落库);
- postgres-js 读回时把裸值当 **Node 进程本地(也是 Asia/Shanghai)** 解析。

→ 写入与读取两次转换正好抵消,**当前 create→read→display 的绝对时刻其实是正确的**(新插入实测漂移 0.0s,旧 `.iso8601` 也能正确解出 `2026-06-11 20:35:45`)。

但这是「三处时区恰好一致」的巧合:一旦服务器部署到 UTC 云机、或改了 DB/Node 时区,裸时间列就会整体偏移(经典差 8 小时),且历史数据无法区分。

### 修复
1. `server/src/db/schema.ts`:所有时间列加 `{ withTimezone: true }` → `timestamptz`(`users/notes/tags/chat_sessions/chat_messages` 的 created/updated/deleted)。
2. `server/drizzle/0004_flippant_layla_miller.sql`:`ALTER ... TYPE timestamptz`,并显式 `USING "col" AT TIME ZONE 'Asia/Shanghai'`。
   - 选 `Asia/Shanghai` 而非 `UTC`:与 postgres-js 现行读取语义**完全一致**,故迁移前后绝对瞬时 1:1 不变(显示零变化、零风险),仅把脆弱的隐式约定固化为带时区的真瞬时,未来读写不再依赖进程/会话时区。
   - drizzle 默认生成的版本缺 `USING` 子句,会按运行时会话时区转换,非 UTC 会话下会搬错历史数据——已手工修正。
3. `apple .../APIClient.swift`:`.iso8601` 默认不认小数秒(`.000Z`),换成自定义 `iso8601WithOptionalFractional`,带/不带毫秒都能解析(本机虽恰好能解,仍作硬化防回归)。

### 迁移前后实测
| | created_at 类型 | 876973b3 绝对瞬时 |
|---|---|---|
| 迁移前 | `timestamp without time zone` | `2026-06-11T12:35:45.714Z` |
| 迁移后 | `timestamp with time zone` | `2026-06-11T12:35:45.714Z`(不变 ✅) |

---

## 四、本地落地动作(已执行)
- `cd server && npx drizzle-kit migrate` → 0004 已应用,8 条笔记瞬时不变,列转 `timestamptz`。
- 运行中的服务器原以 `npx tsx src/index.ts`(**非 watch**)启动,改动未生效 → 已 kill 3000 端口并按原方式重启(PID 新,日志 `NoteOne server running on port 3000`),Notty/链接/时区改动现已全部生效。
- 健康检查:`/api/notes` 401(鉴权正常)、`/` 404(预期)。

## 五、说明 / 仍需你关注
- **客户端改动(日期解码)需重新构建并重启 macOS app 才会带上**;但因本机 `.iso8601` 本就能解毫秒,显示不会变化,可不急。
- 三项功能修复(Notty 读正文、链接抓取归正、时区 timestamptz)均为服务端,**重启后已对当前 app 生效**,无需重装客户端即可验证。
- 若未来把 server 部署到非 Asia/Shanghai 环境:新写入因已是 `timestamptz` 自动正确;仅需注意本次迁移对历史数据用的是 `Asia/Shanghai` 基准。
