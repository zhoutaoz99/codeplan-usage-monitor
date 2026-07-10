import { useEffect, useMemo, useState } from "react";
import type { QuotaSnapshot } from "../shared/schema";
import { sendRuntimeMessage } from "./runtime";

export function HistoryChart({ provider, quotaKey }: { provider: QuotaSnapshot["provider"]; quotaKey: string }) {
  const [history, setHistory] = useState<QuotaSnapshot[]>([]);

  useEffect(() => {
    void sendRuntimeMessage<{ history?: QuotaSnapshot[] }>({ type: "GET_HISTORY", provider, quotaKey, days: 7 })
      .then((response) => setHistory(response.history ?? []))
      .catch(() => setHistory([]));
  }, [provider, quotaKey]);

  const points = useMemo(() => {
    const values = history.map((item) => {
      if (item.usedPercent != null) return item.usedPercent;
      if (item.remainingPercent != null) return 100 - item.remainingPercent;
      if (item.limit && item.used != null) return item.used / item.limit * 100;
      if (item.limit && item.remaining != null) return (item.limit - item.remaining) / item.limit * 100;
      return undefined;
    }).filter((value): value is number => value != null);
    if (values.length < 2) return "";
    return values.map((value, index) => {
      const x = 4 + index / (values.length - 1) * 192;
      const y = 56 - Math.max(0, Math.min(100, value)) / 100 * 48;
      return `${x},${y}`;
    }).join(" ");
  }, [history]);

  if (!history.length) return <p className="history-empty">尚无足够历史数据</p>;
  return (
    <div className="history" aria-label="最近 7 天已用额度趋势">
      <div className="history-title">7 天已用额度趋势</div>
      <svg viewBox="0 0 200 60" role="img" aria-label="用量趋势图">
        <path d="M4 56H196" className="chart-grid" />
        <path d="M4 32H196" className="chart-grid" />
        {points && <polyline points={points} className="chart-line" />}
      </svg>
    </div>
  );
}
