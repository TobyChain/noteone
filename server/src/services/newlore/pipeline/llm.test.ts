import { describe, expect, it } from "vitest";
import { extractJson, repairTruncatedJson, truncateToLastCompleteField } from "./llm.js";

describe("repairTruncatedJson", () => {
  it("returns complete JSON unchanged (up to last valid })", () => {
    const s = '{"a": 1, "b": [2, 3]}';
    expect(repairTruncatedJson(s)).toBe(s);
  });

  it("closes an unterminated string and braces", () => {
    const s = '{"a": "hel';
    const repaired = repairTruncatedJson(s);
    expect(JSON.parse(repaired)).toEqual({ a: "hel" });
  });

  it("closes nested objects", () => {
    const s = '{"a": {"b": {"c": 3';
    const repaired = repairTruncatedJson(s);
    expect(JSON.parse(repaired)).toEqual({ a: { b: { c: 3 } } });
  });

  it("ignores braces inside strings", () => {
    const s = '{"a": "{[not json]}", "b": 1}';
    expect(JSON.parse(repairTruncatedJson(s))).toEqual({ a: "{[not json]}", b: 1 });
  });

  it("handles escaped quotes inside strings", () => {
    const s = '{"a": "he said \\"hi';
    const repaired = repairTruncatedJson(s);
    expect(JSON.parse(repaired)).toEqual({ a: 'he said "hi' });
  });
});

describe("truncateToLastCompleteField", () => {
  it("drops the trailing incomplete field", () => {
    const s = '{"a": 1, "b": "complete", "c": "trunca';
    const result = truncateToLastCompleteField(s);
    expect(result).not.toBeNull();
    expect(JSON.parse(result!)).toEqual({ a: 1, b: "complete" });
  });

  it("returns null when there is no top-level comma", () => {
    expect(truncateToLastCompleteField('{"a": "x')).toBeNull();
  });
});

describe("extractJson", () => {
  it("strips markdown fences", () => {
    const s = '```json\n{"a": 1}\n```';
    expect(JSON.parse(extractJson(s))).toEqual({ a: 1 });
  });

  it("extracts JSON embedded in prose", () => {
    const s = 'Here is the result: {"a": 1, "b": "x"} hope it helps';
    expect(JSON.parse(extractJson(s))).toEqual({ a: 1, b: "x" });
  });

  it("repairs truncated output", () => {
    const s = '```json\n{"trans_abs": "这是一段被截断的翻译，长度超过十个字符", "compressed": "摘要", "keywords": ["a", "b"], "sub_topic": "大模型算法", "recommendation": "推';
    const parsed = JSON.parse(extractJson(s));
    expect(parsed.trans_abs).toContain("翻译");
    expect(parsed.keywords).toEqual(["a", "b"]);
  });

  it("returns raw text when no JSON present", () => {
    expect(extractJson("no json here")).toBe("no json here");
  });
});
