import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import type { ProviderCollector } from "./base";
import { claudeCollector } from "./claude/collector";
import { codexCollector } from "./codex/collector";
import { opencodeGoCollector } from "./opencode-go/collector";

function parseFixture(collector: ProviderCollector, path: string, url: string) {
  const html = readFileSync(resolve(import.meta.dirname, path), "utf8");
  const dom = new JSDOM(html, { url });
  return collector.parse({ url, document: dom.window.document, collectedAt: "2026-07-10T12:00:00.000Z" });
}

describe("provider DOM parsers", () => {
  it("normalizes Claude percentage windows without retaining page text", () => {
    const result = parseFixture(claudeCollector, "claude/fixtures/en-v1.html", "https://claude.ai/settings/usage");
    expect(result.status).toBe("ok");
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    expect(result.snapshots.find((snapshot) => snapshot.quotaKey === "session_5h")?.displayName).toBe("5小时使用限额");
    expect(result.snapshots.find((snapshot) => snapshot.quotaKey === "weekly_all_models")?.displayName).toBe("每周使用限额");
    expect(result.snapshots.find((snapshot) => snapshot.quotaKey === "session_5h")).toMatchObject({ usedPercent: 37, remainingPercent: 63 });
    expect(result.snapshots.find((snapshot) => snapshot.quotaKey === "session_5h")?.resetsAt).toBeDefined();
    expect(result.snapshots.find((snapshot) => snapshot.quotaKey === "usage_credits")?.remaining).toBe(8.2);
    expect(result.snapshots.every((snapshot) => snapshot.rawTextHash && !snapshot.rawTextHash.includes("Usage"))).toBe(true);
  });

  it("reads Claude progress exposed through accessible progress labels", () => {
    const result = parseFixture(claudeCollector, "claude/fixtures/aria-progress-v2.html", "https://claude.ai/settings/usage");
    expect(result.status).toBe("ok");
    expect(result.snapshots.find((snapshot) => snapshot.quotaKey === "session_5h")).toMatchObject({ usedPercent: 37, remainingPercent: 63 });
    expect(result.snapshots.find((snapshot) => snapshot.quotaKey === "weekly_all_models")).toMatchObject({ usedPercent: 59, remainingPercent: 41 });
  });

  it("recognizes Codex shared-pool percentage and separate credits", () => {
    const usageUrl = "https://chatgpt.com/codex/cloud/settings/analytics#usage";
    const result = parseFixture(codexCollector, "codex/fixtures/en-v1.html", usageUrl);
    expect(result.status).toBe("ok");
    expect(result.snapshots.find((snapshot) => snapshot.quotaKey === "primary_window")?.displayName).toBe("5小时使用限额");
    expect(result.snapshots.find((snapshot) => snapshot.quotaKey === "primary_window")).toMatchObject({ remainingPercent: 65, scope: "shared_pool" });
    expect(result.snapshots.find((snapshot) => snapshot.quotaKey === "credits")?.remaining).toBe(8.2);
    expect(codexCollector.isUsagePage(new JSDOM("<title>Codex Analytics</title>", { url: usageUrl }).window.document, new URL(usageUrl))).toBe(true);
  });

  it("parses the Chinese Codex analytics usage cards", () => {
    const result = parseFixture(codexCollector, "codex/fixtures/zh-analytics-v1.html", "https://chatgpt.com/codex/cloud/settings/analytics#usage");
    expect(result.status).toBe("ok");
    expect(result.snapshots.find((snapshot) => snapshot.quotaKey === "primary_window")).toMatchObject({ remainingPercent: 68, usedPercent: 32, scope: "shared_pool" });
    expect(result.snapshots.find((snapshot) => snapshot.quotaKey === "secondary_window")).toMatchObject({ remainingPercent: 81, usedPercent: 19 });
    expect(result.snapshots.find((snapshot) => snapshot.quotaKey === "primary_window")?.resetsAt).toBeDefined();
    expect(result.snapshots.find((snapshot) => snapshot.quotaKey === "secondary_window")?.resetsAt).toBeDefined();
    expect(result.snapshots.find((snapshot) => snapshot.quotaKey === "credits")).toBeUndefined();
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("parses OpenCode money windows and keeps Use Balance separate", () => {
    const result = parseFixture(opencodeGoCollector, "opencode-go/fixtures/en-v1.html", "https://opencode.ai/workspace/wrk_fixture/go");
    expect(result.status).toBe("ok");
    expect(result.snapshots.find((snapshot) => snapshot.quotaKey === "rolling_5h")).toMatchObject({ used: 3.6, limit: 12, remaining: 8.4, remainingPercent: 70 });
    expect(result.snapshots.find((snapshot) => snapshot.quotaKey === "monthly")?.displayName).toBe("每月使用限额");
    expect(result.snapshots.find((snapshot) => snapshot.quotaKey === "monthly")).toMatchObject({ used: 31.7, limit: 60, remaining: 28.3 });
    expect(result.snapshots.find((snapshot) => snapshot.quotaKey === "use_balance")?.remaining).toBe(0);
    expect(opencodeGoCollector.matches(new URL("https://opencode.ai/workspace/wrk_fixture/go"))).toBe(true);
  });

  it("keeps the OpenCode weekly reset line with its usage card", () => {
    const result = parseFixture(opencodeGoCollector, "opencode-go/fixtures/zh-v2.html", "https://opencode.ai/workspace/wrk_fixture/go");
    expect(result.status).toBe("ok");
    expect(result.snapshots.find((snapshot) => snapshot.quotaKey === "weekly")).toMatchObject({ usedPercent: 33, resetsAt: "2026-07-13T01:00:00.000Z" });
    expect(result.snapshots.find((snapshot) => snapshot.quotaKey === "monthly")).toMatchObject({ usedPercent: 30, resetsAt: "2026-08-02T10:00:00.000Z" });
  });

  it("reports login pages as auth_required", () => {
    const dom = new JSDOM("<title>Claude</title><main><h1>Sign in</h1><p>Continue with Google</p></main>", { url: "https://claude.ai/settings/usage" });
    const result = claudeCollector.parse({ url: dom.window.location.href, document: dom.window.document, collectedAt: "2026-07-10T12:00:00.000Z" });
    expect(result.status).toBe("auth_required");
    expect(result.snapshots).toEqual([]);
  });

  it("observes only dedicated usage routes, not pages that merely contain usage wording", () => {
    const document = new JSDOM("<title>Codex usage limits</title><main>Weekly usage</main>").window.document;

    expect(claudeCollector.isUsagePage(document, new URL("https://claude.ai/settings/plan"))).toBe(false);
    expect(claudeCollector.isUsagePage(document, new URL("https://claude.ai/settings/usage"))).toBe(true);
    expect(claudeCollector.isUsagePage(document, new URL("https://claude.ai/settings?tab=usage"))).toBe(true);

    expect(codexCollector.isUsagePage(document, new URL("https://chatgpt.com/codex"))).toBe(false);
    expect(codexCollector.isUsagePage(document, new URL("https://chatgpt.com/codex/cloud/settings/analytics#usage"))).toBe(true);

    expect(opencodeGoCollector.isUsagePage(document, new URL("https://opencode.ai/workspace/wrk_123/plan"))).toBe(false);
    expect(opencodeGoCollector.isUsagePage(document, new URL("https://opencode.ai/workspace/wrk_123/go"))).toBe(true);
  });
});
