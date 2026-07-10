import { collectorForUrl } from "../collectors";
import type { RuntimeMessage } from "../shared/messages";
import { PROVIDERS, PROVIDER_IDS, type DashboardState, type ParseResult, type ProviderId, type ProviderSettings } from "../shared/schema";
import { opencodeGoUrl, opencodeWorkspaceIdFromUrl } from "../shared/opencode";
import { clearLocalData, getDashboardState, getSettings, getStates, initializeStorage, patchProviderSettings, recordAttempt, recordCollection, saveSettings } from "../storage/repository";
import { getHistory, pruneHistory } from "../storage/database";
import { evaluateQuotaAlerts, evaluateStaleAlerts } from "./notification";
import { ensureRefreshAlarm, REFRESH_ALARM_NAME } from "./scheduler";
import { collectWithTab } from "./tab-runner";

const activeCollections = new Map<ProviderId, Promise<void>>();
const PRUNE_DAY_KEY = "last-history-prune-day";

async function hasHostPermission(provider: ProviderId): Promise<boolean> {
  return chrome.permissions.contains({ origins: [PROVIDERS[provider].hostPermission] });
}

async function injectCollectorForTab(tabId: number, url?: string): Promise<void> {
  if (!url) return;
  const collector = collectorForUrl(url);
  if (!collector || !await hasHostPermission(collector.id)) return;
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content-bootstrap.js"] }).catch(() => undefined);
}

async function persistCollection(provider: ProviderId, result: ParseResult, url?: string): Promise<void> {
  await recordCollection(provider, result, url);
  const settings = await getSettings();
  if (result.snapshots.length) await evaluateQuotaAlerts(provider, result.snapshots, settings).catch(() => undefined);
}

function configuredUsageUrl(provider: ProviderId, config: ProviderSettings): string | undefined {
  if (config.usageUrl) return config.usageUrl;
  if (provider === "opencode_go" && config.workspaceId) return opencodeGoUrl(config.workspaceId);
  return undefined;
}

async function discoverOpenCodeUsageUrl(): Promise<string | undefined> {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const workspaceId = opencodeWorkspaceIdFromUrl(activeTab?.url);
  if (!workspaceId || !activeTab?.url) return undefined;
  await patchProviderSettings("opencode_go", { enabled: true, usageUrl: activeTab.url, workspaceId });
  return activeTab.url;
}

function shouldPersistLiveCollection(result: ParseResult): boolean {
  // Content scripts observe visible SPA updates. A loading shell is expected
  // while a page refreshes and must not replace the provider's displayed
  // status with parser_mismatch or page_not_ready.
  return result.snapshots.length > 0 || result.status === "auth_required" || result.status === "blocked";
}

export async function refreshProvider(provider: ProviderId, reason: "scheduled" | "manual" | "startup" = "manual"): Promise<void> {
  const currentlyRunning = activeCollections.get(provider);
  if (currentlyRunning) return currentlyRunning;
  const task = (async () => {
    const [settings, states] = await Promise.all([getSettings(), getStates()]);
    const config = settings.providers[provider];
    const priorStatus = states[provider].lastResult?.status;
    if (!config.enabled || config.pausedUntil && Date.parse(config.pausedUntil) > Date.now()) return;
    if (reason === "scheduled" && states[provider].nextRetryAt && Date.parse(states[provider].nextRetryAt) > Date.now()) return;
    if (reason === "scheduled" && (priorStatus === "auth_required" || priorStatus === "blocked")) return;
    if (!await hasHostPermission(provider)) {
      await recordAttempt(provider, "尚未授予站点访问权限");
      return;
    }
    try {
      await recordAttempt(provider);
      // A successful DOM read is not necessarily a server refresh. Use a new,
      // background page for explicit and scheduled collection so cached tabs do
      // not repeatedly report stale data as newly fetched.
      let usageUrl = configuredUsageUrl(provider, config);
      // A manual refresh can adopt the OpenCode Go page currently open in the
      // browser, replacing an outdated saved workspace URL without guessing.
      if (provider === "opencode_go" && reason === "manual") usageUrl = await discoverOpenCodeUsageUrl() ?? usageUrl;
      if (provider === "opencode_go" && !usageUrl) {
        await recordAttempt(provider, "请先打开自己的 OpenCode Go 页面，再在面板中点击连接。");
        return;
      }
      const collection = await collectWithTab(PROVIDERS[provider], usageUrl);
      await persistCollection(provider, collection.result, collection.result.snapshots.length ? collection.url : undefined);
    } catch (error) {
      await recordAttempt(provider, error instanceof Error ? error.message : "采集失败");
    }
  })().finally(() => activeCollections.delete(provider));
  activeCollections.set(provider, task);
  return task;
}

