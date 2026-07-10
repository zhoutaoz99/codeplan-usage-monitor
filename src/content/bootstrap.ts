import { collectorForUrl } from "../collectors";
import { hashText } from "../shared/dom";
import type { RuntimeMessage } from "../shared/messages";
import type { ParseResult } from "../shared/schema";
import { observeUsagePage } from "./dom-observer";

let lastResultHash: string | undefined;
let stopObserving: (() => void) | undefined;

function activeRuntime(): typeof chrome.runtime | undefined {
  try {
    const runtime = typeof chrome === "undefined" ? undefined : chrome.runtime;
    return runtime?.id ? runtime : undefined;
  } catch {
    return undefined;
  }
}

function sendToBackground(message: RuntimeMessage): void {
  const runtime = activeRuntime();
  if (!runtime) return;
  try {
    void runtime.sendMessage(message).catch(() => undefined);
  } catch {
    // The extension can be reloaded while an old content script is still alive.
  }
}

function collect(allowConfiguredUsageUrl = false): ParseResult | undefined {
  const collector = collectorForUrl(location.href);
  if (!collector || (!allowConfiguredUsageUrl && !collector.isUsagePage(document, new URL(location.href)))) return undefined;
  return collector.parse({
    url: location.href,
    document,
    locale: document.documentElement.lang || navigator.language,
    collectedAt: new Date().toISOString()
  });
}

function resultHash(result: ParseResult): string {
  return hashText(JSON.stringify({
    status: result.status,
    snapshots: result.snapshots.map((snapshot) => [snapshot.quotaKey, snapshot.used, snapshot.remaining, snapshot.usedPercent, snapshot.remainingPercent, snapshot.resetsAt, snapshot.rawTextHash])
  }));
}

function shouldPublishLiveResult(result: ParseResult): boolean {
  // During a full-page or SPA refresh the route can be correct while only the
  // navigation shell has rendered. Keep that transient state out of the
  // dashboard; a background refresh will still report a persistent mismatch.
  return result.snapshots.length > 0 || result.status === "auth_required" || result.status === "blocked";
}

function publishLiveUpdate(): void {
  const result = collect();
  if (!result) return;
  const hash = resultHash(result);
  if (hash === lastResultHash) return;
  lastResultHash = hash;
  if (!shouldPublishLiveResult(result)) return;
  sendToBackground({ type: "COLLECT_RESULT", provider: result.provider, url: location.href, result, live: true });
}

function startForCurrentPage(): void {
  stopObserving?.();
  stopObserving = undefined;
  lastResultHash = undefined;
  const collector = collectorForUrl(location.href);
  if (!collector || !collector.isUsagePage(document, new URL(location.href))) return;
  stopObserving = observeUsagePage(publishLiveUpdate);
}

function rescanAfterClientNavigation(): void {
  window.setTimeout(startForCurrentPage, 0);
}

for (const method of ["pushState", "replaceState"] as const) {
  const original = history[method];
  history[method] = function (...args: Parameters<History[typeof method]>): void {
    original.apply(history, args);
    rescanAfterClientNavigation();
  };
}
window.addEventListener("popstate", rescanAfterClientNavigation);
window.addEventListener("hashchange", rescanAfterClientNavigation);

const collector = collectorForUrl(location.href);
if (collector?.isUsagePage(document, new URL(location.href))) {
  sendToBackground({ type: "CONTENT_READY", provider: collector.id, url: location.href });
  startForCurrentPage();
}

const runtime = activeRuntime();
runtime?.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type !== "COLLECT_NOW") return;
  try {
    const result = collect(message.allowConfiguredUsageUrl);
    if (result) lastResultHash = resultHash(result);
    sendResponse({ ok: Boolean(result), result, error: result ? undefined : "这不是可识别的用量页面" });
  } catch (error) {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : "采集脚本失败" });
  }
});
