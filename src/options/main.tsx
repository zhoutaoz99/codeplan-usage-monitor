import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AppSettings } from "../shared/schema";
import { defaultSettings } from "../shared/schema";
import { sendRuntimeMessage } from "../dashboard/runtime";
import "../dashboard/styles.css";

type Response = { ok: boolean; error?: string; settings?: AppSettings };

function Options() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings());
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    void sendRuntimeMessage<Response>({ type: "GET_SETTINGS" }).then((response) => {
      if (response.settings) setSettings(response.settings);
    });
  }, []);

  const save = async (next: AppSettings) => {
    setSettings(next);
    const response = await sendRuntimeMessage<Response>({ type: "UPDATE_SETTINGS", settings: next });
    setNotice(response.ok ? "设置已保存在此浏览器中。" : response.error ?? "保存失败");
  };

  const updateThresholds = (value: string) => {
    const thresholds = Array.from(new Set(value.split(",").map((item) => Number(item.trim())).filter((item) => Number.isFinite(item) && item >= 0 && item <= 100))).sort((a, b) => b - a);
    void save({ ...settings, alerts: { ...settings.alerts, thresholds } });
  };

  const clearData = async () => {
    if (!window.confirm("清除所有本地快照、历史、连接地址和告警设置？这不会影响任何官方账户。")) return;
    const response = await sendRuntimeMessage<Response>({ type: "CLEAR_LOCAL_DATA" });
    if (response.ok) {
      setSettings(defaultSettings());
      setNotice("本地数据已清除。站点权限可在浏览器扩展管理页面中单独撤销。");
    } else setNotice(response.error ?? "清除失败");
  };

  return <main className="app" style={{ maxWidth: 720 }}>
    <header className="app-header"><div><h1>CodePlan 设置</h1><p>所有数据仅保存于当前浏览器。扩展从不保存 Cookie、Token、聊天内容、Prompt 或代码。</p></div></header>
    {notice && <p className="notice">{notice}</p>}
    <section className="provider-card">
      <h2>本地通知</h2>
      <label className="option-row"><span>启用浏览器通知</span><input type="checkbox" checked={settings.alerts.notificationsEnabled} onChange={(event) => void save({ ...settings, alerts: { ...settings.alerts, notificationsEnabled: event.target.checked } })} /></label>
      <label className="option-field">剩余阈值（逗号分隔，百分比）<input defaultValue={settings.alerts.thresholds.join(", ")} onBlur={(event) => updateThresholds(event.target.value)} placeholder="50, 20, 10" /></label>
      <label className="option-field">数据过期阈值（分钟）<input type="number" min="2" max="1440" value={settings.alerts.staleAfterMinutes} onChange={(event) => void save({ ...settings, alerts: { ...settings.alerts, staleAfterMinutes: Math.max(2, Number(event.target.value) || 10) } })} /></label>
    </section>
    <section className="provider-card">
      <h2>面板显示</h2>
      <label className="option-row"><span>显示 7 天已用额度趋势</span><input type="checkbox" checked={settings.showSevenDayUsageTrend} onChange={(event) => void save({ ...settings, showSevenDayUsageTrend: event.target.checked })} /></label>
    </section>
    <section className="provider-card">
      <h2>本地数据</h2>
      <p className="option-copy">原始快照保留 7 天，15 分钟聚合保留 30 天，小时聚合保留 180 天；之后保留日级历史用于趋势图。清除不会影响 Claude、ChatGPT 或 OpenCode 的账户数据，也不会自动撤销网站权限。</p>
      <button type="button" className="button-secondary" onClick={() => void clearData()}>清除全部本地数据</button>
    </section>
  </main>;
}

createRoot(document.getElementById("root")!).render(<Options />);
