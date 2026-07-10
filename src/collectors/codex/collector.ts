import type { ParseResult, UsageScope } from "../../shared/schema";
import { LABELS, createResult, findContainer, moneySnapshot, snapshotFromContainer, type CollectorContext, type ProviderCollector, type QuotaSpec } from "../base";

const PARSER_VERSION = "codex-dom-v3";
const creditLabels = ["usage credits", "available credits", "credits available", "credit balance", "credits balance", "额度余额", "信用额度", "可用 credits", "可用额度"];
const specs: QuotaSpec[] = [
  { quotaKey: "primary_window", displayName: "5小时使用限额", labels: [...LABELS.primary, ...LABELS.fiveHour, "5 小时使用限额", "5小时使用限额", "5 小時使用限額", "5-hour usage limit", "5 hour usage limit"], windowKind: "rolling_5h" },
  { quotaKey: "secondary_window", displayName: "每周使用限额", labels: [...LABELS.secondary, ...LABELS.weekly, "每周使用限额", "每週使用限額", "weekly usage limit"], windowKind: "weekly" },
  { quotaKey: "credits", displayName: "Credits", labels: creditLabels, windowKind: "credits", unit: "usd" },
  { quotaKey: "reserve_resets", displayName: "储备重置", labels: LABELS.reserve, windowKind: "reserve_reset", unit: "credits" }
];

export const codexCollector: ProviderCollector = {
  id: "codex",
  matches: (url) => url.hostname === "chatgpt.com" || url.hostname.endsWith(".chatgpt.com"),
  // "Codex" is present in ChatGPT navigation and on many non-usage screens.
  // Restrict observation to the analytics route the extension opens itself.
  isUsagePage: (_document, url) => /^\/codex\/cloud\/settings\/analytics\/?$/i.test(url.pathname),
  parse(context: CollectorContext): ParseResult {
    const text = (context.document.body?.textContent ?? "").toLowerCase();
    const scope: UsageScope = /agentic|shared usage|共享.*(?:用量|额度|限额)|共享池/.test(text) ? "shared_pool" : "product";
    const snapshots = [];
    const matchedLabels = [];
    for (const spec of specs) {
      const container = findContainer(context.document, spec.labels);
      if (!container) continue;
      const snapshot = spec.quotaKey === "credits"
        ? moneySnapshot("codex", spec, container, context, PARSER_VERSION, scope)
        : snapshotFromContainer("codex", spec, container, context, PARSER_VERSION, scope);
      if (snapshot) {
        snapshots.push(snapshot);
        matchedLabels.push(spec.displayName);
      }
    }
    return createResult("codex", context, PARSER_VERSION, snapshots, matchedLabels, ["primary_window"]);
  }
};
