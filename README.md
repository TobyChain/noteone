# 壹识 · NoteOne

[中文](README.md) · [English](README.en.md) · [License](#许可证)

## TL;DR

**顺手记一次，带出处地被任何 AI 调用。**

NoteOne 是本地优先的个人 AI 上下文库。它在 macOS 和 iOS 上顺手记下文本、链接与图片，保留原文、作者、来源和时间，自动完成摘要、标签和语义索引，并通过应用内搜索、闹闹（Notty）和 MCP 让这些材料在未来被可靠地检索、引用和继续使用。

macOS 安装包内嵌 Node.js 服务和 PGlite 数据库，无需单独部署后端。NoteOne 不内置 LLM 服务：未配置 API Key 时仍可正常保存和管理笔记，AI 功能会明确跳过。

## 项目简介

笔记工具通常能保存内容，却把整理、回顾和发现关系留给用户；普通 AI 对话又只能看到当前会话中的临时上下文。NoteOne 将两者连成一条本地工作流：低摩擦顺手记、异步整理、带出处检索，再交给任意 AI 继续使用。

产品围绕一条主线组织：

- **顺手记**：从快捷键、系统分享、拖拽或 MCP 接收材料。
- **上下文化**：保存原文和出处，生成摘要、标签和语义索引。
- **检索与引用**：按主题找回材料，复制带出处内容，或交给闹闹和外部 AI。
- **可选信息源**：新知（NewLore）自动采集公开信息，高见（FarView）提供七天趋势视图。

## NoteOne 提供什么

| 能力 | 作用 |
|---|---|
| **顺手记** | 通过 macOS 全局快捷键、iOS Share Extension 和拖拽保存文本、URL、选中文本与剪贴板图片 |
| **AI 静默整理** | 异步抓取正文，生成标题和摘要，按 format/topic/domain/module 四个维度打标并写入向量 |
| **个人上下文库** | 提供今日、资料库、混合检索、处理状态和带出处复制 |
| **上下文助手** | 闹闹先读取原始材料，再完成检索、比较、总结和带引用输出 |
| **新知日报** | 并发运行 5 个信息模块，经 LLM 筛选与翻译后生成带大纲导航的 HTML/Markdown 日报 |
| **高见趋势** | 过滤通用噪声，展示 7 天话题热度、来源构成和代表内容 |
| **MCP Server** | 让 Claude、Cursor、Codex 等外部 AI 检索、读取、创建、更新和管理笔记 |
| **数据主权** | 支持 ZIP 全量导出、密钥默认排除、30 天垃圾箱和完整本地数据清除 |

## 工作原理

```text
                         NoteOne 客户端（SwiftUI）
          今日 · 往事 · 顺手记 · 搜索 · 我的 · 上下文助手
                                  │
                         localhost HTTP + JWT
                                  │
                Express 5 + TypeScript 内嵌服务
       notes · tags · search · chat · reports · scheduler · MCP
                     │                         │
          异步 AI 整理流水线             NewLore 5 模块流水线
       抓取 → 摘要 → 标签 → 向量化   arXiv · GitHub · 官方 · 博客 · 会议
                     │                         │
                     └──────────┬──────────────┘
                                │
                  PGlite（应用内嵌）/ PostgreSQL 16
```

macOS App 启动后会拉起内嵌服务，通过 `/auth/local` 创建或复用唯一的本地数据所有者。桌面版默认使用 `~/Library/Application Support/NoteOne` 中的 PGlite 数据；开发和自部署场景也可连接 PostgreSQL 16 + pgvector。

详细设计见 [架构文档](docs/ARCHITECTURE.md)。

## 快速开始

### 系统要求

- Apple Silicon Mac
- macOS 14 或更高版本
- 使用源码构建时需要 Xcode 16、Swift 6 和 XcodeGen

### Homebrew 安装（推荐）

```bash
brew tap TobyChain/tap https://github.com/TobyChain/homebrew-tap.git
brew install --cask noteone
```

点击 `/Applications/NoteOne.app` 即可启动。首次打开若提示无法验证开发者，请在“系统设置 → 隐私与安全性”中选择“仍要打开”。当前 DMG 使用 ad-hoc 签名，未进行 Apple notarization。

更新：

```bash
brew update
brew upgrade --cask noteone
```

卸载应用：

```bash
brew uninstall --cask noteone
```

卸载不会自动删除 `~/Library/Application Support/NoteOne` 中的数据。

### DMG 安装

从 [GitHub Releases](https://github.com/TobyChain/noteone/releases) 下载最新 `NoteOne.dmg`，将应用拖入 Applications。更新只替换应用本体，不会覆盖应用外的数据目录。

## 配置与使用

### 配置 LLM

打开“设置 → AI 模型”，填写 OpenAI 兼容接口：

| 字段 | 示例 |
|---|---|
| API Key | OpenAI、DashScope 或自部署服务的 Key |
| Base URL | `https://api.openai.com/v1` |
| Model | `gpt-4o-mini`、`qwen-turbo` 或其他兼容模型 |

Base URL 填到版本前缀即可，NoteOne 会拼接 `/chat/completions` 和 `/embeddings`。未配置 LLM 时，笔记保存和基础管理仍然可用。

### 配置新知

“设置 → 新知”用于选择启用模块并配置 arXiv 分类、GitHub topics、论文上限、会议等级和博客源。点击运行，或让闹闹“补充今日新知”，即可生成当日日报。

### 接入 MCP

macOS 设置页可为 Claude Code 或 Cursor 写入 MCP 配置。手动配置示例：

```jsonc
{
  "mcpServers": {
    "noteone": {
      "command": "npx",
      "args": ["tsx", "src/mcp.ts"],
      "cwd": "/path/to/noteone/server",
      "env": {
        "DATABASE_URL": "postgresql://...",
        "QWEN_API_KEY": "...",
        "QWEN_BASE_URL": "...",
        "QWEN_MODEL": "..."
      }
    }
  }
}
```

MCP 提供 `list_notes`、`get_note`、`create_note`、`update_note`、`delete_note`、`restore_note`、`search_notes` 和 `list_tags`。`create_note` 可接收 `source_app`，并自动添加 `#prompt` 和 `#{app}` 标签。

## 存储与安全

- 内嵌服务默认只监听 `127.0.0.1`，App 使用内部 JWT 调用 localhost API。
- 如果主动将 `HOST` 绑定到非回环地址，必须设置至少 16 位的 `NOTEONE_ACCESS_TOKEN`。
- 链接抓取会拦截私网、回环、CGNAT、链路本地和云元数据地址。
- 上传文件使用 UUID 命名、扩展名白名单和路径穿越检查。
- 闹闹的本地文件工具不提供通用 shell，只能访问 `~/Documents`、`~/Desktop` 和 `~/Downloads`。
- 导出默认移除 API Key；只有显式选择时才会将密钥写入导出包。
- 生产模式拒绝弱 `JWT_SECRET`；`/auth/*` 和 `/api/*` 分别应用独立速率限制。

## 文档

| 文档 | 内容 |
|---|---|
| [架构](docs/ARCHITECTURE.md) | 运行组件、数据模型、安全边界和历史迁移 |
| [Apple 客户端](apple/README.md) | Xcode 工程、平台要求和客户端结构 |
| [后端](server/README.md) | 服务配置、API、新知流水线和数据维护 |
| [设计资料](docs/design/) | 产品目标和早期设计依据 |
| [历史记录](docs/history/) | 已完成迭代的实现记录 |

## 开发

### 后端与数据库

使用 Docker：

```bash
git clone https://github.com/TobyChain/noteone.git
cd noteone
cp server/.env.example server/.env

POSTGRES_PASSWORD=your-strong-pwd \
JWT_SECRET=$(openssl rand -hex 24) \
docker compose up -d
```

本地开发：

```bash
cd server
cp .env.example .env
npm install
npm run db:migrate
npm run dev
npm test
```

### Apple 客户端

```bash
cd apple
xcodegen generate
open NoteOne.xcodeproj
```

### 主要技术栈

| 层 | 技术 |
|---|---|
| 客户端 | SwiftUI、iOS 17、macOS 14、Swift 6 |
| 后端 | Node.js、TypeScript、Express 5、Drizzle ORM |
| 数据库 | PGlite（WASM）或 PostgreSQL 16 + pgvector |
| AI | OpenAI 兼容 Chat/Embedding API |
| Agent 接口 | MCP stdio server |

## 项目状态

NoteOne 是个人开源项目。macOS 分发采用 ad-hoc 签名；当前发布构建面向 Apple Silicon。问题反馈和改进建议可通过 GitHub Issues 提交。

## 许可证

NoteOne 采用 [Apache License 2.0](LICENSE)。
