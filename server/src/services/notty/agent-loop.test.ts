import { describe, it, expect, vi, beforeEach } from "vitest";

const llmFetchMock = vi.hoisted(() => vi.fn());

vi.mock("../llm.js", () => ({
  llmFetch: llmFetchMock,
  apiEndpoint: (baseUrl: string, path: string) => `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`,
  getDefaultLLMConfig: () => ({ baseUrl: "http://test", apiKey: "sk-test", model: "test-model" }),
  assertConfigured: () => {},
  isLLMConfigured: () => true,
}));

import { AgentLoopAbortError, runAgentLoop, type ToolDefinition } from "./agent-loop.js";

function assistantMsg(content: string | null, toolCalls?: any[]) {
  return { choices: [{ message: { role: "assistant", content, tool_calls: toolCalls } }] };
}

function toolCall(id: string, name: string, args: Record<string, any>) {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

const tools: ToolDefinition[] = [{
  type: "function",
  function: { name: "echo", description: "echo", parameters: { type: "object", properties: {} } },
}];
const orderedTools: ToolDefinition[] = [
  { type: "function", function: { name: "list_blog_sources", description: "list", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "add_blog_source", description: "add", parameters: { type: "object", properties: {} } } },
];
const baseMessages = [{ role: "user", content: "hi" }];

/** Queue-backed llmFetch: each call shifts the next scripted response. */
function scriptResponses(responses: any[]) {
  const queue = [...responses];
  llmFetchMock.mockImplementation(async () => {
    if (queue.length === 0) throw new Error("unexpected extra LLM call");
    return queue.shift();
  });
}

beforeEach(() => {
  llmFetchMock.mockReset();
});

describe("runAgentLoop", () => {
  it("runs many tool rounds in one turn before the final reply", async () => {
    const rounds = 6;
    const echo = vi.fn(async (args: any) => `echo:${JSON.stringify(args)}`);
    const responses = Array.from({ length: rounds }, (_, i) =>
      assistantMsg(`第${i + 1}步`, [toolCall(`c${i}`, "echo", { i })]));
    responses.push(assistantMsg("最终答案"));
    scriptResponses(responses);

    const intermediates: any[] = [];
    const reply = await runAgentLoop(baseMessages as any, tools, { echo }, {
      llmConfig: { baseUrl: "http://test", apiKey: "sk-test", model: "test-model" } as any,
      maxIterations: 12,
      onIntermediateMessage: (m) => intermediates.push(m),
    });

    expect(reply).toBe("最终答案");
    expect(llmFetchMock).toHaveBeenCalledTimes(rounds + 1);
    expect(echo).toHaveBeenCalledTimes(rounds);
    // Mid-reply text survives on the emitted assistant messages.
    const emittedTexts = intermediates.filter((m) => m.role === "assistant").map((m) => m.content);
    expect(emittedTexts).toEqual(["第1步", "第2步", "第3步", "第4步", "第5步", "第6步"]);
    // The last LLM call carries every tool result from the previous rounds.
    const lastBody = llmFetchMock.mock.calls[rounds][2];
    const toolResults = lastBody.messages.filter((m: any) => m.role === "tool");
    expect(toolResults).toHaveLength(rounds);
  });

  it("parses DSML tool calls from content and keeps the leading text", async () => {
    const echo = vi.fn(async (args: any) => `echo:${args.q}`);
    const dsmlContent = [
      "我先看看页面源码。",
      "<｜DSML｜tool_calls>",
      "<｜DSML｜invoke name=\"echo\">",
      "<｜DSML｜parameter name=\"q\" string=\"true\">rss</｜DSML｜parameter>",
      "</｜DSML｜invoke>",
      "</｜DSML｜tool_calls>",
    ].join("\n");
    scriptResponses([assistantMsg(dsmlContent), assistantMsg("done")]);

    const intermediates: any[] = [];
    const reply = await runAgentLoop(baseMessages as any, tools, { echo }, {
      llmConfig: { baseUrl: "http://test", apiKey: "sk-test", model: "test-model" } as any,
      onIntermediateMessage: (m) => intermediates.push(m),
    });

    expect(reply).toBe("done");
    expect(echo).toHaveBeenCalledWith({ q: "rss" });
    // Leading text survives; DSML markup is stripped from content.
    const first = intermediates.find((m) => m.role === "assistant");
    expect(first.content).toBe("我先看看页面源码。");
    expect(first.content).not.toContain("DSML");
    // The follow-up LLM call sees the converted tool_calls + tool result.
    const secondBody = llmFetchMock.mock.calls[1][2];
    const assistant = secondBody.messages.find((m: any) => m.role === "assistant" && m.tool_calls?.length);
    expect(assistant.tool_calls[0].function.name).toBe("echo");
    expect(secondBody.messages.some((m: any) => m.role === "tool")).toBe(true);
  });

  it("supports long tasks beyond the historical cap when no cap is set", async () => {
    const rounds = 25; // beyond any historical cap (3/5/16)
    const responses = Array.from({ length: rounds }, (_, i) =>
      assistantMsg(`第${i + 1}步`, [toolCall(`c${i}`, "echo", { i })]));
    responses.push(assistantMsg("done"));
    scriptResponses(responses);

    const reply = await runAgentLoop(baseMessages as any, tools, { echo: async () => "ok" }, {
      llmConfig: { baseUrl: "http://test", apiKey: "sk-test", model: "test-model" } as any,
    });

    expect(reply).toBe("done");
    expect(llmFetchMock).toHaveBeenCalledTimes(rounds + 1);
  });

  it("injects a wrap-up instruction when the iteration budget is exhausted", async () => {
    const echo = vi.fn(async () => "ok");
    // Model keeps calling tools forever; budget is 2 rounds.
    scriptResponses([
      assistantMsg("第一步", [toolCall("c0", "echo", { i: 0 })]),
      assistantMsg("第二步", [toolCall("c1", "echo", { i: 1 })]),
      assistantMsg("进度总结"),
    ]);

    const reply = await runAgentLoop(baseMessages as any, tools, { echo }, {
      llmConfig: { baseUrl: "http://test", apiKey: "sk-test", model: "test-model" } as any,
      maxIterations: 2,
    });

    expect(reply).toBe("进度总结");
    expect(llmFetchMock).toHaveBeenCalledTimes(3);
    const wrapUpBody = llmFetchMock.mock.calls[2][2];
    // The wrap-up call has no tools and carries an explicit budget-exceeded system message.
    expect(wrapUpBody.tools).toBeUndefined();
    const sysMsg = wrapUpBody.messages.filter((m: any) => m.role === "system").pop();
    expect(sysMsg.content).toContain("上限");
  });

  it("strips stray DSML markup from a text-only final reply", async () => {
    const content = "答案正文<｜DSML｜tool_calls>残留标记</｜DSML｜tool_calls>";
    scriptResponses([assistantMsg(content)]);

    const reply = await runAgentLoop(baseMessages as any, tools, { echo: async () => "x" }, {
      llmConfig: { baseUrl: "http://test", apiKey: "sk-test", model: "test-model" } as any,
    });

    expect(reply).toBe("答案正文");
  });

  it("preserves write barriers and invalidates cached reads", async () => {
    const events: string[] = [];
    let sourceCount = 0;
    const handlers = {
      list_blog_sources: async () => {
        events.push(`list:${sourceCount}`);
        return String(sourceCount);
      },
      add_blog_source: async () => {
        events.push("add");
        sourceCount++;
        return "added";
      },
    };
    scriptResponses([
      assistantMsg("updating", [
        toolCall("r1", "list_blog_sources", {}),
        toolCall("w1", "add_blog_source", { name: "x" }),
        toolCall("r2", "list_blog_sources", {}),
      ]),
      assistantMsg("done"),
    ]);

    await runAgentLoop(baseMessages as any, orderedTools, handlers, {
      llmConfig: { baseUrl: "http://test", apiKey: "sk-test", model: "test-model" } as any,
      cacheScope: "ordering-test",
    });

    expect(events).toEqual(["list:0", "add", "list:1"]);
    const secondBody = llmFetchMock.mock.calls[1][2];
    expect(secondBody.messages.filter((m: any) => m.role === "tool").map((m: any) => m.content))
      .toEqual(["0", "added", "1"]);
  });

  it("isolates read-result caches by user scope", async () => {
    const handler = vi.fn(async () => "first-user");
    scriptResponses([assistantMsg(null, [toolCall("a", "list_blog_sources", {})]), assistantMsg("done")]);
    await runAgentLoop(baseMessages as any, orderedTools, { list_blog_sources: handler }, {
      llmConfig: { baseUrl: "http://test", apiKey: "sk-test", model: "test-model" } as any,
      cacheScope: "user-a",
    });

    handler.mockResolvedValueOnce("second-user");
    scriptResponses([assistantMsg(null, [toolCall("b", "list_blog_sources", {})]), assistantMsg("done")]);
    await runAgentLoop(baseMessages as any, orderedTools, { list_blog_sources: handler }, {
      llmConfig: { baseUrl: "http://test", apiKey: "sk-test", model: "test-model" } as any,
      cacheScope: "user-b",
    });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("accepts omitted options without crashing", async () => {
    scriptResponses([assistantMsg("done")]);
    await expect(runAgentLoop(baseMessages as any, tools, { echo: async () => "ok" }))
      .resolves.toBe("done");
  });

  it("normalizes missing tool-call ids and object arguments", async () => {
    const echo = vi.fn(async (args: any) => JSON.stringify(args));
    scriptResponses([
      assistantMsg(null, [{ type: "function", function: { name: "echo", arguments: { value: 1 } } }]),
      assistantMsg("done"),
    ]);

    await runAgentLoop(baseMessages as any, tools, { echo }, {
      llmConfig: { baseUrl: "http://test", apiKey: "sk-test", model: "test-model" } as any,
    });

    const secondBody = llmFetchMock.mock.calls[1][2];
    const assistant = secondBody.messages.find((m: any) => m.role === "assistant" && m.tool_calls?.length);
    const toolResult = secondBody.messages.find((m: any) => m.role === "tool");
    expect(assistant.tool_calls[0].id).toMatch(/^call_/);
    expect(toolResult.tool_call_id).toBe(assistant.tool_calls[0].id);
    expect(echo).toHaveBeenCalledWith({ value: 1 });
  });

  it("keeps tool-call ids unique across model rounds", async () => {
    scriptResponses([
      assistantMsg(null, [toolCall("reused-id", "echo", { value: 1 })]),
      assistantMsg(null, [toolCall("reused-id", "echo", { value: 2 })]),
      assistantMsg("done"),
    ]);
    const starts: string[] = [];

    await runAgentLoop(baseMessages as any, tools, { echo: async () => "ok" }, {
      llmConfig: { baseUrl: "http://test", apiKey: "sk-test", model: "test-model" } as any,
      onToolStart: ({ callId }) => starts.push(callId),
    });

    expect(starts[0]).toBe("reused-id");
    expect(starts[1]).toMatch(/^call_/);
    expect(new Set(starts).size).toBe(2);
  });

  it("keeps duplicate same-name tool activity paired by call id", async () => {
    scriptResponses([
      assistantMsg(null, [
        toolCall("same-name-a", "list_blog_sources", { value: 1 }),
        toolCall("same-name-b", "list_blog_sources", { value: 2 }),
      ]),
      assistantMsg("done"),
    ]);
    const starts: string[] = [];
    const ends: string[] = [];

    await runAgentLoop(baseMessages as any, orderedTools, {
      list_blog_sources: async ({ value }) => {
        if (value === 1) await new Promise((resolve) => setTimeout(resolve, 10));
        return String(value);
      },
    }, {
      llmConfig: { baseUrl: "http://test", apiKey: "sk-test", model: "test-model" } as any,
      cacheScope: "duplicate-name-test",
      onToolStart: ({ callId }) => starts.push(callId),
      onToolEnd: ({ callId }) => ends.push(callId),
    });

    expect(starts).toEqual(["same-name-a", "same-name-b"]);
    expect(ends).toEqual(["same-name-b", "same-name-a"]);
  });

  it("rejects cancellation instead of returning assistant content", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(runAgentLoop(baseMessages as any, tools, { echo: async () => "ok" }, {
      llmConfig: { baseUrl: "http://test", apiKey: "sk-test", model: "test-model" } as any,
      signal: controller.signal,
    })).rejects.toBeInstanceOf(AgentLoopAbortError);
    expect(llmFetchMock).not.toHaveBeenCalled();
  });

  it("does not misclassify a provider timeout as a user cancellation", async () => {
    llmFetchMock.mockRejectedValueOnce(new DOMException("provider timeout", "AbortError"));

    await expect(runAgentLoop(baseMessages as any, tools, { echo: async () => "ok" }, {
      llmConfig: { baseUrl: "http://test", apiKey: "sk-test", model: "test-model" } as any,
    })).rejects.toMatchObject({ name: "AbortError", message: "provider timeout" });
  });

  it("marks failed tool executions as errors in lifecycle events", async () => {
    scriptResponses([
      assistantMsg(null, [toolCall("failed-call", "echo", {})]),
      assistantMsg("done"),
    ]);
    const endings: Array<{ callId: string; isError: boolean }> = [];

    await runAgentLoop(baseMessages as any, tools, { echo: async () => { throw new Error("boom"); } }, {
      llmConfig: { baseUrl: "http://test", apiKey: "sk-test", model: "test-model" } as any,
      onToolEnd: ({ callId, isError }) => endings.push({ callId, isError }),
    });

    expect(endings).toEqual([{ callId: "failed-call", isError: true }]);
  });
});
