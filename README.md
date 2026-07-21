# 壹识 · NoteOne

> 问渠那得清如许？为有源头活水来。
> —— 朱熹《观书有感》

壹识是一个以 AI 为内核的个人知识系统。

- **捕获 → 整理**：随手记下所见所闻，AI 静默打标、摘要、向量化
- **闹闹（Notty）**：核心 Agent，可调度本地终端、定时任务、新知补充等工具
- **新知（Ascan）**：每日扫遍 arXiv / GitHub / 官方博客 / 独立笔耕 / 会议论文 / 微信公众号，生成科技前沿日报
- **MCP**：让 Claude / Cursor 等外部 AI 直连你的笔记库

[中文](README.md) · [English](README.en.md) · [License](#license)

---

### 核心功能

> 随风潜入夜，润物细无声。
> —— 杜甫《春夜喜雨》

| 模块 | 能力 |
|---|---|
| **顺手捕获** | macOS 全局快捷键悬浮窗 / iOS Share Extension / 拖拽。自动抓取 URL、标题、选中文本、剪贴板图片 |
| **AI 静默整理** | 异步流水线：抓链接正文 → 生成标题与一句话摘要 → 四维度打标（format/topic/domain/module）→ 向量化入库 |
| **往事（笔记）** | 时间分组列表 + 语义搜索 + 标签筛选；一键新建笔记；每条附 AI 摘要、来源、作者、标签 |
| **闹闹（Notty）** | 三层上下文管理 + doom-loop 检测 + 工具调用持久化 + Markdown 渲染。可调本地终端、定时任务、新知补充、联网检索等工具 |
| **新知（Ascan）** | 每日 6 模块并发抓取（arXiv / GitHub / 官方 / 博客 / 会议 / 微信），LLM 筛选翻译，生成带大纲导航的 HTML 日报；闹闹可逐模块编排 |
| **定时任务** | 闹闹通过自然语言创建 cron 任务（如"每天 8 点补充新知"），DB 持久化 + 服务启动自动恢复 |
| **MCP Server** | Claude / Cursor / Codex 等 AI 直连笔记库：检索、读取、创建、更新、软删、恢复 |
| **每日报告** | 闹闹读取当天笔记 → 联网检索 → 生成 4 风格 × 3 深度的 HTML 报告 |
| **数据主权** | ZIP 全量导出 · 级联硬删账户 · 垃圾箱 30 天自动清理 |

### 架构

> 横看成岭侧成峰，远近高低各不同。
> —— 苏轼《题西林壁》

```
                          壹识 NoteOne
  ┌──────────────────────────────────────────────────────────────┐
  │                        客户端 (SwiftUI)                        │
  │                                                               │
  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
  │  │  往事    │  │  新知    │  │  记一条  │  │  闹闹    │     │
  │  │  笔记    │  │  日报    │  │  捕获    │  │  对话    │     │
  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘     │
  │       └─────────────┴─────────────┴─────────────┘            │
  │                  设置 · 报告 · 垃圾箱                          │
  └────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS (JWT)
  ┌────────────────────────┴──────────────────────────────────────┐
  │                   REST API (Express 5 + TypeScript)            │
  │                                                                │
  │  auth · notes · tags · search · chat-sessions · reports        │
  │  uploads · settings · account · export                         │
  │  ascan (reports / config / run-module / merge / status)        │
  │  sidecar (scheduler · local-tools)                             │
  │                                                                │
  │  ┌─────────────────────┐  ┌──────────────────────────────┐    │
  │  │  异步 AI 流水线      │  │  闹闹上下文管理器             │    │
  │  │  抓取 → 打标 → 摘要  │  │  token 裁剪 · 渐进摘要       │    │
  │  │  → 向量化            │  │  doom-loop 检测              │    │
  │  └─────────────────────┘  └──────────────────────────────┘    │
  │                                                                │
  │  PostgreSQL 16 + pgvector          新知 Python Pipeline        │
  │  notes · tags · chat · reports     arXiv · GitHub · 博客 ...   │
  │  scheduled_tasks                                                  │
  └────────────────────────────────────────────────────────────────┘
                           │ stdio (MCP)
  ┌────────────────────────┴──────────────────────────────────────┐
  │  MCP Servers — Claude / Cursor / Codex 直连笔记库              │
  └────────────────────────────────────────────────────────────────┘
```

详细架构见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

### 安装

> 工欲善其事，必先利其器。
> —— 《论语·卫灵公》

#### 后端 + 数据库（Docker 推荐）

```bash
git clone https://github.com/TobyChain/noteone.git
cd noteone

cp server/.env.example server/.env
# 至少填 JWT_SECRET（>= 16 位）

POSTGRES_PASSWORD=your-strong-pwd \
JWT_SECRET=$(openssl rand -hex 24) \
docker compose up -d
```

API 监听 `127.0.0.1:3000`，PostgreSQL 仅监听本机。

#### 后端本地开发

```bash
cd server
cp .env.example .env       # 填 DATABASE_URL / JWT_SECRET
npm install
npm run db:migrate         # 应用迁移（需先建库 + 启用 pgvector 扩展）
npm run dev                # 默认 :3000
npm test                   # Vitest
```

可在 `.env` 设 `ENABLE_DEV_LOGIN=true`，用 `POST /auth/dev-token` 跳过 Apple 登录（仅非生产生效）。

#### Apple 客户端

```bash
# 需先安装 XcodeGen
cd apple && xcodegen generate
open NoteOne.xcodeproj
```

要求 Xcode 16 / iOS 17 / macOS 14 / Swift 6。详见 [apple/README.md](apple/README.md)。

- DEBUG 默认连 `http://localhost:3000`，Release 连 `https://api.noteone.app`，可在设置中修改
- DEBUG 登录页提供开发者快速登录
- macOS 全局快捷键捕获需辅助功能权限

### 使用

#### 配置 LLM

> 巧妇难为无米之炊。
> —— 《古诗源》

壹识是开源项目，不内置 LLM 服务。所有 AI 功能（打标、摘要、闹闹对话、报告、新知日报）需要你自带 API Key。打开「设置 → AI 模型」：

| 字段 | 示例 |
|---|---|
| API Key | 你的 OpenAI / DashScope / 自部署 vLLM 的 key |
| Base URL | `https://api.openai.com/v1` 或 `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| Model | `qwen-turbo` / `gpt-4o-mini` / 任意 OpenAI 兼容模型 |

> Base URL 填到版本号即可，系统自动拼接 `/chat/completions` 与 `/embeddings` 端点。

未配置时笔记仍可正常保存，AI 步骤自动跳过。

#### 新知配置

「设置 → 新知」配置科技日报参数：ArXiv 分类、GitHub topics、论文数量上限、会议等级、博客源、微信公众号等。点击「运行」或跟闹闹说"补充今日新知"即可触发 pipeline 生成当日日报。

微信公众号抓取已内置于 NoteOne server（`/api/wechat`），在「设置 → 微信公众号」中扫码登录公众平台并搜索添加订阅的公众号即可，无需部署任何外部服务。

#### MCP 接入

> 海内存知己，天涯若比邻。
> —— 王勃《送杜少府之任蜀州》

macOS 设置中可一键写入 Claude Code / Cursor 配置。手动配置示例（内嵌 MCP，直连 DB）：

```jsonc
{
  "mcpServers": {
    "noteone": {
      "command": "npx",
      "args": ["tsx", "src/mcp.ts"],
      "cwd": "/path/to/noteone/server",
      "env": {
        "DATABASE_URL": "postgresql://...",
        "MCP_USER_ID": "<你的用户 UUID>",
        "QWEN_API_KEY": "...",
        "QWEN_BASE_URL": "...",
        "QWEN_MODEL": "..."
      }
    }
  }
}
```

工具：`list_notes` `get_note` `create_note` `update_note` `delete_note` `restore_note` `search_notes` `list_tags`。`create_note` 接受 `source_app` 入参，会自动打 `#prompt + #{app}` 标签。

### 安全

> 君子以思患而豫防之。
> —— 《周易·既济》

- **认证**：Apple identityToken 经 jose 对 Apple JWKS 验签；JWT 30 天
- **SSRF 防护**：链接抓取过滤私网 / 回环 / CGNAT / 链路本地 / 云元数据
- **速率限制**：`/auth/*` 20 次/15 分；`/api/*` 300 次/分
- **多租户隔离**：所有查询按 `user_id` 限定
- **上传安全**：UUID 命名 + 扩展名白名单 + 路径穿越校验
- **生产硬约束**：弱 `JWT_SECRET` 拒绝启动；`ENABLE_DEV_LOGIN` 在生产恒不生效
- **闹闹本地终端**：白名单命令 + 限定目录（`~/Documents` `~/Desktop` `~/Downloads`）+ 屏蔽 shell 元字符
- **helmet** 加固 HTTP 响应头

### 仓库结构

```
noteone/
├── apple/                      # iOS + macOS SwiftUI 客户端
│   ├── NoteOne/Sources/        #   Models · Views · Services · Theme
│   └── README.md               #   构建说明
├── server/                     # REST API + 内嵌 MCP（Express 5 + TS）
│   ├── src/routes/             #   auth · notes · tags · search · chat-sessions · ascan · wechat · reports
│   ├── src/services/           #   notty/ · llm · ascan/pipeline/（TS 新知 6 模块）· wechat/ · scheduler
│   └── README.md               #   后端说明
├── ascan/                      # 新知 Python Pipeline（已弃用，移植为 server 内 TS，保留作参考）
│   ├── config.schema.json      #   配置单一事实源（TS/Python 共用）
│   ├── src/                    #   pipeline · tools · trackers · config
│   ├── docs/                   #   生成的 HTML 日报
│   └── README.md               #   pipeline 入门
├── scripts/package-dmg.sh      # dmg 单体分发打包（内嵌 Node + PGlite，双击即用）
├── mcp-server/                 # 独立 MCP（HTTP 代理，5 只读工具）
├── browser-extension/          # Chrome 扩展（Manifest V3）
├── docs/
│   ├── ARCHITECTURE.md         #   架构权威文档
│   ├── design/                 #   早期设计稿
│   ├── plans/                  #   早期实施计划
│   └── history/                #   历史迭代日志
├── docker-compose.yml
├── README.md                   # 中文
└── README.en.md                # English
```

---

## License

> 落红不是无情物，化作春泥更护花。
> —— 龚自珍《己亥杂诗》

[Apache License 2.0](LICENSE) © 2026 TobyChain

壹识 NoteOne 全部代码（客户端、后端、Ascan pipeline、MCP servers、Schema、迁移、部署配置、浏览器扩展）均在 Apache 2.0 协议下开源。

为什么选 Apache 2.0 而不是 MIT：
- **专利保护**：明确授予专利权 + 报复条款，防止他人用代码后反诉专利侵权
- **No endorsement**（Section 6）：未经书面同意，不得用 "NoteOne" / "壹识" / "TobyChain" 名号为衍生品背书
- **贡献者协议**：PR 提交即自动授予专利权，避免后续扯皮
- **保留 attribution**：fork / 修改 / 分发必须保留版权声明

允许：商用 · 修改 · 分发 · 私用 · SaaS 部署
要求：保留版权声明 · 列出修改 · 不用作者名号背书

"NoteOne" / "壹识" 名称保留商标权，未经授权不得用于衍生品推广。
