import { describe, expect, it } from "vitest";
import { opencodeGoUrl, opencodeWorkspaceIdFromUrl } from "./opencode";

describe("OpenCode workspace URLs", () => {
  it("extracts the workspace ID from a Go usage page", () => {
    expect(opencodeWorkspaceIdFromUrl("https://opencode.ai/workspace/wrk_01ABC/go")).toBe("wrk_01ABC");
  });

  it("rejects non-Go workspace pages", () => {
    expect(opencodeWorkspaceIdFromUrl("https://opencode.ai/workspace/wrk_01ABC/billing")).toBeUndefined();
  });

  it("builds the workspace-specific Go URL", () => {
    expect(opencodeGoUrl("wrk_01ABC")).toBe("https://opencode.ai/workspace/wrk_01ABC/go");
  });
});
