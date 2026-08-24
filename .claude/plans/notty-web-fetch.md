# Plan: Notty Web Fetch 工具 + 新笔记自动抓取

## Context

用户希望：
1. Notty 在对话中遇到链接时，能主动获取页面内容
2. 新建笔记带 sourceUrl 时，pipeline 自动抓取网页内容用于更好的 AI 分析
3. 笔记的自动抓取是独立的 pipeline 操作，不进入 Notty 对话 session

当前：LLM 服务不支持 tool calling，pipeline 不使用 sourceUrl，rawContent 字段未使用。

## 方案（纯后端，零客户端修改）

### 1. 新建 `server/src/services/web-fetch.ts`
- `fetchUrlContent(url, maxLength=15000)` → `{ url, title, content, error? }`
- 10 秒超时，regex 去 HTML，仅处理 text/html 和 text/plain

### 2. 修改 `server/src/services/llm.ts`
- 新增 `chatCompletionWithTools(messages, tools, toolHandlers)`
- 实现 tool-calling 循环（最多 3 轮）
- 不修改现有 `chatCompletion`

### 3. 修改 `server/src/routes/chat-sessions.ts`
- 定义 web_fetch 工具 + handler
- system prompt 添加工具说明
- 替换为 `chatCompletionWithTools()`

### 4. 修改 `server/src/services/pipeline.ts`
- 新增 sourceUrl 参数，有链接时自动抓取
- 抓取内容存入 rawContent，拼接后传给 enrichment/tagging

### 5. 修改 `server/src/routes/notes.ts`（1 行）
- 传递 sourceUrl 到 processNote

### 6. 修改 `server/src/services/enrichment.ts`（2 行）
- 增大内容截断限制

## 验证
- `npx tsc --noEmit` 通过
- 带 URL 笔记创建后检查 rawContent 和 AI 结果
- Notty 对话发 URL 后确认自动抓取
