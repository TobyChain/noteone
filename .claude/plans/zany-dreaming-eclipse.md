# NoteOne 四项修复实施计划

## Context
用户在 macOS 上运行 NoteOne 后发现四个问题需要修复。

## Issue 1: 浮窗光标位置偏移
**文件**: `apple/NoteOne/Sources/Views/CaptureView.swift`
macOS TextEditor 内部缩进约 top:8 leading:5，placeholder 改为平台条件 padding。

## Issue 2: 抓取选中文本而非剪贴板
**文件**: `HotkeyManager.swift`, `CaptureView.swift`
togglePanel 前通过 CGEvent 模拟 ⌘C，捕获选中文本传给 CaptureView。

## Issue 3: 笔记不显示 + AI 配置
**文件**: `CaptureView.swift`, `NoteListView.swift`, `server/.env`, `llm.ts`
NotificationCenter 刷新 + 切换到 yunwu.ai API (gpt-5.4-mini)。

## Issue 4: Notty AI 助手
**新建**: `chat.ts`, `ChatMessage.swift`, `NottyView.swift`
**修改**: `index.ts`, `APIClient.swift`, `ContentView.swift`
POST /api/chat 端点 + 前端聊天界面。