export async function refreshAllProviders(reason: "scheduled" | "manual" | "startup" = "manual"): Promise<void> {
  await Promise.all(PROVIDER_IDS.map((provider) => refreshProvider(provider, reason)));
  const dashboard = await getDashboardState();
  await evaluateStaleAlerts(dashboard.providers, dashboard.settings).catch(() => undefined);
  const dateKey = new Date().toISOString().slice(0, 10);
  const stored = await chrome.storage.local.get(PRUNE_DAY_KEY);
  if (stored[PRUNE_DAY_KEY] !== dateKey) {
    await pruneHistory().catch(() => undefined);
    await chrome.storage.local.set({ [PRUNE_DAY_KEY]: dateKey });
  }
}

async function openProviderUsage(provider: ProviderId): Promise<void> {
  if (!await hasHostPermission(provider)) throw new Error("请先在面板中授予该站点的访问权限");
  if (provider === "opencode_go") {
    if (!await discoverOpenCodeUsageUrl()) {
      throw new Error("请先在当前标签打开自己的 OpenCode Go 页面（地址中含 /workspace/wrk_…/go），再点击连接。");
    }
    await refreshProvider(provider);
    return;
  }
  await patchProviderSettings(provider, { enabled: true });
  const settings = await getSettings();
  await chrome.tabs.create({ url: configuredUsageUrl(provider, settings.providers[provider]) ?? PROVIDERS[provider].defaultUrl, active: true });
}

async function handleMessage(message: RuntimeMessage): Promise<unknown> {
  switch (message.type) {
    case "CONTENT_READY":
      return { ok: true };
    case "COLLECT_RESULT":
      if (message.live && !shouldPersistLiveCollection(message.result)) return { ok: true };
      await persistCollection(message.provider, message.result, message.result.snapshots.length ? message.url : undefined);
      return { ok: true };
    case "GET_DASHBOARD":
      return { ok: true, state: await getDashboardState() };
    case "REFRESH_ALL":
      await refreshAllProviders("manual");
      return { ok: true, state: await getDashboardState() };
    case "REFRESH_PROVIDER":
      await refreshProvider(message.provider, "manual");
      return { ok: true, state: await getDashboardState() };
    case "CONNECT_PROVIDER":
      await openProviderUsage(message.provider);
      return { ok: true, state: await getDashboardState() };
    case "DISCONNECT_PROVIDER":
      await patchProviderSettings(message.provider, { enabled: false, usageUrl: undefined, workspaceId: undefined, pausedUntil: undefined });
      return { ok: true, state: await getDashboardState() };
    case "SET_PROVIDER_ENABLED":
      await patchProviderSettings(message.provider, { enabled: message.enabled });
      return { ok: true, state: await getDashboardState() };
    case "GET_HISTORY":
      return { ok: true, history: await getHistory(message.provider, message.quotaKey, message.days) };
    case "GET_SETTINGS":
      return { ok: true, settings: await getSettings() };
    case "UPDATE_SETTINGS":
      await saveSettings(message.settings);
      return { ok: true, state: await getDashboardState() };
    case "CLEAR_LOCAL_DATA":
      await clearLocalData();
      await initializeStorage();
      return { ok: true, state: await getDashboardState() };
    case "OPEN_OPTIONS":
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    default:
      return { ok: false, error: "未知消息" };
  }
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  void handleMessage(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "操作失败" }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  void initializeStorage();
  void ensureRefreshAlarm();
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});

chrome.runtime.onStartup.addListener(() => {
  void initializeStorage();
  void ensureRefreshAlarm();
  void refreshAllProviders("startup");
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM_NAME) void refreshAllProviders("scheduled");
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") void injectCollectorForTab(tabId, tab.url);
});

void ensureRefreshAlarm();
