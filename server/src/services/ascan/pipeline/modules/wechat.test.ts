import { describe, expect, it, vi } from "vitest";
import { parseAppmsgpublish, rateLimitFragment } from "./wechat.js";

describe("WeChat article frequency control", () => {
  it("treats ret=200013 as an error instead of an empty article list", () => {
    const log = vi.fn();
    expect(() => parseAppmsgpublish(
      { base_resp: { ret: 200013, err_msg: "freq control", retry_after_seconds: 3600 } },
      log,
    )).toThrow(/frequency limited/i);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("freq control"));
  });

  it("renders an explicit rate-limit message instead of no updates", () => {
    const fragment = rateLimitFragment(3600, "zh");
    expect(fragment.html).toContain("频率限制");
    expect(fragment.html).toContain("60 分钟");
    expect(fragment.html).not.toContain("今日无微信公众号更新");
  });
});
