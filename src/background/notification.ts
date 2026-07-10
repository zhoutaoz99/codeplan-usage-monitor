import type { AppSettings, ProviderId, ProviderState, QuotaSnapshot } from "../shared/schema";

const ALERTS_KEY = "alert-state-v1";
type AlertState = Record<string, true>;

async function getAlertState(): Promise<AlertState> {
  const stored = await chrome.storage.local.get(ALERTS_KEY);
  return (stored[ALERTS_KEY] as AlertState | undefined) ?? {};
}

export async function evaluateQuotaAlerts(provider: ProviderId, snapshots: QuotaSnapshot[], settings: AppSettings): Promise<void> {
  if (!settings.alerts.notificationsEnabled) return;
  const alertState = await getAlertState();
  let changed = false;
  for (const snapshot of snapshots) {
    if (snapshot.remainingPercent == null) continue;
    for (const threshold of settings.alerts.thresholds) {
      const key = `${provider}:${snapshot.quotaKey}:remaining-${threshold}`;
      if (snapshot.remainingPercent <= threshold) {
        if (!alertState[key]) {
          await chrome.notifications.create(`quota-${key}`, {
            type: "basic",
            iconUrl: "icons/icon-128.png",
            title: "CodePlan 用量提醒",
            message: `${snapshot.displayName} 剩余 ${Math.round(snapshot.remainingPercent)}%，低于 ${threshold}% 阈值。`
          });
          alertState[key] = true;
          changed = true;
        }
      } else if (alertState[key]) {
        delete alertState[key];
        changed = true;
      }
    }
  }
  if (changed) await chrome.storage.local.set({ [ALERTS_KEY]: alertState });
}

export async function evaluateStaleAlerts(states: Record<ProviderId, ProviderState>, settings: AppSettings): Promise<void> {
  if (!settings.alerts.notificationsEnabled) return;
  const alertState = await getAlertState();
  let changed = false;
  for (const [provider, state] of Object.entries(states) as [ProviderId, ProviderState][]) {
    const key = `${provider}:stale`;
    const stale = settings.providers[provider].enabled && (!state.lastSuccessfulAt || Date.now() - Date.parse(state.lastSuccessfulAt) > settings.alerts.staleAfterMinutes * 60_000);
    if (stale && !alertState[key]) {
      await chrome.notifications.create(`stale-${provider}`, {
        type: "basic",
        iconUrl: "icons/icon-128.png",
        title: "CodePlan 数据已过期",
        message: `${provider} 的有效用量数据已超过 ${settings.alerts.staleAfterMinutes} 分钟未更新。`
      });
      alertState[key] = true;
      changed = true;
    } else if (!stale && alertState[key]) {
      delete alertState[key];
      changed = true;
    }
  }
  if (changed) await chrome.storage.local.set({ [ALERTS_KEY]: alertState });
}
