# NoteOne Apple Client

iOS + macOS SwiftUI 客户端，单工程双平台。

## 要求

- Xcode 16+
- Swift 6（启用 strict concurrency）
- 部署目标：iOS 17+ / macOS 14+
- [Tuist](https://tuist.io)（用于从 `project.yml` 生成 `.xcodeproj`）或直接用已 commit 的 `NoteOne.xcodeproj`

## 生成工程文件

```bash
cd apple
# 如果装了 Tuist
tuist generate

# 否则直接用仓库里已生成的 NoteOne.xcodeproj
open NoteOne.xcodeproj
```

工程文件由 `project.yml` 定义。如果增删了 Swift 文件，需要重新 `tuist generate` 或者手动编辑 `NoteOne.xcodeproj/project.pbxproj`。

## 构建

```bash
# macOS
xcodebuild -project NoteOne.xcodeproj -scheme NoteOne_macOS -configuration Debug build

# iOS
xcodebuild -project NoteOne.xcodeproj -scheme NoteOne_iOS -configuration Debug \
  -destination 'generic/platform=iOS Simulator' build
```

## 配置

- DEBUG 默认连 `http://localhost:3000`，Release 默认连 `https://api.noteone.app`
- 在「设置 → 服务器」可修改 baseURL
- DEBUG 登录页提供"开发者快速登录"按钮（需后端 `ENABLE_DEV_LOGIN=true`）
- macOS 全局快捷键（默认 Cmd+Shift+O 弹出"顺手记"面板）需在系统设置中授予辅助功能权限

## 工程结构

```
apple/
├── NoteOne/
│   ├── Sources/
│   │   ├── NoteOneApp.swift        # App 入口
│   │   ├── Models/                 # 数据模型（Note/Tag/ChatMessage/AscanModels 等）
│   │   ├── Services/               # APIClient/AuthService/SyncQueue 等
│   │   ├── Views/                  # 主视图（MainSplitView/MainSidebar/NottyView/NoteListView/...）
│   │   └── Theme/                  # 配色 + Design Tokens
│   ├── Resources/Assets.xcassets   # 图标资源
│   ├── Info.plist
│   └── NoteOne.entitlements
├── NoteOneShareExtension/         # iOS Share Extension（系统分享菜单捕获）
├── Project.swift                  # Tuist 工程定义
├── project.yml                    # Tuist 配置
└── NoteOne.xcodeproj/             # 已生成的 Xcode 工程
```

## 主要视图

| 视图 | 说明 |
|------|------|
| `MainSplitView` | macOS 主壳：NavigationSplitView 三栏（sidebar + center + Notty drawer） |
| `MainSidebar` | macOS 侧边栏：往事（OldScene）列表 + 新知（NewSee）日报分组 + 垃圾箱/设置入口 |
| `NoteListView` | iOS 笔记列表 + 工具栏"+"新建按钮 |
| `NoteDetailView` | 笔记详情 + 编辑 + 元信息 |
| `CaptureView` | "顺手记"捕获面板（macOS 悬浮窗 / iOS sheet） |
| `NottyView` | 闹闹对话主界面 + 工具调用渲染 + 新知补充进度条 |
| `SettingsView` | 设置面板：AI 模型 / 新知配置 / 微信抓取 / 数据导出 |
| `AscanReportListView` / `AscanReportDetailView` | 新知日报列表 + 详情 |
| `TrashView` | 垃圾箱（30 天自动清理） |
