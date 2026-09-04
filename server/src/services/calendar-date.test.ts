import { describe, expect, it } from "vitest";
import { dateKey, isDateKey, localCompactDate, localDateKey, shiftDateKey } from "./calendar-date.js";

describe("calendar dates", () => {
  it("uses the server local day for instants near a UTC boundary", () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "Asia/Shanghai";
    try {
      const instant = new Date("2026-09-04T16:30:00.000Z");
      expect(localDateKey(instant)).toBe("2026-09-05");
      expect(localCompactDate(instant)).toBe("20260905");
      expect(dateKey(instant)).toBe("2026-09-05");
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

  it("preserves explicit date keys and shifts them across month boundaries", () => {
    expect(dateKey("2026-09-04")).toBe("2026-09-04");
    expect(shiftDateKey("2026-09-04", -6)).toBe("2026-08-29");
  });

  it("rejects malformed and impossible calendar dates", () => {
    expect(isDateKey("2026-02-29")).toBe(false);
    expect(isDateKey("2026-2-09")).toBe(false);
    expect(() => dateKey("2026-09-04T12:00:00Z")).toThrow("Invalid calendar date");
    expect(() => dateKey("not-a-date")).toThrow("Invalid calendar date");
  });
});
