import { describe, expect, it } from "vitest";
import { SHARED_PREAMBLE, buildCachedPrompt, preferenceHint } from "./prompts.js";

describe("buildCachedPrompt", () => {
  it("returns a [system, user] pair in that order", () => {
    const out = buildCachedPrompt("SCHEMA_A", "var-1");
    expect(out).toHaveLength(2);
    expect(out[0].role).toBe("system");
    expect(out[1].role).toBe("user");
  });

  it("puts the shared preamble + module schema in the system message", () => {
    const out = buildCachedPrompt("SCHEMA_A", "var-1");
    expect(out[0].content.startsWith(SHARED_PREAMBLE)).toBe(true);
    expect(out[0].content).toContain("SCHEMA_A");
  });

  it("puts the variable verbatim in the user message, never in system", () => {
    const variable = "UNIQUE_VARIABLE_MARKER_42";
    const out = buildCachedPrompt("SCHEMA_A", variable);
    expect(out[1].content).toBe(variable);
    expect(out[0].content).not.toContain(variable);
  });

  it("keeps the system prefix byte-identical across calls with the same schema", () => {
    // Cache hits require an identical prefix regardless of the variable tail.
    const a = buildCachedPrompt("SCHEMA_A", "var-1");
    const b = buildCachedPrompt("SCHEMA_A", "var-2-completely-different");
    expect(a[0].content).toBe(b[0].content);
    expect(a[0]).toEqual(b[0]);
  });

  it("produces a different system message when the schema differs", () => {
    const a = buildCachedPrompt("SCHEMA_A", "var-1");
    const b = buildCachedPrompt("SCHEMA_B", "var-1");
    expect(a[0].content).not.toBe(b[0].content);
  });
});

describe("SHARED_PREAMBLE", () => {
  it("is a substantial stable prefix (rough cache-threshold sanity)", () => {
    expect(typeof SHARED_PREAMBLE).toBe("string");
    expect(SHARED_PREAMBLE.length).toBeGreaterThan(1000);
  });

  it("contains the shared editorial/scoring scaffolding", () => {
    expect(SHARED_PREAMBLE).toContain("壹铃·新知");
    expect(SHARED_PREAMBLE).toContain("评分维度");
    expect(SHARED_PREAMBLE).toContain("JSON");
  });
});

describe("preferenceHint", () => {
  it("is empty without preferences", () => expect(preferenceHint()).toBe(""));
  it("marks preferences as soft ranking signals", () => {
    const hint = preferenceHint({ focus: "agent harness", topics: "memory" });
    expect(hint).toContain("agent harness");
    expect(hint).toContain("软排序");
    expect(hint).toContain("不能因此淘汰");
  });
});
