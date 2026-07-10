import { useCallback, useEffect, useState } from "react";
import { PROVIDERS, PROVIDER_IDS, type DashboardState, type ProviderId } from "../shared/schema";
import { ProviderCard } from "./ProviderCard";
import { sendRuntimeMessage } from "./runtime";
import "./styles.css";

type Response = { ok: boolean; error?: string; state?: DashboardState };

export function App() {
  const [state, setState] = useState<DashboardState>();
  const [busy, setBusy] = useState<ProviderId | "all" | undefined>();
  const [notice, setNotice] = useState<string>();

  const load = useCallback(async () => {
    const response = await sendRuntimeMessage<Response>({ type: "GET_DASHBOARD" });
    if (response.state) setState(response.state);
  }, []);

  useEffect(() => {
    void load();
    const listener = () => void load();
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [load]);

  const run = async (task: () => Promise<Response>, target: ProviderId | "all") => {
    setBusy(target);
    setNotice(undefined);
    try {
      const response = await task();
      if (!response.ok) setNotice(response.error ?? "操作失败");
      if (response.state) setState(response.state);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(undefined);
    }
  };

  const connect = (provider: ProviderId) => void run(async () => {
    const granted = await chrome.permissions.request({ origins: [PROVIDERS[provider].hostPermission] });
    if (!granted) return { ok: false, error: "未授予站点访问权限；不会读取任何页面数据。" };
    return sendRuntimeMessage<Response>({ type: "CONNECT_PROVIDER", provider });
  }, provider);

  const disconnect = (provider: ProviderId) => void run(async () => {
    // Older installs declared these hosts through static content scripts, which
    // Chrome treats as required permissions. Disconnect must still stop
    // collection even if such an old grant cannot be removed.
    await chrome.permissions.remove({ origins: [PROVIDERS[provider].hostPermission] }).catch(() => undefined);
    return sendRuntimeMessage<Response>({ type: "DISCONNECT_PROVIDER", provider });
  }, provider);

  if (!state) return <main className="app loading">正在读取本地用量数据…</main>;
  return (
    <main className="app">
      <header className="app-header">
        <div>
          <h1>CodePlan 用量</h1>
          <p>仅在本机读取已授权页面的可见额度；不会读取 Cookie、聊天或代码。</p>
        </div>
        <div className="header-actions">
          <button type="button" className="button-secondary" onClick={() => void run(() => sendRuntimeMessage<Response>({ type: "OPEN_OPTIONS" }), "all")}>设置</button>
          <button type="button" onClick={() => void run(() => sendRuntimeMessage<Response>({ type: "REFRESH_ALL" }), "all")} disabled={busy != null}>{busy === "all" ? "刷新中…" : "全部刷新"}</button>
        </div>
      </header>
      {notice && <p className="notice" role="alert">{notice}</p>}
      <div className="provider-grid">
        {PROVIDER_IDS.map((provider) => (
          <ProviderCard
            key={provider}
            definition={PROVIDERS[provider]}
            state={state.providers[provider]}
            enabled={state.settings.providers[provider].enabled}
            showSevenDayUsageTrend={state.settings.showSevenDayUsageTrend}
            busy={busy != null}
            onConnect={() => connect(provider)}
            onRefresh={() => void run(() => sendRuntimeMessage<Response>({ type: "REFRESH_PROVIDER", provider }), provider)}
            onDisconnect={() => disconnect(provider)}
          />
        ))}
      </div>
      <footer>数据仅保存在此浏览器。为展示历史趋势，原始快照保留 7 天，之后会逐步汇总为 15 分钟、小时和天级数据。趋势图仅反映已采集的页面数据，不代表官方用量或预测。</footer>
    </main>
  );
}
