# NoteOne（顺手记一条）— 产品设计文档

> 创建日期：2026-06-08
> 更新日期：2026-06-15（迭代 6 后）
> 状态：已确认 ✅ · 已实现并持续迭代
> 版本：v2.0

> **关于本文档**：以下「一～十」节为 2026-06-08 确认的原始产品设计与决策记录（保留原貌，作为愿景与决策依据）。代码经 6 轮迭代后部分内容已演进，请结合文末 **[十一、实现现状对照（v2.0）](#十一实现现状对照v20)** 阅读；**实现细节以代码为准**，权威实现文档见 [../ARCHITECTURE.md](../ARCHITECTURE.md)。

---

## 一、产品愿景

用户能够通过快捷操作快速保存所看到的文本内容、图片链接、视频链接等多模态多格式信息，按照格式贴上标签，便于 AI 自动检索和总结。当用户希望开展写作、创作或研究时，可以驱使 AI 接入本应用，以用户定义的写作主题为参考，检索历史记录的文本（文章、论文、博客、公众号等多信息源）、图片、甚至视频，并附上来源和引用，让整篇文章更具作者自身思考和深度，更像一篇专业的技术博客。

---

## 二、用户需求记录（原始提示词）

### 2.1 核心痛点
> 用户能够通过这个应用（设置的某个快捷指令）快速保存和入档自己所看到的文本内容、图片链接、视频链接等多模态多格式信息，并按照格式贴上标签，便于AI自动检索和总结，当用户（也就是作者）希望开展写作、创作或研究的时候，可以驱使AI接入这个应用，以用户定义的写作主题为参考历史所记录的文本（文章、论文、博客、公众号等多信息源）、图片、甚至视频，并附上来源和引用，让整个文章更具作者自身思考和深度，也更像一篇专业的技术博客。

### 2.2 多端同步
> 我希望他是多端可用的，即手机ios端可以记录，并同步在macos端。两侧的AI可以接入应用MCP来共同访问用户的顺手记。

### 2.3 iOS 端交互设想
> ios在选中某一个文本片段、链接、图片、视频之后好像会有个浮窗效果，就是把这一个小片段随着手指的移动而移动，我希望设置个效果，也就是长按之后向上滑动，noteone可以接受这个片段信息，并存储入档（来源、链接、meta信息），从而实现顺手记。

### 2.4 macOS 端交互
> macos端侧也有对应的客户端，也能够以快捷键的方式来快速入档。

### 2.5 AI 打标体系
> AI 自动打标，细粒度上则应该是多维度的，比如有格式标签（文本、图片、视频）、主题标签（科技、财经、教育等）、基于不同的主题标签，AI 应该能够再进一步细化出不同的领域标签、模块标签。另外，需要入档的除了标签之外，还需要有这些片段基本的 meta 信息（作者、来源链接、单位（如有）、日期等）。

### 2.6 AI 写作模式
> 两者结合，因为应用中需要能够 AI 打标签，具有一些基本的 AI 调用功能，可以提供简单的总结、数据统计、读书记录等功能。

### 2.7 AI 模型策略
> 云端大模型 API，用一些低廉小模型的 API 来完成 App 内的 AI 调用。默认提供 Qwen 模型，支持用户自定义 API Key 切换供应商。

### 2.8 开放策略
> 面向其他用户，或者作为半开源（部分非核心代码开源）。

---

## 三、技术决策记录

| 决策项 | 选择 | 备选方案 | 理由 |
|--------|------|----------|------|
| 客户端平台 | iOS + macOS 原生 (SwiftUI) | React Native / PWA | 原生体验最佳，Share Extension 支持完整 |
| 后端语言 | Node.js (TypeScript) | Python (FastAPI) | TS 全栈一致性好 |
| 数据库 | PostgreSQL + pgvector | MongoDB | 全文检索 + JSONB 多维标签 + 向量检索 |
| 数据同步 | 自建后端 API | iCloud / 文件同步 | MCP 可直连数据库，完全掌控，未来可扩展 |
| AI 调用 | 默认 Qwen 模型 + 用户自定义 API Key | 端侧模型 | 低成本，用户可灵活切换供应商 |
| 深度写作 | MCP Server 接入外部大模型 | 仅 App 内 | 充分利用 Claude 等大模型能力 |
| 部署方式 | Docker 容器化 | Serverless / 裸机 | 开源友好，一键自部署，可平滑扩展到 K8s |
| 用户认证 | Apple Sign In + JWT | 邮箱+密码 / OAuth | 苹果生态原生，App Store 审核要求 |
| 文件存储 | 仅存链接引用 | OSS / MinIO | 零存储成本，后续可扩展实际存储 |
| 离线策略 | 本地暂存队列 + 联网后批量同步 | Core Data 全缓存 / 强制联网 | 轻量实现，体验可接受 |
| AI 模型供应商 | 默认 Qwen，支持用户自定义 API Key | 固定供应商 | 灵活性强，国内外用户均可用 |

---

## 四、系统架构

```
┌─────────────────────────────────────────────────────┐
│                     客户端                           │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ iOS App  │  │  macOS App   │  │  MCP Server   │  │
│  │(SwiftUI) │  │  (SwiftUI)   │  │ (Node.js本地) │  │
│  └────┬─────┘  └──────┬───────┘  └───────┬───────┘  │
│       │                │                  │          │
└───────┼────────────────┼──────────────────┼──────────┘
        │                │                  │
        ▼                ▼                  ▼
┌─────────────────────────────────────────────────────┐
│            RESTful API (Node.js / TypeScript)         │
│                                                       │
│  ┌────────────┐ ┌────────────┐ ┌──────────────────┐  │
│  │  捕获服务   │ │  标签服务   │ │  写作/检索服务    │  │
│  └─────┬──────┘ └─────┬──────┘ └────────┬─────────┘  │
│        │              │                 │             │
│        ▼              ▼                 ▼             │
│  ┌──────────────────────────────────────────────┐     │
│  │        PostgreSQL + pgvector                  │     │
│  │  ┌─────────┐ ┌──────┐ ┌───────────────────┐  │     │
│  │  │  notes  │ │ tags │ │   embeddings      │  │     │
│  │  └─────────┘ └──────┘ └───────────────────┘  │     │
│  └──────────────────────────────────────────────┘     │
│        │                                              │
│        ▼                                              │
│  ┌──────────────────────┐                             │
│  │  LLM API (Qwen 等)   │                             │
│  │  打标 / 摘要 / 向量   │                             │
│  └──────────────────────┘                             │
└───────────────────────────────────────────────────────┘
```

### 4.1 核心组件

**1. iOS App (SwiftUI)**
- Share Extension：在任何 App 中通过分享菜单快速保存
- 长按上滑手势：利用 iOS Drag & Drop API 实现"顺手记"
- App 内快速输入和笔记浏览
- 本地暂存队列：离线时缓存，联网后自动同步

**2. macOS App (SwiftUI)**
- 全局快捷键（如 ⌘⇧N）唤起悬浮捕获窗
- 自动读取剪贴板内容，预填到输入框
- 完整的笔记浏览、检索、管理界面
- 轻量写作模式（AI 辅助总结、统计、读书记录）

**3. RESTful API 后端 (Node.js / TypeScript)**
- Apple Sign In + JWT 用户认证
- 笔记 CRUD + 多维标签管理
- AI 打标流水线（异步队列处理）
- 语义检索（pgvector 向量相似度 + 全文检索）
- 用户 API Key 管理（加密存储）

**4. MCP Server (Node.js)**
- 本地运行，通过用户 JWT 调用后端 API
- 暴露工具供 Claude 等外部 AI 调用
- 支持语义检索、笔记读取、统计、写作草稿生成

**5. PostgreSQL + pgvector**
- notes 表：内容、格式、来源 URL、作者、日期等 meta
- tags 表：四维度层级标签体系（格式/主题/领域/模块）
- note_tags 关联表：含 AI 打标置信度
- embeddings：语义向量，支持相似内容检索

---

## 五、数据模型

### 5.1 用户 (users)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| apple_id | TEXT | Apple Sign In 标识符 |
| email | TEXT | 邮箱 |
| name | TEXT | 用户名 |
| avatar_url | TEXT | 头像 |
| settings | JSONB | 用户偏好设置（含自定义 API Key，加密存储） |
| created_at | TIMESTAMP | 注册时间 |
| updated_at | TIMESTAMP | 更新时间 |

### 5.2 笔记 (notes)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| user_id | UUID | 所属用户（FK → users） |
| content_type | ENUM | text / image / video / link / mixed |
| title | TEXT | 标题（可由 AI 自动生成） |
| content | TEXT | 正文/描述 |
| raw_content | JSONB | 原始捕获数据（保留完整信息） |
| source_url | TEXT | 来源链接 |
| source_app | TEXT | 来源应用（Safari / 微信 / Twitter 等） |
| author | TEXT | 原作者 |
| author_org | TEXT | 作者所属单位（如有） |
| ai_summary | TEXT | AI 生成的摘要 |
| embedding | VECTOR(1536) | 语义向量 |
| status | ENUM | pending_ai / active / archived | 
| created_at | TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |

### 5.3 标签 (tags)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name | TEXT | 标签名称 |
| dimension | ENUM | format / topic / domain / module |
| parent_id | UUID | 父标签 ID（层级关系，FK → tags） |
| description | TEXT | 标签描述 |
| created_at | TIMESTAMP | 创建时间 |

### 5.4 笔记-标签关联 (note_tags)

| 字段 | 类型 | 说明 |
|------|------|------|
| note_id | UUID | 笔记 ID（FK → notes） |
| tag_id | UUID | 标签 ID（FK → tags） |
| confidence | FLOAT | AI 打标置信度（0-1） |
| is_manual | BOOLEAN | 是否手动标记 |

---

## 六、核心交互流程

### 6.1 iOS 快捷捕获

```
用户在任意 App 中选中内容
        │
        ├─── 方式1: 长按上滑 → 系统 Drag & Drop
        │    （iPad 完整支持，iPhone 降级为 Share Sheet）
        │
        └─── 方式2: 点击分享 → NoteOne Share Extension
                │
                ▼
        弹出确认窗（精简版 UI）
        ┌─────────────────────────┐
        │  📎 预填内容预览         │
        │  🔗 来源: https://...   │
        │  🏷️ 建议标签: AI/LLM    │
        │                         │
        │  [ 取消 ]    [ 保存 ✓ ] │
        └─────────────────────────┘
                │
                ▼
        ┌─ 有网络 → 直接上传至后端
        │
        └─ 无网络 → 存入本地暂存队列
                     联网后自动批量同步
                │
                ▼
        后端异步处理：
        AI 打标 → 生成摘要 → 生成 embedding
```

### 6.2 macOS 全局快捷键捕获

```
用户按下 ⌘⇧N（可自定义）
        │
        ▼
悬浮输入窗出现（类似 Raycast 风格）
┌─────────────────────────────────────┐
│  NoteOne — 顺手记                    │
│  ┌─────────────────────────────────┐│
│  │ [自动粘贴剪贴板内容...]          ││
│  │                                 ││
│  └─────────────────────────────────┘│
│  来源: [自动检测当前前台应用/URL]     │
│  🏷️ 标签: [可选，AI 会自动补充]      │
│                                      │
│  ⏎ 保存    ⎋ 取消                   │
└─────────────────────────────────────┘
        │
        ▼
上传至后端 → 异步 AI 打标 + embedding
```

### 6.3 MCP 深度写作流程

```
用户在 Claude / AI 客户端中：
"基于我的笔记写一篇 LLM 推理优化的技术博客"
        │
        ▼
AI 调用 MCP: search_notes("LLM 推理优化")
        │
        ▼
MCP Server → 后端 API → pgvector 语义检索
返回相关笔记列表：
  - 笔记1: "FlashAttention 论文要点" [来源: arxiv.org, 2026-03]
  - 笔记2: "vLLM PagedAttention 解读" [来源: blog.vllm.ai, 2026-04]
  - 笔记3: "推理框架对比测试" [来源: 个人测试记录, 2026-05]
        │
        ▼
AI 综合多条笔记 + 自身知识，生成带引用的文章：
  "...FlashAttention 通过 IO 感知的精确注意力算法，
   将内存访问量降低至 O(N) [1]...
   
   [1] 张三, FlashAttention 论文要点, arxiv.org, 2026-03
   [2] 李四, vLLM PagedAttention 解读, blog.vllm.ai, 2026-04"
```

---

## 七、AI 功能矩阵

| 功能 | 触发方式 | 模型 | 说明 |
|------|----------|------|------|
| 自动打标 | 保存时异步 | Qwen-Turbo (默认) | 四维度标签：格式/主题/领域/模块 |
| 自动摘要 | 保存时异步 | Qwen-Turbo | 生成一句话摘要 |
| 自动标题 | 保存时异步 | Qwen-Turbo | 用户未填标题时自动生成 |
| Embedding | 保存时异步 | Qwen-Embedding | 用于向量语义检索 |
| 笔记总结 | App 内手动触发 | Qwen-Turbo | 按主题/时间段总结 |
| 数据统计 | App 内手动触发 | Qwen-Turbo | 主题分布、阅读趋势等 |
| 读书记录 | App 内手动触发 | Qwen-Turbo | 整合同一书籍/主题的笔记 |
| 深度写作 | MCP (外部 AI) | Claude 等大模型 | 基于笔记生成带引用的长文 |

**模型切换**：用户可在设置中配置自定义 API Key，切换到其他供应商（Anthropic / OpenAI / 其他）。

---

## 八、MCP Server 工具设计

```typescript
// 搜索笔记 — 语义检索 + 标签过滤 + 全文检索
search_notes(params: {
  query: string;          // 搜索关键词（语义匹配）
  tags?: string[];        // 标签过滤
  content_type?: string;  // 格式过滤
  date_range?: { from: string; to: string };
  limit?: number;         // 默认 20
})

// 获取单条笔记详情
get_note(params: { id: string })

// 列出所有标签（按维度分组）
list_tags(params: {
  dimension?: 'format' | 'topic' | 'domain' | 'module';
})

// 获取笔记统计信息
get_stats(params: {
  time_range?: { from: string; to: string };
})

// 按主题获取笔记摘要集
get_topic_summary(params: {
  topic: string;
  max_notes?: number;
})

// 创建写作草稿
create_writing_draft(params: {
  topic: string;              // 写作主题
  style?: string;             // 风格：技术博客/研究报告/读书笔记
  note_ids?: string[];        // 指定引用的笔记
  include_citations?: boolean; // 是否附带引用（默认 true）
})
```

---

## 九、开放与开源策略

### 开源部分
- iOS / macOS 客户端代码
- MCP Server
- 数据库 Schema 与 Migration
- Docker Compose 部署配置
- API 接口文档

### 非开源部分
- AI 打标流水线的 Prompt 工程
- 高级语义检索算法
- 运营侧功能与用户增长模块

### 部署方式
- **自部署**：`docker compose up` 一键启动（PostgreSQL + API + MCP Server）
- **托管版**：官方提供开箱即用的云服务

---

## 十、待细化事项

- [ ] iOS Drag & Drop 手势在 iPhone 上的降级方案验证
- [ ] 多用户数据隔离与权限设计
- [ ] 离线暂存队列的冲突解决策略（同一笔记多端编辑时）
- [ ] API Rate Limiting 与安全防护
- [ ] Qwen 模型具体版本选型与 Prompt 设计
- [ ] 用户自定义 API Key 的安全存储（加密方案）
- [ ] Apple Sign In 的服务端验证流程
- [ ] Embedding 模型选型（Qwen-Embedding / text-embedding-3-small）

---

## 十一、实现现状对照（v2.0）

> 截至 2026-06-15（迭代 6 后）。✅ 已实现 · 🔁 已实现但与原设计有出入(drifted) · 🟡 部分实现 · ⛔ 未实现。
> 权威实现细节见 [../ARCHITECTURE.md](../ARCHITECTURE.md)。

### 11.1 总体落地度
原始 v1.0 架构（多端客户端 + REST API + 双 MCP + pgvector + 异步 AI 流水线）**已基本落地并跑通**（两端 xcodebuild 通过、54 单测全绿）。主要演进集中在：默认模型、用户认证可用形态、以及一批 v1.0 未列出的新增能力（垃圾箱、失败重试、会话式 Notty、导出、注销、上传、SSRF 防护、拖拽、prompt 捕获）。

### 11.2 关键差异（与设计文档不符之处）

| 项 | 设计文档 (v1.0) | 实际实现 | 状态 |
|----|------------------|----------|------|
| 默认 Chat 模型 | Qwen-Turbo | `gpt-5.4-mini`（`config.ts` 缺省值，env 仍用 `QWEN_*` 命名、baseUrl 指向 DashScope） | 🔁drifted |
| Embedding 模型 | Qwen-Embedding（待选型） | `text-embedding-3-small`（1536 维），且**恒走默认 provider** 不随用户切换 | 🔁drifted |
| macOS 默认快捷键 | ⌘⇧N | 全局监听默认 **⌘⇧O**（可自定义）；⌘⇧N 为应用内菜单绑定 | 🔁drifted |
| note_status 枚举 | pending_ai / active / archived | 增加 **trashed / failed**（共 5 态） | ✅扩展 |
| tags 归属 | 全局四维度标签 | 改为 **user-scoped**（tags.user_id），旧全局标签兼容空 user_id | 🔁drifted |
| 用户 API Key 存储 | 加密存储（待定方案） | 当前**明文**存 `users.settings`（GET/导出已脱敏，落库未加密） | 🟡缺口 |

### 11.3 设计项 → 实现映射

| 设计章节 | 能力 | 状态 | 说明 |
|----------|------|------|------|
| §4.1-1 | iOS Share Extension | ✅ | 离线写 App Group，主 App 补传 |
| §2.3 / §6.1 | iOS 长按上滑即记 | 🟡 | 以**拖拽（onDrop/draggable）+ CFBundleDocumentTypes** 实现；iPhone 跨 App 受限，最完整入口仍是 Share Extension（iPad/visionOS 更完整） |
| §4.1-2 / §6.2 | macOS 全局快捷键悬浮捕获 | ✅ | FloatingPanel + 浏览器 meta + 选中文本 + 剪贴板图片 |
| §4.3 | REST API（认证/CRUD/打标/检索） | ✅ | Express 5 + Drizzle，端点见 ARCHITECTURE §4 |
| §4.4 / §八 | MCP Server | ✅+ | **双实现**：内嵌(直连 DB,7 工具含 CRUD) + 独立(HTTP 代理,5 只读) |
| §4.5 / §五 | pgvector + 四维标签数据模型 | ✅ | 另增 chat_sessions / chat_messages |
| §七 | AI 自动打标 / 摘要 / 标题 / Embedding | ✅ | 异步 `Promise.allSettled`，失败置 failed |
| §七 | 笔记总结 / 数据统计 / 读书记录 | 🟡 | 统计有 `/api/stats`；"总结/读书记录"由 Notty 会话承载，无独立 UI |
| §六.3 / §八 | MCP 深度写作（带引用长文） | 🟡 | `get_topic_summary` + `get_note` 引用块就绪；`create_writing_draft` 未实现 |
| §三 | Apple Sign In + JWT | ✅ | jose JWKS 验签；另有 dev-token 本地旁路 |
| §七 | 用户自定义 API Key 切换供应商 | ✅ | `/api/settings` 每用户 LLM 覆盖（Embedding 除外） |
| §九 | Docker 一键部署 | ✅ | docker-compose（pgvector + api） |

### 11.4 v1.0 未列出、现已新增的能力
- **垃圾箱体系**：软删 → 30 天 cron 硬删，恢复 / 立即永久删除。
- **失败重试**：`failed` 状态 + `/api/notes/:id/retry` + 客户端「重试」。
- **会话式 Notty**：持久化多会话 + 工具调用（read_note / search_notes / web_fetch）+ 历史压缩。
- **链接正文抓取**：创建笔记自动抓 URL 正文并回填 meta（带 SSRF 防护）。
- **图片上传**：`/api/uploads/image` + 静态服务 + 安全清理。
- **数据主权**：`/api/export`（ZIP）+ `/api/account`（注销级联硬删）。
- **prompt 捕获**：MCP `create_note(source_app)` → `#prompt` + `#{app}` 标签。
- **安全加固**：SSRF guard、限流、helmet、上传路径防护、生产配置守卫。
- **客户端**：主题系统、可自定义快捷键、MCP 一键安装、拖入/拖出。

### 11.5 §十「待细化事项」结案
- ✅ Apple Sign In 服务端验证流程（jose JWKS）
- ✅ Embedding 模型选型（`text-embedding-3-small`）
- ✅ 多用户数据隔离（全查询 user_id 限定 + tags 多租户）
- ✅ API Rate Limiting 与安全防护（限流 + SSRF + helmet + 上传防护）
- 🟡 用户 API Key 安全存储（已脱敏展示/导出，**落库仍明文**，待加密）
- ⛔ 离线多端编辑冲突解决策略（当前离线仅"新建"入队，无编辑冲突合并）
- 🟡 iOS Drag & Drop iPhone 降级（拖拽 + Share Extension 双路径，未做 iPhone 专门降级 UI）
- ⛔ Qwen 模型版本选型与 Prompt 工程（属非开源部分，未在本仓沉淀）

