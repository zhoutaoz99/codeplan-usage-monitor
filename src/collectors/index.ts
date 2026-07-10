import type { ProviderCollector } from "./base";
import { claudeCollector } from "./claude/collector";
import { codexCollector } from "./codex/collector";
import { opencodeGoCollector } from "./opencode-go/collector";

export const collectors: ProviderCollector[] = [claudeCollector, codexCollector, opencodeGoCollector];

export function collectorForUrl(url: string): ProviderCollector | undefined {
  try {
    const parsed = new URL(url);
    return collectors.find((collector) => collector.matches(parsed));
  } catch {
    return undefined;
  }
}
