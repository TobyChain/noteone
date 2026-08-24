# NoteOne MCP Server

将 NoteOne 的笔记能力暴露为 MCP 工具，供 Claude Code、VS Code Copilot、Codex、Gemini CLI 等 AI Agent 直接使用。

## 可用工具

| 工具 | 说明 |
|------|------|
| `list_notes` | 列出笔记（分页） |
| `get_note` | 获取笔记完整内容 |
| `create_note` | 创建笔记（AI 自动生成标题/标签）。允许传 `source_app` 记录调用方名字 |
| `update_note` | 更新笔记标题或内容 |
| `delete_note` | 删除笔记 |
| `search_notes` | 语义搜索（向量相似度） |
| `list_tags` | 列出所有标签 |

### 记录用户与 AI 的 prompt

`create_note` 额外接受一个可选的 `source_app` 参数。传入后：

- 笔记仍为普通 `text` 类型，**不新增 contentType 枚举**；
- 服务端同步打上两个 `format` 维度标签：`#prompt` + `#{source_app}`（如 `#claude` / `#cursor`，全部小写、去除特殊字符）；
- 笔记的 `sourceApp` 字段同步填入原文。

读取路径不变：`list_notes` / `get_note` / `search_notes` 直接返回 prompt 类笔记，调用方可以按 `#prompt` 标签过滤。

调用示例（AI 在推理中主动存档本次 prompt）：

```json
{
  "name": "create_note",
  "arguments": {
    "content": "你是资深的 Swift 全栈工程师，请帮我重构这个梨型控件…",
    "source_app": "Claude"
  }
}
```

设计原则：**渐进式披露**——不在 system prompt 预填全量笔记，让 AI 通过 list_notes/get_note 按需拉取；记录侧也复用同一套读取接口，不为 prompt 另起 record_prompt/list_prompts 工具。

## 环境变量

在 `.env` 中添加：

```env
MCP_USER_ID=你的用户ID
```

获取用户 ID：登录 NoteOne 后在设置页面查看，或查询数据库 `SELECT id FROM users LIMIT 1;`

## 一键安装

### Claude Code

```bash
claude mcp add noteone -- npx tsx /path/to/noteone/server/src/mcp.ts
```

或编辑 `~/.claude/settings.json`：

```json
{
  "mcpServers": {
    "noteone": {
      "command": "npx",
      "args": ["tsx", "/path/to/noteone/server/src/mcp.ts"],
      "cwd": "/path/to/noteone/server",
      "env": {
        "DATABASE_URL": "postgres://noteone:noteone@localhost:5432/noteone",
        "MCP_USER_ID": "你的用户ID",
        "QWEN_API_KEY": "你的API密钥",
        "QWEN_BASE_URL": "https://yunwu.ai/v1"
      }
    }
  }
}
```

### VS Code (GitHub Copilot)

编辑 `.vscode/mcp.json`：

```json
{
  "servers": {
    "noteone": {
      "command": "npx",
      "args": ["tsx", "/path/to/noteone/server/src/mcp.ts"],
      "cwd": "/path/to/noteone/server",
      "env": {
        "DATABASE_URL": "postgres://noteone:noteone@localhost:5432/noteone",
        "MCP_USER_ID": "你的用户ID",
        "QWEN_API_KEY": "你的API密钥",
        "QWEN_BASE_URL": "https://yunwu.ai/v1"
      }
    }
  }
}
```

### Cursor

编辑 `~/.cursor/mcp.json`，格式同 VS Code。

### Gemini CLI

```bash
gemini mcp add noteone -- npx tsx /path/to/noteone/server/src/mcp.ts
```

### Codex

```bash
codex --mcp-config '{"noteone":{"command":"npx","args":["tsx","/path/to/noteone/server/src/mcp.ts"]}}'
```

## 测试

```bash
cd /path/to/noteone/server
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | npx tsx src/mcp.ts
```

## 用法示例

在任意 AI Agent 中可以这样使用：

- "帮我记录一条：今天学到了 RAG 的三种检索策略"
- "搜索我关于 SwiftUI 的笔记"
- "列出所有标签"
- "把这条笔记的标题改成更简洁的"
