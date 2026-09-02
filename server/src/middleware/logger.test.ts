import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { requestLogger } from "./logger.js";

describe("requestLogger", () => {
  it("redacts sensitive query parameters", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const req: any = {
      path: "/wechat/",
      method: "GET",
      originalUrl: "/wechat/?token=secret&auth-key=private&safe=yes",
      headers: {},
    };
    const res: any = new EventEmitter();
    res.statusCode = 200;
    requestLogger(req, res, () => {});
    res.emit("finish");

    const line = String(log.mock.calls[0][0]);
    expect(line).not.toContain("secret");
    expect(line).not.toContain("private");
    expect(line).toContain("token=%5Bredacted%5D");
    expect(line).toContain("safe=yes");
    log.mockRestore();
  });
});
