import type { ParseResult, ProviderDefinition, ProviderId } from "../shared/schema";
import type { RuntimeMessage } from "../shared/messages";

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function waitUntilTabComplete(tabId: number, timeoutMs = 25_000): Promise<void> {
  const current = await chrome.tabs.get(tabId).catch(() => undefined);
  if (current?.status === "complete") return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("用量页面加载超时"));
    }, timeoutMs);
    const listener = (changedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (changedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function collectFromTab(tabId: number, allowConfiguredUsageUrl = false): Promise<ParseResult> {
  let lastError: unknown;
  let lastTransientResult: ParseResult | undefined;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: "COLLECT_NOW",
        allowConfiguredUsageUrl
      } satisfies RuntimeMessage) as { ok?: boolean; result?: ParseResult; error?: string } | undefined;
      if (response?.ok && response.result) {
        if (response.result.status !== "page_not_ready" && response.result.status !== "parser_mismatch") return response.result;
        lastTransientResult = response.result;
      }
      if (response?.error) lastError = new Error(response.error);
    } catch (error) {
      lastError = error;
      if (attempt === 1) {
        await chrome.scripting.executeScript({ target: { tabId }, files: ["content-bootstrap.js"] }).catch(() => undefined);
      }
    }
    await sleep(750);
  }
  if (lastTransientResult) return lastTransientResult;
  throw lastError instanceof Error ? lastError : new Error("内容脚本没有返回用量数据");
}

export interface TabCollectionResult {
  result: ParseResult;
  url: string;
  temporary: boolean;
}

export async function collectWithTab(definition: ProviderDefinition, usageUrl?: string): Promise<TabCollectionResult> {
  const targetUrl = usageUrl ?? definition.defaultUrl;
  const tab = await chrome.tabs.create({ url: targetUrl, active: false });
  const temporary = true;
  if (!tab.id) throw new Error("无法创建用量采集标签页");
  try {
    await waitUntilTabComplete(tab.id);
    // A saved URL is written only after a successful prior read. Allow that
    // legacy route for this temporary, background-created tab while keeping
    // live observation limited to recognized usage routes.
    const result = await collectFromTab(tab.id, Boolean(usageUrl));
    const currentTab = await chrome.tabs.get(tab.id).catch(() => undefined);
    return { result, url: currentTab?.url ?? targetUrl, temporary };
  } finally {
    if (temporary) await chrome.tabs.remove(tab.id).catch(() => undefined);
  }
}
