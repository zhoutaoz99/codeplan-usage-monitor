export const REFRESH_ALARM_NAME = "refresh-all-providers";
const REFRESH_INTERVAL_MINUTES = 1;

export async function ensureRefreshAlarm(): Promise<void> {
  const alarm = await chrome.alarms.get(REFRESH_ALARM_NAME);
  if (alarm?.periodInMinutes === REFRESH_INTERVAL_MINUTES) return;
  if (alarm) await chrome.alarms.clear(REFRESH_ALARM_NAME);
  await chrome.alarms.create(REFRESH_ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: REFRESH_INTERVAL_MINUTES
  });
}
