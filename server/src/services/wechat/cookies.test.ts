import { describe, expect, it } from "vitest";
import { cookieHeaderFrom, parseSetCookies } from "./cookies.js";

describe("parseSetCookies", () => {
  it("parses name/value and ignores attributes", () => {
    const result = parseSetCookies([
      "slave_sid=abc123; Path=/; HttpOnly; Secure",
      "bizuin=456; Domain=.qq.com; Expires=Wed, 01 Jan 2027 00:00:00 GMT",
    ]);
    expect(result).toEqual([
      { name: "slave_sid", value: "abc123" },
      { name: "bizuin", value: "456" },
    ]);
  });

  it("dedupes by cookie name, last one wins", () => {
    const result = parseSetCookies(["a=1", "a=2; Path=/"]);
    expect(result).toEqual([{ name: "a", value: "2" }]);
  });

  it("handles values containing '='", () => {
    const result = parseSetCookies(["fakeid=MzA3MzI4MjgzMw==; Path=/"]);
    expect(result).toEqual([{ name: "fakeid", value: "MzA3MzI4MjgzMw==" }]);
  });

  it("skips malformed entries", () => {
    expect(parseSetCookies(["", "noequals", "=novalue"])).toEqual([]);
  });
});

describe("cookieHeaderFrom", () => {
  it("joins cookies into a header string", () => {
    const header = cookieHeaderFrom([
      { name: "a", value: "1" },
      { name: "b", value: "2" },
    ]);
    expect(header).toBe("a=1; b=2");
  });

  it("drops EXPIRED and empty values", () => {
    const header = cookieHeaderFrom([
      { name: "a", value: "EXPIRED" },
      { name: "b", value: "" },
      { name: "c", value: "3" },
    ]);
    expect(header).toBe("c=3");
  });
});
