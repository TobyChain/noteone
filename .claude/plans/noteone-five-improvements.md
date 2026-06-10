# NoteOne 五项改进实施计划

## Context
用户在 macOS 上使用 NoteOne 时发现5个问题需要改进。

---

## Issue 1: 侧边栏笔记无法在主界面显示

**根因**: NavigationSplitView 的 detail 闭包是硬编码的占位文本，selectedNoteId 被困在 NoteListView 内部。

**修复**:
- `ContentView.swift`: 添加 `@State private var selectedNoteId: String?`，传 Binding 给 NoteListView，在 detail 闭包根据 selectedNoteId 显示 NoteDetailView
- `NoteListView.swift`: 改 `@State` 为 `@Binding var selectedNoteId: String?`，删除 `.navigationDestination`

## Issue 2: Notty 会话持久化 + 自动压缩

参考 OpenCode 的 compaction 架构，实现两层方案：

**后端**:
- 新建 `server/src/routes/chat-sessions.ts`:
  - `POST /api/chat/sessions` 创建会话
  - `GET /api/chat/sessions` 列出会话
  - `GET /api/chat/sessions/:id/messages` 获取消息
  - `POST /api/chat/sessions/:id/messages` 发消息+AI回复
  - `POST /api/chat/sessions/:id/compact` 触发压缩
- 新建 DB 表: `chat_sessions`(id, userId, title, createdAt, updatedAt), `chat_messages`(id, sessionId, role, content, isSummary, createdAt)
- 压缩逻辑: 将 isSummary=false 的旧消息用 LLM 总结为一条 isSummary=true 的消息，删除被压缩的旧消息

**前端**:
- NottyView 存储当前 sessionId，关闭后再打开恢复上次会话
- 新增 session 管理（新建/切换/列表）
- 消息从后端加载而非仅内存

## Issue 3: Notty 弹窗动画优化

**问题**: Sheet 内容在窗口动画完成前就渲染，导致文本先于窗口落位。

**修复**: 在 NottyView 中添加 `@State private var isReady = false`，用 `.onAppear` + 短延迟设为 true，内容用 opacity/offset 动画过渡。

## Issue 4: 浅色/深色主题 + UI 优化

基于三份设计参考的共识：
- 暖色调 off-white 背景（非纯白）
- 暖色调 near-black 文本（非纯黑）
- 单一主色调（蓝色系）
- 无阴影，使用 hairline borders
- 温暖的 cream 色调

**实现**:
- 新建 `Theme.swift`: 定义 NoteOneTheme 颜色系统（light/dark tokens）
- Light: canvas `#f7f7f4`, surface white, ink `#1d1d1f`, accent blue
- Dark: canvas `#1c1c1e`, surface `#2c2c2e`, ink `#f5f5f7`, accent `#2997ff`
- 在 SettingsView 添加主题切换（跟随系统/浅色/深色）
- 优化各视图使用 theme tokens

## Issue 5: 自动获取文章链接和 meta 信息

**方案**: AppleScript + 未来浏览器插件

**当前实现 (AppleScript)**:
- HotkeyManager 在捕获选中文本的同时，通过 NSAppleScript 获取前台浏览器的 URL 和页面标题
- 支持 Safari、Chrome、Arc、Edge（Chrome系共享接口）
- CaptureView 自动填充 sourceUrl 和提取的 meta 信息

**未来增强**: 提供 Chrome Extension 一键安装入口

---

## 实施顺序

1. Issue 1 — 侧边栏导航修复（2文件，5分钟）
2. Issue 3 — Notty 动画优化（1文件，10分钟）
3. Issue 5 — 浏览器 URL/meta 自动获取（2文件，20分钟）
4. Issue 4 — 主题系统 + UI 优化（新建 Theme.swift + 改多个视图）
5. Issue 2 — Notty 持久化 + 压缩（DB schema + 新路由 + 前端重构）
6. 构建验证 + 提交推送

## 文件清单

**修改**: ContentView, NoteListView, NottyView, HotkeyManager, CaptureView, SettingsView, APIClient, server/index.ts, server/db/schema.ts
**新建**: Theme.swift, server/routes/chat-sessions.ts, ChatSession model
