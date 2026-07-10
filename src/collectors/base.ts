import type {
  CollectionStatus,
  ParseDiagnostics,
  ParseResult,
  ProviderId,
  QuotaSnapshot,
  SnapshotSource,
  UsageScope,
  UsageUnit,
  WindowKind
} from "../shared/schema";
import { makeSnapshotId } from "../shared/schema";
import { findLabelContainer, getResetAt, hashText, normalizedText, pageFingerprint, parseCurrency, parseProgressBar } from "../shared/dom";

export const LABELS = {
  fiveHour: ["5 hour", "five hour", "5-hour", "5 小时", "5小时", "5小時", "5 小時", "5時間"],
  weekly: ["weekly", "week", "每周", "每週", "週間"],
  monthly: ["monthly", "month", "每月", "月間"],
  opus: ["opus"],
  allModels: ["all models", "all model", "所有模型", "全部模型", "全モデル"],
  primary: ["primary", "main limit", "主要限额", "主限額"],
  secondary: ["secondary", "additional limit", "次要限额", "次限額"],
  credit: ["usage credits", "credits", "credit", "额度余额", "信用额度", "余额"],
  reserve: ["reserve reset", "reserve resets", "extra reset", "额外重置", "储备重置", "予備リセット"],
  zenBalance: ["zen balance", "balance", "余额", "残高"],
  useBalance: ["use balance", "使用余额", "使用餘額", "残高を使用"],
  reset: ["reset", "resets", "重置", "リセット"]
};

export interface CollectorContext {
  url: string;
  document: Document;
  locale?: string;
  collectedAt: string;
}

export interface ProviderCollector {
  id: ProviderId;
  matches(url: URL): boolean;
  isUsagePage(document: Document, url: URL): boolean;
  parse(context: CollectorContext): ParseResult;
}

export interface QuotaSpec {
  quotaKey: string;
  displayName: string;
  labels: string[];
  windowKind: WindowKind;
  unit?: UsageUnit;
  scope?: UsageScope;
  preferRemaining?: boolean;
}

function allText(document: Document): string {
  return normalizedText(document.body?.textContent);
}

export function pageStatus(document: Document): CollectionStatus | undefined {
  const text = allText(document).toLowerCase();
  if (/captcha|verify you are human|unusual activity|安全验证|安全驗證|人機驗證/.test(text)) return "blocked";
  if (/sign in|log in|login|continue with|登录|登入|ログイン/.test(text) && !/usage|limit|额度|限额|用量|使用量/.test(text)) return "auth_required";
  if (document.querySelector('[aria-busy="true"]') && text.length < 250) return "page_not_ready";
  return undefined;
}

export function findContainer(document: Document, labels: string[]): HTMLElement | undefined {
  return findLabelContainer(document, labels);
}

function percentFromText(text: string, preferRemaining = false): { usedPercent?: number; remainingPercent?: number } | undefined {
  const percent = text.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (!percent) return undefined;
  const value = Number(percent[1].replace(",", "."));
  if (!Number.isFinite(value) || value < 0 || value > 100) return undefined;
  const isRemaining = /(?:remaining|left|available|剩余|剩餘|残り)/i.test(text);
  const isUsed = /(?:used|consumed|已用|已使用|使用済)/i.test(text);
  if (isRemaining || (preferRemaining && !isUsed)) return { usedPercent: 100 - value, remainingPercent: value };
  if (isUsed || !preferRemaining) return { usedPercent: value, remainingPercent: 100 - value };
  return undefined;
}

function amountsFromText(text: string): { used?: number; limit?: number; remaining?: number } | undefined {
  const slash = text.replace(/,/g, "").match(/(?:\$|usd|us\$|美元)?\s*(\d+(?:\.\d+)?)\s*(?:\/|of|out of|共)\s*(?:\$|usd|us\$|美元)?\s*(\d+(?:\.\d+)?)/i);
  if (slash) {
    const used = Number(slash[1]);
    const limit = Number(slash[2]);
    if (limit > 0 && used >= 0 && used <= limit * 1.1) return { used, limit, remaining: Math.max(0, limit - used) };
  }
  const remaining = text.match(/(?:remaining|left|available|余额|餘額|残高)\D{0,24}(?:\$|usd|us\$|美元)?\s*(\d+(?:[.,]\d+)?)/i);
  if (remaining) return { remaining: Number(remaining[1].replace(",", ".")) };
  return undefined;
}

