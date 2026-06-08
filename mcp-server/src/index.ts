import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = process.env.NOTEONE_API_URL || "http://localhost:3000";
const API_TOKEN = process.env.NOTEONE_TOKEN || "";

async function apiCall(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_TOKEN}`,
      ...options?.headers,
    },
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${await res.text()}`);
  return res.json();
}

const server = new McpServer({
  name: "noteone",
  version: "0.1.0",
});

server.tool(
  "search_notes",
  "搜索笔记 — 语义检索 + 标签过滤。返回与查询最相关的笔记列表，含来源、作者和日期信息。用于写作时查找相关素材。",
  {
    query: z.string().describe("搜索关键词（语义匹配）"),
    limit: z.number().optional().default(20).describe("返回数量上限"),
  },
  async ({ query, limit }) => {
    const data = await apiCall("/api/search", {
      method: "POST",
      body: JSON.stringify({ query, limit }),
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(data.results, null, 2) }] };
  },
);

server.tool(
  "get_note",
  "获取单条笔记的完整内容和元数据（标题、来源、作者、摘要等）",
  { id: z.string().describe("笔记 ID") },
  async ({ id }) => {
    const data = await apiCall(`/api/notes/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(data.note, null, 2) }] };
  },
);

server.tool(
  "list_tags",
  "列出所有标签，可按维度过滤（format=格式, topic=主题, domain=领域, module=模块）",
  {
    dimension: z.enum(["format", "topic", "domain", "module"]).optional().describe("按维度过滤"),
  },
  async ({ dimension }) => {
    const query = dimension ? `?dimension=${dimension}` : "";
    const data = await apiCall(`/api/tags${query}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(data.tags, null, 2) }] };
  },
);

server.tool(
  "list_notes",
  "列出用户的笔记列表，支持分页",
  {
    limit: z.number().optional().default(20).describe("每页数量"),
    offset: z.number().optional().default(0).describe("偏移量"),
  },
  async ({ limit, offset }) => {
    const data = await apiCall(`/api/notes?limit=${limit}&offset=${offset}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(data.notes, null, 2) }] };
  },
);

server.tool(
  "get_topic_summary",
  "按主题获取笔记摘要集，用于写作时快速了解某个领域的积累。返回每条笔记的标题、摘要、来源和日期。",
  {
    topic: z.string().describe("主题关键词"),
    max_notes: z.number().optional().default(10).describe("最大笔记数量"),
  },
  async ({ topic, max_notes }) => {
    const data = await apiCall("/api/search", {
      method: "POST",
      body: JSON.stringify({ query: topic, limit: max_notes }),
    });
    const results = Array.isArray(data.results) ? data.results : [];
    const summaries = results.map((n: any) => ({
      id: n.id,
      title: n.title,
      summary: n.ai_summary,
      source: n.source_url,
      author: n.author,
      date: n.created_at,
    }));
    return { content: [{ type: "text" as const, text: JSON.stringify(summaries, null, 2) }] };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("NoteOne MCP Server running on stdio");
}

main().catch(console.error);
