import { describe, expect, it } from "vitest";
import { sanitizeToolMessageGroups, type ContextMessage } from "./context-manager.js";

function call(id: string) {
  return { id, type: "function", function: { name: "fetch", arguments: "{}" } };
}

describe("sanitizeToolMessageGroups", () => {
  it("keeps a complete multi-tool group", () => {
    const messages: ContextMessage[] = [
      { role: "assistant", content: "checking", tool_calls: [call("a"), call("b")] },
      { role: "tool", content: "A", tool_call_id: "a" },
      { role: "tool", content: "B", tool_call_id: "b" },
      { role: "assistant", content: "done" },
    ];

    expect(sanitizeToolMessageGroups(messages)).toEqual(messages);
  });

  it("drops all tool results when a multi-tool group is incomplete", () => {
    const messages: ContextMessage[] = [
      { role: "assistant", content: "checking", tool_calls: [call("a"), call("b")] },
      { role: "tool", content: "A", tool_call_id: "a" },
      { role: "user", content: "continue" },
    ];

    expect(sanitizeToolMessageGroups(messages)).toEqual([
      { role: "assistant", content: "checking", tool_calls: undefined },
      { role: "user", content: "continue" },
    ]);
  });

  it("drops orphaned tool messages", () => {
    expect(sanitizeToolMessageGroups([
      { role: "tool", content: "orphan", tool_call_id: "missing" },
      { role: "user", content: "hello" },
    ])).toEqual([{ role: "user", content: "hello" }]);
  });

  it("repairs legacy groups whose equal timestamps put tool results before the assistant", () => {
    const assistant = { role: "assistant", content: "checking", tool_calls: [call("a"), call("b")] };
    const toolA = { role: "tool", content: "A", tool_call_id: "a" };
    const toolB = { role: "tool", content: "B", tool_call_id: "b" };

    expect(sanitizeToolMessageGroups([toolB, assistant, toolA])).toEqual([assistant, toolA, toolB]);
  });

  it("matches repeated legacy tool-call ids by occurrence", () => {
    const firstAssistant = { role: "assistant", content: "first", tool_calls: [call("same")] };
    const secondAssistant = { role: "assistant", content: "second", tool_calls: [call("same")] };
    const firstTool = { role: "tool", content: "one", tool_call_id: "same" };
    const secondTool = { role: "tool", content: "two", tool_call_id: "same" };

    expect(sanitizeToolMessageGroups([firstTool, firstAssistant, secondTool, secondAssistant]))
      .toEqual([firstAssistant, firstTool, secondAssistant, secondTool]);
  });
});
