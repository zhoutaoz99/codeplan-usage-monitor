import { describe, expect, it } from "vitest";
import { formatReset, formatResetCountdown, isResetWithin24Hours, toIsoFromRelative } from "./time";

describe("formatResetCountdown", () => {
  it("formats a reset countdown in hours and minutes", () => {
    expect(formatResetCountdown("2026-07-10T16:33:00.000Z", new Date("2026-07-10T12:00:00.000Z"))).toBe("4小时33分");
  });

  it("reports a passed reset time", () => {
    expect(formatResetCountdown("2026-07-10T11:59:00.000Z", new Date("2026-07-10T12:00:00.000Z"))).toBe("已到重置时间");
  });

  it("parses a weekly reset expressed as weekday and time", () => {
    const now = new Date(2026, 6, 10, 12, 0, 0);
    expect(toIsoFromRelative("Tue 4:59 AM", now)).toBe(new Date(2026, 6, 14, 4, 59, 0).toISOString());
  });
});

describe("formatReset", () => {
  it("can prefix a reset time with a Chinese weekday", () => {
    expect(formatReset("2026-07-13T12:00:00.000Z", true)).toMatch(/^周一 /);
  });

  it("identifies resets that are less than 24 hours away", () => {
    const now = new Date("2026-07-10T12:00:00.000Z");
    expect(isResetWithin24Hours("2026-07-11T11:59:00.000Z", now)).toBe(true);
    expect(isResetWithin24Hours("2026-07-11T12:00:00.000Z", now)).toBe(false);
  });
});
