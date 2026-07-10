import type { ParseResult } from "../../shared/schema";
import { LABELS, createResult, findContainer, moneySnapshot, snapshotFromContainer, type CollectorContext, type ProviderCollector, type QuotaSpec } from "../base";

const PARSER_VERSION = "claude-dom-v3";
const specs: QuotaSpec[] = [
  { quotaKey: "session_5h", displayName: "5小时使用限额", labels: [...LABELS.fiveHour, "current session", "current-session", "current session limit", "session limit", "本次会话", "当前会话", "当前會話", "当前时段", "當前時段"], windowKind: "rolling_5h", scope: "account" },
  { quotaKey: "weekly_all_models", displayName: "每周使用限额", labels: [...LABELS.allModels, "weekly limit", "weekly usage", "每周限额", "每週限額", "每周用量", "每週用量"], windowKind: "weekly", scope: "account" },
  { quotaKey: "weekly_opus", displayName: "每周使用限额", labels: LABELS.opus, windowKind: "weekly", scope: "account" },
  { quotaKey: "usage_credits", displayName: "Usage Credits", labels: LABELS.credit, windowKind: "credits", unit: "usd", scope: "account" }
];

export const claudeCollector: ProviderCollector = {
  id: "claude",
  matches: (url) => url.hostname === "claude.ai" || url.hostname.endsWith(".claude.ai"),
  // The settings shell appears on many unrelated Claude pages.  Text matching
  // here makes a transient shell render look like a broken usage page.
  isUsagePage: (_document, url) => {
    if (!/^\/settings(?:\/|$)/i.test(url.pathname)) return false;
    return /(?:^|\/)usage(?:\/|$)/i.test(url.pathname) || /(?:^|[?&#])(?:tab|section|view)?=?usage(?:&|$)/i.test(`${url.search}${url.hash}`);
  },
  parse(context: CollectorContext): ParseResult {
    const snapshots = [];
    const matchedLabels = [];
    for (const spec of specs) {
      const container = findContainer(context.document, spec.labels);
      if (!container) continue;
      const snapshot = spec.quotaKey === "usage_credits"
        ? moneySnapshot("claude", spec, container, context, PARSER_VERSION)
        : snapshotFromContainer("claude", spec, container, context, PARSER_VERSION);
      if (snapshot) {
        snapshots.push(snapshot);
        matchedLabels.push(spec.displayName);
      }
    }
    return createResult("claude", context, PARSER_VERSION, snapshots, matchedLabels, ["session_5h"]);
  }
};
