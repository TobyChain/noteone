import { describe, expect, it } from "vitest";
import { localToolDefinitions, makeLocalHandlers } from "./local-tools.js";

describe("local tools", () => {
  it("does not expose an arbitrary shell command tool", () => {
    expect(localToolDefinitions.map((tool) => tool.function.name)).not.toContain("run_command");
    expect(makeLocalHandlers()).not.toHaveProperty("run_command");
  });

  it("rejects paths outside the allowed user directories", async () => {
    const result = await makeLocalHandlers().read_file({ path: "/etc/passwd" });
    expect(result).toContain("不在允许目录内");
  });
});
