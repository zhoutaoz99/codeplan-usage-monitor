import type { AppSettings, DashboardState, ParseResult, ProviderId, ProviderState, QuotaSnapshot } from "../shared/schema";
import { defaultProviderState, defaultSettings, PROVIDER_IDS } from "../shared/schema";
import { opencodeWorkspaceIdFromUrl } from "../shared/opencode";
import { clearHistory, saveHistory } from "./database";

const SETTINGS_KEY = "settings-v1";
const STATES_KEY = "provider-states-v1";

async function storageGet<T>(key: string): Promise<T | undefined> {
  const result = await chrome.storage.local.get(key);
  return result[key] as T | undefined;
}

async function storageSet(value: Record<string, unknown>): Promise<void> {
  await chrome.storage.local.set(value);
}

function mergeSettings(stored?: Partial<AppSettings>): AppSettings {
  const defaults = defaultSettings();
  const opencode = { ...defaults.providers.opencode_go, ...stored?.providers?.opencode_go };
  if (!opencode.workspaceId) {
    opencode.workspaceId = opencodeWorkspaceIdFromUrl(opencode.usageUrl);
  }
  return {
    providers: {
      claude: { ...defaults.providers.claude, ...stored?.providers?.claude },
      codex: { ...defaults.providers.codex, ...stored?.providers?.codex },
      opencode_go: opencode
    },
    alerts: { ...defaults.alerts, ...stored?.alerts },
    showSevenDayUsageTrend: stored?.showSevenDayUsageTrend ?? defaults.showSevenDayUsageTrend
  };
}

function mergeStates(stored?: Partial<Record<ProviderId, ProviderState>>): Record<ProviderId, ProviderState> {
  return {
    claude: { ...defaultProviderState("claude"), ...stored?.claude, latest: stored?.claude?.latest ?? [] },
    codex: { ...defaultProviderState("codex"), ...stored?.codex, latest: stored?.codex?.latest ?? [] },
    opencode_go: { ...defaultProviderState("opencode_go"), ...stored?.opencode_go, latest: stored?.opencode_go?.latest ?? [] }
  };
}

export async function getSettings(): Promise<AppSettings> {
  return mergeSettings(await storageGet<Partial<AppSettings>>(SETTINGS_KEY));
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await storageSet({ [SETTINGS_KEY]: mergeSettings(settings) });
}

export async function patchProviderSettings(provider: ProviderId, patch: Partial<AppSettings["providers"][ProviderId]>): Promise<AppSettings> {
  const settings = await getSettings();
  settings.providers[provider] = { ...settings.providers[provider], ...patch };
  await saveSettings(settings);
  return settings;
}

export async function getStates(): Promise<Record<ProviderId, ProviderState>> {
  return mergeStates(await storageGet<Partial<Record<ProviderId, ProviderState>>>(STATES_KEY));
}

async function saveStates(states: Record<ProviderId, ProviderState>): Promise<void> {
  await storageSet({ [STATES_KEY]: states });
}

export async function getDashboardState(): Promise<DashboardState> {
  const [settings, providers] = await Promise.all([getSettings(), getStates()]);
  return { settings, providers };
}

function mergeLatest(previous: QuotaSnapshot[], incoming: QuotaSnapshot[]): QuotaSnapshot[] {
  const next = new Map(previous.map((snapshot) => [snapshot.quotaKey, snapshot]));
  for (const snapshot of incoming) next.set(snapshot.quotaKey, snapshot);
  return Array.from(next.values()).sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function isCodexAnalyticsUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname === "chatgpt.com" && parsed.pathname === "/codex/cloud/settings/analytics";
  } catch {
    return false;
  }
}

export async function recordAttempt(provider: ProviderId, error?: string): Promise<void> {
  const states = await getStates();
  const prior = states[provider];
  const failureCount = error ? (prior.failureCount ?? 0) + 1 : prior.failureCount;
  const delayMinutes = [5, 15, 30][Math.min((failureCount ?? 1) - 1, 2)] ?? 30;
  states[provider] = {
    ...prior,
    lastAttemptAt: new Date().toISOString(),
    lastError: error,
    failureCount,
    nextRetryAt: error ? new Date(Date.now() + delayMinutes * 60_000).toISOString() : prior.nextRetryAt
  };
  await saveStates(states);
}

export async function recordCollection(provider: ProviderId, result: ParseResult, url?: string): Promise<void> {
  const states = await getStates();
  const state = states[provider];
  const validSnapshots = result.snapshots.filter((snapshot) => snapshot.confidence >= 0.65);
  const canReplace = validSnapshots.length > 0 && (result.status === "ok" || result.status === "partial");
  const retryableFailure = result.status === "parser_mismatch" || result.status === "page_not_ready";
  const failureCount = retryableFailure ? (state.failureCount ?? 0) + 1 : (canReplace ? 0 : state.failureCount ?? 0);
  const delayMinutes = [5, 15, 30][Math.min(Math.max(failureCount - 1, 0), 2)] ?? 30;
  const clearAbsentAnalyticsCredits = provider === "codex" && canReplace && isCodexAnalyticsUrl(url) && !validSnapshots.some((snapshot) => snapshot.quotaKey === "credits");
  const latest = canReplace
    ? mergeLatest(state.latest, validSnapshots).filter((snapshot) => !clearAbsentAnalyticsCredits || snapshot.quotaKey !== "credits")
    : state.latest;
  states[provider] = {
    ...state,
    latest,
    lastResult: result,
    lastAttemptAt: new Date().toISOString(),
    lastSuccessfulAt: canReplace ? new Date().toISOString() : state.lastSuccessfulAt,
    lastError: canReplace ? undefined : state.lastError,
    failureCount,
    nextRetryAt: retryableFailure ? new Date(Date.now() + delayMinutes * 60_000).toISOString() : (canReplace ? undefined : state.nextRetryAt)
  };
  await saveStates(states);
  if (canReplace) await saveHistory(validSnapshots);
  if (canReplace && url) {
    const workspaceId = provider === "opencode_go" ? opencodeWorkspaceIdFromUrl(url) : undefined;
    // OpenCode's generic Go entry redirects to a workspace-specific page.
    // Persist that resolved URL and its ID only after a successful DOM read.
    if (provider !== "opencode_go" || workspaceId) {
      await patchProviderSettings(provider, {
        usageUrl: url,
        enabled: true,
        lastPageFingerprint: result.diagnostics?.pageFingerprint,
        ...(workspaceId ? { workspaceId } : {})
      });
    }
  }
}

export async function clearLocalData(): Promise<void> {
  await chrome.storage.local.remove([SETTINGS_KEY, STATES_KEY, "alert-state-v1"]);
  await clearHistory();
}

export async function initializeStorage(): Promise<void> {
  const settings = await getSettings();
  await saveSettings(settings);
  const states = await getStates();
  await saveStates(states);
  void PROVIDER_IDS;
}
