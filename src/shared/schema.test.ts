import { describe, expect, it } from "vitest";
import { defaultSettings, PROVIDERS } from "./schema";

describe("defaultSettings", () => {
  it("keeps the seven-day usage trend disabled by default", () => {
    expect(defaultSettings().showSevenDayUsageTrend).toBe(false);
  });

  it("does not ship a fixed OpenCode workspace ID", () => {
    expect(PROVIDERS.opencode_go.defaultUrl).toBe("https://opencode.ai/");
  });
});
