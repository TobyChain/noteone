# NoteOne AI 系统优化方案

> 基于 oh-my-pi（coding CLI）与 VS Code（coding IDE）的 MCP/Skill/Tool 管理及 Agent 架构对比分析。
> 日期：2026-07-22

## 现状问题总结

| # | 问题 | 位置 | 影响 |
|---|---|---|---|
| 1 | 聊天全程阻塞，无流式响应 | `agent-loop.ts` + `llm.ts` | 5 轮工具调用阻塞 30-60s，客户端无反馈 |
| 2 | NewSee 6 模块串行执行 | `runner.ts:98-114` | 总耗时 = 6 模块之和（6-30 分钟） |
| 3 | 向量搜索 SQL 三处重复 | `mcp.ts` / `tools.ts` / `routes/search.ts` | 改一处漏两处 |
| 4 | 压缩用全局 LLM 配置 | `session-service.ts:143` | 用户配置的模型未被使用 |
| 5 | 中间消息逐条插入（N+1） | `session-service.ts:86-94` | 每轮 N 次 DB 往返 |
| 6 | 系统提示每轮全量重发 | `prompt-builder.ts` | 200+ 笔记索引 ~30KB，无 KV 缓存利用 |
| 7 | 工具全部串行执行 | `agent-loop.ts` | 只读工具（read_note ×3）也排队 |
| 8 | Doom-loop 仅检测 3 次相同 | `agent-loop.ts:79-82` | A→B→A→B 循环无法检测 |
| 9 | 无请求取消传播 | `agent-loop.ts` + `chat-sessions.ts` | 用户断开后继续消耗 token |
| 10 | `read_note` 无分块 | `tools.ts:85-107` | 大笔记 50K+ token 撑爆上下文 |
| 11 | `mergePipelineReport` 串行读 | `pipeline/index.ts:120` | 6 个独立 readFile 排队 |
| 12 | 每消息重建工具包 | `session-service.ts:62` | 静态定义重复构造 |

## Phase 1：快速收益（改动小、收益明确）

### 1.1 向量搜索抽公共函数
- 新建 `server/src/services/note-search.ts`
- 导出 `searchNotesByEmbedding(userId, vector, {limit?, threshold?})`
- 替换 `mcp.ts:207-216`、`tools.ts:128-137`、`routes/search.ts:35-48` 三处

### 1.2 压缩传用户 LLM 配置
- `session-service.ts:143`：`chatCompletion` → 使用第 58 行已解析的 `chatConfig`

### 1.3 中间消息批量插入
- `session-service.ts:86-94`：循环 `tx.insert` → 单次 `db.insert(chatMessages).values([...all])`

### 1.4 mergePipelineReport 并行读
- `pipeline/index.ts:120-122`：`for...of await readFile` → `Promise.all(modules.map(readFile))`

### 1.5 read_note 加 offset/limit
- `tools.ts` read_note 参数增加 `offset?`、`limit?`（按行），默认返回全文
- 超 200 行时提示 LLM 可用 offset/limit 分段读取

## Phase 2：Agent Loop 增强

### 2.1 SSE 流式响应
- `routes/chat-sessions.ts`：`POST /:id/messages` 改为 SSE（`Content-Type: text/event-stream`）
- `llm.ts`：`llmFetch` 增加 `stream: true` 选项，返回 `AsyncIterable<Chunk>`
- `agent-loop.ts`：接受 `onToken(chunk)` 回调，每轮工具调用状态推送 `event: tool_start/tool_end`
- 客户端（SwiftUI）：`URLSession` SSE 解析，逐 token 渲染

### 2.2 工具并发调度
- 工具定义增加 `concurrency: "shared" | "exclusive"`（默认 shared）
- `agent-loop.ts`：`executeToolCalls` 用 `lastExclusive + sharedTasks` promise 链
  - shared 工具并发执行（read_note、search_notes、web_fetch）
  - exclusive 工具串行（run_command、schedule_task）
- 参考 oh-my-pi 的调度器实现

### 2.3 AbortSignal 传播
- `runAgentLoop` 签名增加 `signal?: AbortSignal`
- 每轮迭代开始 + 每个工具调用前检查 `signal.aborted`
- `routes/chat-sessions.ts`：`req.on("close", () => controller.abort())`
- `llmFetch` 的 `AbortController` 与外部 signal 组合（`AbortSignal.any`）

