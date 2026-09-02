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
});
