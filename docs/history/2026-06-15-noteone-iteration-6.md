# NoteOne 迭代 6 实施记录(M6 拖拽与 Prompt 捕获)

> 日期:2026-06-15
> 依据:M6 拖拽与 Prompt 捕获方案 + 用户校准后的产品定位(碎片捕获 + 静默整理 + 复盘)
> 验证:server `tsc` 通过;`vitest run` 54 单测全绿;**macOS 与 iOS 两端 xcodebuild 均 BUILD SUCCEEDED**

---

## 一、目标(校准后)

让设计文档 §2.3「iOS 长按上滑即记」真正可用,并通过 MCP 工具让用户与 Claude/Cursor/Codex 等 AI 客户端的对话 prompt 也能沉淀为 NoteOne 笔记。

**严格遵循渐进式披露**:不堆 prompt、不加搜索融合、不做静默整理与复盘、不做写作 UI。

---

## 二、Task 1 — MCP `create_note` 扩展 source_app

**新增** [server/src/services/prompt-tagging.ts](file:///Users/bingtao/Documents/ai.alibaba/noteone/server/src/services/prompt-tagging.ts):
- `attachPromptTags(noteId, userId, sourceApp)`:幂等地给笔记打 `#prompt` + `#{normalized_source_app}` 两个 `format` 维度标签;
- 标签名标准化:trim → lowercase → 空白转 `-` → 删除非 `a-z0-9_-.` 字符 → 截断到 32 字符;空字符串或 `prompt` 自身不重复打;
- 内部复用 [tagging.ts](file:///Users/bingtao/Documents/ai.alibaba/noteone/server/src/services/tagging.ts) 的 user-scoped find-or-create 模式 + `onConflictDoNothing`。

**改** [server/src/mcp.ts](file:///Users/bingtao/Documents/ai.alibaba/noteone/server/src/mcp.ts):
- 抽出 `mcpCreateNote(userId, args)` 公共函数供测试直接调用,不再依赖启动 stdio transport;
- `create_note` 工具签名扩展 `source_app?: string`,工具描述明确写出 prompt 用法;
- `source_app` 有值时:写入 `notes.sourceApp` + 同步调用 `attachPromptTags` + 仍异步触发 `processNote`;
- 模块底部的 `main()` 加 entry-point 守卫:仅 `tsx src/mcp.ts` 直接执行时启动 stdio,避免被 import 时挂死。

**HTTP 路由不动**;客户端 App 创建 prompt 笔记的需求尚无,避免无用 API 表面。

---

## 三、Task 2 — iOS 拖拽闭环

### 2a. 顶层 Drop on App(设计文档 §2.3 重点)
**新增** [apple/NoteOne/Sources/Services/DropPayloadStore.swift](file:///Users/bingtao/Documents/ai.alibaba/noteone/apple/NoteOne/Sources/Services/DropPayloadStore.swift):
- `actor DropPayloadStore.shared`,存最近一次 `DroppedPayload(text?, sourceUrl?, imageData?)`;
- `consume()` 原子取出并清空,确保同一份 payload 不被重复处理;
- 仅内存,会话级。

**改** [ContentView.swift](file:///Users/bingtao/Documents/ai.alibaba/noteone/apple/NoteOne/Sources/Views/ContentView.swift):
- iOS TabView 改为 `selection: $selectedTab` 受控选项卡;
- 根视图加 `.onDrop(of: [.image, .url, .plainText])`:用户从其他 App 长按拖到 NoteOne(Dock 图标 / Slide-Over)→ 解析 provider → 写入 `DropPayloadStore` → 发 `.droppedPayloadReady` 通知;
- 收到通知 → 自动切到「记一条」Tab;
- 解析优先级:image > url > plainText(URL 同步回填到 sourceUrl 字段)。

**改** [CaptureView.swift](file:///Users/bingtao/Documents/ai.alibaba/noteone/apple/NoteOne/Sources/Views/CaptureView.swift):
- `.onAppear` 内追加 `DropPayloadStore.shared.consume()`,优先级高于既有 clipboard 自动粘贴;
- `.onReceive(.droppedPayloadReady)` 处理"已在 CaptureView 时收到新 drop"的场景。

### 2b. NoteOne 笔记作为拖拽源
**新增** [apple/NoteOne/Sources/Models/NoteDragPayload.swift](file:///Users/bingtao/Documents/ai.alibaba/noteone/apple/NoteOne/Sources/Models/NoteDragPayload.swift):
- `NoteDragPayload: Transferable`,`ProxyRepresentation(exporting: \.formattedText)`;
- 输出格式:标题 + 摘要 + 正文 + 引用脚注(作者 · 来源链接),非常适合直接粘到备忘录/邮件/文档。

**改** [NoteListView.swift](file:///Users/bingtao/Documents/ai.alibaba/noteone/apple/NoteOne/Sources/Views/NoteListView.swift):
- `NoteRowView` 末尾加 `.draggable(NoteDragPayload(note: note)) { ... }`,拖拽预览用胶囊状 thinMaterial 标签;
- 用户长按 row 即可把笔记拖到其他 App,实现「碎片再利用」。

### 2c. iOS Info.plist UTI 注册
**改** [Project.swift](file:///Users/bingtao/Documents/ai.alibaba/noteone/apple/Project.swift)(Tuist) + [project.yml](file:///Users/bingtao/Documents/ai.alibaba/noteone/apple/project.yml)(xcodegen):
- infoPlist 新增 `CFBundleDocumentTypes`,声明 NoteOne 能处理 `public.text` / `public.plain-text` / `public.url` / `public.image` / `public.movie`;
- `LSHandlerRank: Alternate` —— 不抢系统默认应用,但让 iOS 拖拽时把 NoteOne 列为合法目的地;
- 两个生成方案保持完全一致。

---

## 四、Task 3 — 测试

### 3a. prompt-tagging 单测
**新增** [server/src/services/prompt-tagging.test.ts](file:///Users/bingtao/Documents/ai.alibaba/noteone/server/src/services/prompt-tagging.test.ts) 7 case:
- `source_app=Claude` → 同时打 `#prompt` + `#claude`,user-scoped,dimension=format;
- 含空白与特殊字符 → 标准化为 `gpt-4o-mini`;
- `source_app` 为空白/null/undefined → 只打 `#prompt`;
- `source_app=Prompt` → 去重不打第二个;
- 重复调用 idempotent(不重复 attach);
- 超长 source_app 截到 32 字符。

### 3b. 集成测试新增 2 case
**改** [server/src/routes/integration.test.ts](file:///Users/bingtao/Documents/ai.alibaba/noteone/server/src/routes/integration.test.ts) 追加 `describe("mcpCreateNote with source_app")`:
- `source_app=Claude` 时 → 笔记落库 `contentType=text` + `sourceApp=Claude`,DB 中 `note_tags` 恰好两条均为 format 维度的 `prompt` + `claude`;
- 省略 `source_app` 时 → 纯文本笔记,不会同步打 `#prompt`。

需要 `TEST_DATABASE_URL` 时启用,缺省自动 skip。

### 3c. iOS 拖拽
SwiftUI `.draggable` / `.onDrop` 难以驱动单元测试,通过 xcodebuild 构建覆盖编译期,运行期人工 smoke;**不写自动化 UI 测试**。

---

## 五、验证状态

| 项 | 状态 |
|----|------|
| `npx tsc --noEmit` | ✅ exit 0 |
| `npm run test:run` | ✅ 6 文件 54/54 通过,集成 5 case 优雅 skip(prompt-tagging 7 + mcpCreateNote 2 已就位) |
| xcodebuild **NoteOne_macOS** Debug | ✅ BUILD SUCCEEDED |
| xcodebuild **NoteOne_iOS** Debug(含 ShareExtension) | ✅ BUILD SUCCEEDED |
| MCP create_note(source_app="Claude") 手测 | ⏳ 待 Claude Code 真接联调 |
| iOS Drop on App / 长按拖出 手测 | ⏳ 待真机或 iPad Simulator 验收 |

---

## 六、后续注意 / 仍待办

1. **iOS 系统级"长按上滑即记"完整体验**:`CFBundleDocumentTypes` + 顶层 `.onDrop` 已让 NoteOne 成为合法目的地,但 iPhone 上跨 App Drag 仍受系统限制(主要靠 Dock 拖拽);**最完整的入口仍是 Share Extension**(已实现)。本轮新增的拖拽路径主要服务于 iPad 与未来 visionOS 形态。
2. **iOS 笔记拖出**:`Transferable` 只导出文本表征。如需把 image 笔记原图拖到其他 App,需要额外加 `FileRepresentation` 并先下载图片到本地;按渐进式披露原则,暂不做。
3. **MCP source_app 元数据**:目前由调用方 AI 显式填入。若希望 NoteOne 自动识别"是哪个 AI client 在调",需要扩展 MCP Server 读取 `clientInfo`(MCP 规范字段),后续可在 `mcpCreateNote` 内补 fallback。
4. **prompt 笔记的复盘体验**:虽然现在能用 `#prompt` + `#claude` 标签筛出,但客户端 UI 没有专门的「prompt 收藏柜」视图。该方向与未来"复盘"主线高度相关,留作后续迭代讨论。
5. M6 不包含:浏览器扩展、静默整理引擎、混合检索、写作模式 UI、contentType 新增 prompt 枚举。