### 2.4 Doom-loop 增强
- 保留现有 3 次相同检测
- 新增：2 轮 A→B→A→B 交替检测（滑动窗口 4，检查 `fp[i]===fp[i-2] && fp[i-1]===fp[i-3]`）
- 新增：思维循环检测——连续 3 轮 assistant 文本 trigram 重叠 >0.8 时中断
- 所有重采样路径加上限（`MAX_ESCALATIONS = 3`）

## Phase 3：上下文与缓存优化

### 3.1 系统提示稳定前缀
- `prompt-builder.ts`：系统提示拆分为 `[stablePrefix, dynamicSuffix]`
  - stablePrefix：角色定义 + 工具说明（按名称排序，字节稳定）
  - dynamicSuffix：笔记索引 + 用户特定信息
- `llm.ts`：对支持 `cache_control` 的 provider（Anthropic/OpenAI），在 stablePrefix 末尾标记缓存断点
- 工具定义排序后冻结，MCP 工具变更时才重建

### 3.2 工具注册表单例
- 新建 `server/src/services/tool-registry.ts`
- `ToolRegistry` 单例：`Map<string, ToolDefinition & {handler, concurrency}>`
- 按 source 分组：builtin / mcp / ascan / local
- `buildNottyToolkit` 改为从注册表读取，不再每消息重建
- MCP 工具变更时事务性替换（快照 → 删除 → 插入 → 失败回滚）

### 3.3 工具结果压缩
- 大笔记（>5000 字符）自动截断 + 提示"使用 offset/limit 读取剩余"
- 相同工具+参数结果缓存（`Map<string, {result, timestamp}>`，5 分钟 TTL）
- 参考 VS Code `IToolResultCompressor`：跳过 JSON/YAML 结构化数据

## Phase 4：NewSee Pipeline 并行化

### 4.1 模块并行执行
- `runner.ts`：`for...of await` → `Promise.allSettled(modules.map(m => runModule(m)))`
- 共享 `PipelineLLM` 实例（全局信号量 `maxConcurrency=5`），避免 6×5=30 并发
- `pipeline/index.ts`：`buildContext` 接受外部 `PipelineLLM` 注入

### 4.2 进度推送
- `runner.ts`：`startAscanSupplement` 增加 `onProgress(module, stage, pct)` 回调
- `routes/ascan.ts`：`GET /api/ascan/status` 增加 SSE 选项（`Accept: text/event-stream`）
- 客户端轮询 → SSE 实时进度

## Phase 5：MCP 增强（长期）

### 5.1 工具定义缓存
- MCP 工具列表持久化到 `{dataDir}/mcp-tool-cache.json`
- 启动时先返回缓存工具（`DeferredMCPTool`），后台异步连接
- 参考 oh-my-pi 250ms 快速启动门

### 5.2 崩溃熔断
- 30s 内 5 次重连 → 暂停自动重连 60s
- 参考 oh-my-pi `RECONNECT_BURST_LIMIT`

### 5.3 会话树结构
- `chat_messages` 增加 `parent_id` 列（drizzle 迁移 0009）
- 支持对话分支与回溯
- 压缩改为结构化交接文档（目标/约束/进度/决策/下一步）

## 执行顺序

```
Phase 1（快速收益）→ Phase 2.3（AbortSignal）→ Phase 2.2（工具并发）
→ Phase 4（NewSee 并行）→ Phase 2.1（SSE 流式）→ Phase 2.4（Doom-loop）
→ Phase 3（上下文缓存）→ Phase 5（MCP 增强）
```

Phase 1 全部可在半天内完成。Phase 2-4 约 2-3 天。Phase 5 为长期演进。

## 验证基准

- Phase 1：`npm test` 全通过 + 手动验证搜索/压缩/批量插入
- Phase 2：SSE 端点 curl 验证逐 token 输出；并发调度用 read_note ×3 验证并行
- Phase 3：对比优化前后同一对话的 prompt token 数（期望稳定前缀命中率 >80%）
- Phase 4：同一日期跑 NewSee，对比串行 vs 并行总耗时（期望 ≈ 最慢单模块）
