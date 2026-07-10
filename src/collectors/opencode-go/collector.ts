import type { ParseResult } from "../../shared/schema";
import { hashText, normalizedText } from "../../shared/dom";
import { makeSnapshotId } from "../../shared/schema";
import { LABELS, createResult, findContainer, moneySnapshot, snapshotFromContainer, type CollectorContext, type ProviderCollector, type QuotaSpec } from "../base";

const PARSER_VERSION = "opencode-go-dom-v2";
const specs: QuotaSpec[] = [
  { quotaKey: "rolling_5h", displayName: "5小时使用限额", labels: [...LABELS.fiveHour, "rolling usage", "rolling limit", "滚动用量", "滾動用量"], windowKind: "rolling_5h", unit: "usd", scope: "workspace" },
  { quotaKey: "weekly", displayName: "每周使用限额", labels: LABELS.weekly, windowKind: "weekly", unit: "usd", scope: "workspace" },
  { quotaKey: "monthly", displayName: "每月使用限额", labels: LABELS.monthly, windowKind: "monthly", unit: "usd", scope: "workspace" },
  { quotaKey: "zen_balance", displayName: "Zen Balance", labels: ["zen balance", "zen余额", "zen 餘額", "zen 残高"], windowKind: "credits", unit: "usd", scope: "workspace" }
];

export const opencodeGoCollector: ProviderCollector = {
  id: "opencode_go",
  matches: (url) => url.hostname === "opencode.ai" || url.hostname.endsWith(".opencode.ai"),
  // Weekly and balance labels can also occur outside the Go usage view.
  isUsagePage: (_document, url) => /^\/(?:workspace\/[^/]+\/go|zen\/go)\/?$/i.test(url.pathname),
  parse(context: CollectorContext): ParseResult {
    const snapshots = [];
    const matchedLabels = [];
    for (const spec of specs) {
      const container = findContainer(context.document, spec.labels);
      if (!container) continue;
      const snapshot = spec.quotaKey === "zen_balance"
        ? moneySnapshot("opencode_go", spec, container, context, PARSER_VERSION)
        : snapshotFromContainer("opencode_go", spec, container, context, PARSER_VERSION);
      if (snapshot) {
        snapshots.push(snapshot);
        matchedLabels.push(spec.displayName);
      }
    }
    const balanceContainer = findContainer(context.document, LABELS.useBalance);
    if (balanceContainer) {
      const text = normalizedText(balanceContainer.textContent);
      const enabled = /(?:enabled|on|开启|已开|已開|true)/i.test(text) && !/(?:disabled|off|关闭|關閉|false)/i.test(text);
      const snapshot = {
        id: "",
        provider: "opencode_go" as const,
        quotaKey: "use_balance",
        displayName: "Use Balance",
        windowKind: "unknown" as const,
        remaining: enabled ? 1 : 0,
        unit: "vendor_native" as const,
        scope: "workspace" as const,
        source: "visible_dom" as const,
        confidence: 0,
        parserVersion: PARSER_VERSION,
        fetchedAt: context.collectedAt,
        rawTextHash: hashText(text.replace(/\d+(?:[.,]\d+)?/g, "#"))
      };
      snapshot.id = makeSnapshotId(snapshot);
      snapshots.push(snapshot);
      matchedLabels.push("Use Balance");
    }
    return createResult("opencode_go", context, PARSER_VERSION, snapshots, matchedLabels, ["rolling_5h", "weekly", "monthly"]);
  }
};
