import type { ProviderDefinition, ProviderState, QuotaSnapshot } from "../shared/schema";
import { formatReset, formatResetCountdown, isResetWithin24Hours, relativeTime } from "../shared/time";
import { HistoryChart } from "./HistoryChart";

const STATUS: Record<string, string> = {
  ok: "数据正常",
  partial: "数据可能不完整",
  auth_required: "需要登录",
  page_not_ready: "页面尚未就绪",
  parser_mismatch: "页面结构无法确认",
  blocked: "页面要求安全验证"
};

const WINDOW_ORDER = { rolling_5h: 0, weekly: 1, monthly: 2 } as const;

function visibleUsageWindows(snapshots: QuotaSnapshot[]): QuotaSnapshot[] {
  return snapshots
    .filter((snapshot) => snapshot.windowKind === "rolling_5h" || snapshot.windowKind === "weekly" || snapshot.windowKind === "monthly")
    .sort((left, right) => WINDOW_ORDER[left.windowKind as keyof typeof WINDOW_ORDER] - WINDOW_ORDER[right.windowKind as keyof typeof WINDOW_ORDER] || left.displayName.localeCompare(right.displayName));
}

function quotaLabel(snapshot: QuotaSnapshot): string {
  if (snapshot.quotaKey === "use_balance") return snapshot.remaining ? "已开启" : "已关闭";
  const usedFromAmounts = snapshot.used ?? (snapshot.limit != null && snapshot.remaining != null ? Math.max(0, snapshot.limit - snapshot.remaining) : undefined);
  if (snapshot.limit != null && usedFromAmounts != null) {
    const prefix = snapshot.unit === "usd" ? "$" : "";
    return `已用 ${prefix}${usedFromAmounts.toFixed(2)} / ${prefix}${snapshot.limit.toFixed(2)}`;
  }
  const usedPercent = snapshot.usedPercent ?? (snapshot.remainingPercent != null ? 100 - snapshot.remainingPercent : undefined);
  if (usedPercent != null) return `已用 ${Math.round(usedPercent)}%`;
  if (snapshot.used != null) return `已用 ${snapshot.used}`;
  if (snapshot.remaining != null && snapshot.unit === "usd") return `余额 $${snapshot.remaining.toFixed(2)}`;
  if (snapshot.remaining != null) return `可用 ${snapshot.remaining}`;
  return "等待可见数据";
}

function level(snapshot: QuotaSnapshot): string {
  const used = snapshot.usedPercent ?? (snapshot.remainingPercent != null ? 100 - snapshot.remainingPercent : undefined);
  if (used == null) return "neutral";
  if (used >= 99) return "empty";
  if (used > 80) return "danger";
  if (used >= 50) return "warning";
  return "healthy";
}

function resetText(snapshot: QuotaSnapshot): string | undefined {
  if (snapshot.windowKind === "weekly") {
    if (isResetWithin24Hours(snapshot.resetsAt)) {
      const countdown = formatResetCountdown(snapshot.resetsAt);
      return countdown ? `倒计时：${countdown}` : undefined;
    }
    const reset = formatReset(snapshot.resetsAt, true);
    return reset ? `重置：${reset}` : undefined;
  }

  const reset = formatReset(snapshot.resetsAt);
  if (snapshot.windowKind !== "rolling_5h") return reset ? `重置：${reset}` : undefined;
  const countdown = formatResetCountdown(snapshot.resetsAt);
  return [countdown && `倒计时：${countdown}`, reset && `重置：${reset}`].filter(Boolean).join(" · ") || undefined;
}

export function ProviderCard({
  definition,
  state,
  enabled,
  showSevenDayUsageTrend,
  busy,
  onConnect,
  onRefresh,
  onDisconnect
}: {
  definition: ProviderDefinition;
  state: ProviderState;
  enabled: boolean;
  showSevenDayUsageTrend: boolean;
  busy: boolean;
  onConnect: () => void;
  onRefresh: () => void;
  onDisconnect: () => void;
}) {
  const windows = visibleUsageWindows(state.latest);
  const weeklyWindow = windows.find((snapshot) =>
    snapshot.windowKind === "weekly" && (snapshot.usedPercent != null || snapshot.remainingPercent != null || snapshot.limit != null)
  );
  const confidence = state.lastResult ? Math.round(state.lastResult.confidence * 100) : undefined;
  return (
    <section className={`provider-card ${enabled ? "" : "provider-card--inactive"}`}>
      <div className="provider-heading">
        <div>
          <h2>{definition.name}</h2>
          <p>{definition.scopeLabel}</p>
        </div>
        <span className={`status status--${state.lastResult?.status ?? "idle"}`}>{state.lastResult ? STATUS[state.lastResult.status] : "未连接"}</span>
      </div>

      {!enabled ? (
        <div className="empty-state">
          <p>{definition.id === "opencode_go" ? "请先在当前标签打开自己的 OpenCode Go 页面，再点击连接。" : "未授权访问此平台的用量页面。"}</p>
          <button type="button" onClick={onConnect} disabled={busy}>连接 {definition.name}</button>
        </div>
      ) : (
        <>
          <div className="quota-list">
            {windows.length ? windows.map((snapshot) => (
              <div className="quota-row" key={snapshot.quotaKey}>
                <div>
                  <span>{snapshot.displayName}</span>
                  {resetText(snapshot) && <small>{resetText(snapshot)}</small>}
                </div>
                <strong className={`quota-value quota-value--${level(snapshot)}`}>{quotaLabel(snapshot)}</strong>
              </div>
            )) : <p className="empty-state">打开官方用量页面并完成登录后，5 小时、每周和每月窗口会显示在这里。</p>}
          </div>
          {showSevenDayUsageTrend && weeklyWindow && <HistoryChart provider={definition.id} quotaKey={weeklyWindow.quotaKey} />}
          <div className="card-meta">
            <span>来源：可见页面 DOM</span>
            <span>更新：{relativeTime(state.lastSuccessfulAt)}</span>
            {confidence != null && <span>可信度：{confidence}%</span>}
          </div>
          {state.lastError && <p className="error-text">最近错误：{state.lastError}</p>}
          <div className="card-actions">
            <button type="button" className="button-secondary" onClick={onRefresh} disabled={busy}>刷新</button>
            <button type="button" className="button-danger" onClick={onDisconnect} disabled={busy}>断开并撤销页面访问</button>
          </div>
        </>
      )}
    </section>
  );
}