export function snapshotFromContainer(
  provider: ProviderId,
  spec: QuotaSpec,
  container: HTMLElement,
  context: CollectorContext,
  parserVersion: string,
  scope: UsageScope = spec.scope ?? "unknown"
): QuotaSnapshot | undefined {
  const text = normalizedText(container.textContent);
  if (!text) return undefined;
  // A progress bar alone does not say whether its filled segment means used or
  // remaining. Prefer the visible, localized wording when the page supplies it.
  const progress = percentFromText(text, spec.preferRemaining) ?? parseProgressBar(container);
  const amounts = amountsFromText(text);
  const unit = spec.unit ?? (amounts?.limit != null || amounts?.remaining != null ? "usd" : "percent");
  const used = amounts?.used;
  const limit = amounts?.limit;
  const remaining = amounts?.remaining;
  const usedPercent = progress?.usedPercent ?? (used != null && limit ? used / limit * 100 : undefined);
  const remainingPercent = progress?.remainingPercent ?? (remaining != null && limit ? remaining / limit * 100 : undefined);
  const hasNumbers = usedPercent != null || remainingPercent != null || used != null || remaining != null;
  if (!hasNumbers) return undefined;

  const snapshot: QuotaSnapshot = {
    id: "",
    provider,
    quotaKey: spec.quotaKey,
    displayName: spec.displayName,
    windowKind: spec.windowKind,
    used,
    limit,
    remaining,
    usedPercent: usedPercent == null ? undefined : Math.min(100, Math.max(0, usedPercent)),
    remainingPercent: remainingPercent == null ? undefined : Math.min(100, Math.max(0, remainingPercent)),
    unit,
    resetsAt: getResetAt(container, new Date(context.collectedAt)),
    scope,
    source: "visible_dom" satisfies SnapshotSource,
    confidence: 0,
    parserVersion,
    fetchedAt: context.collectedAt,
    rawTextHash: hashText(text.replace(/\d+(?:[.,]\d+)?/g, "#"))
  };
  snapshot.id = makeSnapshotId(snapshot);
  return snapshot;
}

export function moneySnapshot(
  provider: ProviderId,
  spec: QuotaSpec,
  container: HTMLElement,
  context: CollectorContext,
  parserVersion: string,
  scope: UsageScope = spec.scope ?? "unknown"
): QuotaSnapshot | undefined {
  const text = normalizedText(container.textContent);
  const amount = parseCurrency(text);
  if (amount == null) return undefined;
  const snapshot: QuotaSnapshot = {
    id: "",
    provider,
    quotaKey: spec.quotaKey,
    displayName: spec.displayName,
    windowKind: spec.windowKind,
    remaining: amount,
    unit: spec.unit ?? "usd",
    scope,
    source: "visible_dom",
    confidence: 0,
    parserVersion,
    fetchedAt: context.collectedAt,
    rawTextHash: hashText(text.replace(/\d+(?:[.,]\d+)?/g, "#"))
  };
  snapshot.id = makeSnapshotId(snapshot);
  return snapshot;
}

export function createResult(
  provider: ProviderId,
  context: CollectorContext,
  parserVersion: string,
  snapshots: QuotaSnapshot[],
  matchedLabels: string[],
  requiredQuotaKeys: string[]
): ParseResult {
  const earlyStatus = pageStatus(context.document);
  const found = new Set(snapshots.map((snapshot) => snapshot.quotaKey));
  const missingFields = requiredQuotaKeys.filter((key) => !found.has(key));
  // A single-page app can render a long navigation tree before its usage cards.
  // This text is inspected only in memory and is never retained.
  const titleMatch = /usage|limit|额度|限额|用量|使用量/i.test(`${context.document.title} ${allText(context.document)}`);
  const hasProgress = snapshots.some((snapshot) => snapshot.usedPercent != null || snapshot.remainingPercent != null);
  const hasReset = snapshots.some((snapshot) => snapshot.resetsAt != null);
  const percentValid = snapshots.every((snapshot) =>
    (snapshot.usedPercent == null || (snapshot.usedPercent >= 0 && snapshot.usedPercent <= 100)) &&
    (snapshot.remainingPercent == null || (snapshot.remainingPercent >= 0 && snapshot.remainingPercent <= 100))
  );
  const confidence = Math.min(1,
    (titleMatch ? 0.3 : 0) +
    (matchedLabels.length ? 0.2 : 0) +
    (hasProgress ? 0.2 : 0) +
    (hasReset ? 0.15 : 0) +
    (percentValid && snapshots.length ? 0.1 : 0) +
    (pageFingerprint(context.document) ? 0.05 : 0)
  );
  const status = earlyStatus ?? (snapshots.length === 0 ? (titleMatch ? "parser_mismatch" : "page_not_ready") : missingFields.length ? "partial" : "ok");
  const diagnostics: ParseDiagnostics = {
    matchedLabels,
    missingFields: missingFields.length ? missingFields : undefined,
    pageFingerprint: pageFingerprint(context.document)
  };
  return {
    provider,
    status,
    snapshots: snapshots.map((snapshot) => ({ ...snapshot, confidence })),
    parserVersion,
    confidence,
    diagnostics
  };
}
