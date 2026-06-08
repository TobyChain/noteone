# NoteOne MCP Server

让 AI 助手（如 Claude）直接访问你的 NoteOne 笔记库，实现基于个人知识库的深度写作。

## 配置

### Claude Desktop

在 `~/Library/Application Support/Claude/claude_desktop_config.json` 中添加:

```json
{
  "mcpServers": {
    "noteone": {
      "command": "node",
      "args": ["/path/to/noteone/mcp-server/dist/index.js"],
      "env": {
        "NOTEONE_API_URL": "http://localhost:3000",
        "NOTEONE_TOKEN": "your-jwt-token"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add noteone node /path/to/noteone/mcp-server/dist/index.js \
  -e NOTEONE_API_URL=http://localhost:3000 \
  -e NOTEONE_TOKEN=your-jwt-token
```

## 可用工具

| 工具 | 描述 |
|------|------|
| `search_notes` | 语义搜索笔记，返回最相关的笔记列表 |
| `get_note` | 获取单条笔记的完整内容和元数据 |
| `list_notes` | 列出用户笔记，支持分页 |
| `list_tags` | 列出标签，按维度过滤 |
| `get_topic_summary` | 按主题获取笔记摘要集 |

## 使用示例

在 Claude 中说：
> "基于我的笔记写一篇关于 LLM 推理优化的技术博客"

Claude 会自动调用 `search_notes` 和 `get_note` 检索相关笔记，生成带引用的文章。
