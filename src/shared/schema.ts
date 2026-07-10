import { z } from "zod";

export const PROVIDER_IDS = ["claude", "codex", "opencode_go"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const COLLECTION_STATUSES = [
  "ok",
  "partial",
  "auth_required",
  "page_not_ready",
  "parser_mismatch",
  "blocked"
] as const;
export type CollectionStatus = (typeof COLLECTION_STATUSES)[number];

export const WINDOW_KINDS = [
  "rolling_5h",
  "weekly",
  "monthly",
  "credits",
  "reserve_reset",
  "unknown"
] as const;
export type WindowKind = (typeof WINDOW_KINDS)[number];

export const USAGE_UNITS = [
  "percent",
  "usd",
  "credits",
  "requests",
  "tokens",
  "vendor_native"
] as const;
export type UsageUnit = (typeof USAGE_UNITS)[number];

export const SCOPES = [
  "account",
  "workspace",
  "shared_pool",
  "product",
  "unknown"
] as const;
export type UsageScope = (typeof SCOPES)[number];

export const SOURCES = ["visible_dom", "embedded_data", "manual"] as const;
export type SnapshotSource = (typeof SOURCES)[number];

export const quotaSnapshotSchema = z.object({
  id: z.string(),
  provider: z.enum(PROVIDER_IDS),
  accountKey: z.string().optional(),
  workspaceKey: z.string().optional(),
  planName: z.string().optional(),
  quotaKey: z.string(),
  displayName: z.string(),
  windowKind: z.enum(WINDOW_KINDS),
  used: z.number().finite().optional(),
  limit: z.number().finite().positive().optional(),
  remaining: z.number().finite().min(0).optional(),
  usedPercent: z.number().finite().min(0).max(100).optional(),
  remainingPercent: z.number().finite().min(0).max(100).optional(),
  unit: z.enum(USAGE_UNITS),
  resetsAt: z.string().datetime().optional(),
  periodStartedAt: z.string().datetime().optional(),
  scope: z.enum(SCOPES),
  source: z.enum(SOURCES),
  confidence: z.number().min(0).max(1),
  parserVersion: z.string(),
  fetchedAt: z.string().datetime(),
  rawTextHash: z.string().optional()
});
export type QuotaSnapshot = z.infer<typeof quotaSnapshotSchema>;

export const parseDiagnosticsSchema = z.object({
  matchedLabels: z.array(z.string()).optional(),
  missingFields: z.array(z.string()).optional(),
  pageFingerprint: z.string().optional()
});
export type ParseDiagnostics = z.infer<typeof parseDiagnosticsSchema>;

export const parseResultSchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  status: z.enum(COLLECTION_STATUSES),
  snapshots: z.array(quotaSnapshotSchema),
  parserVersion: z.string(),
  confidence: z.number().min(0).max(1),
  diagnostics: parseDiagnosticsSchema.optional()
});
export type ParseResult = z.infer<typeof parseResultSchema>;

export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  hostPermission: string;
  defaultUrl: string;
  scopeLabel: string;
  intervalMinutes: number;
}

export const PROVIDERS: Record<ProviderId, ProviderDefinition> = {
  claude: {
    id: "claude",
    name: "Claude",
    hostPermission: "https://claude.ai/*",
    defaultUrl: "https://claude.ai/settings/usage",
    scopeLabel: "Claude 账户共享用量",
    intervalMinutes: 1
  },
  codex: {
    id: "codex",
    name: "Codex",
    hostPermission: "https://chatgpt.com/*",
    defaultUrl: "https://chatgpt.com/codex/cloud/settings/analytics#usage",
    scopeLabel: "Codex 或 Agentic 共享用量",
    intervalMinutes: 1
  },
  opencode_go: {
    id: "opencode_go",
    name: "OpenCode Go",
    hostPermission: "https://opencode.ai/*",
    defaultUrl: "https://opencode.ai/",
    scopeLabel: "OpenCode Go 工作区用量",
    intervalMinutes: 1
  }
};

export interface ProviderSettings {
  enabled: boolean;
  usageUrl?: string;
  workspaceId?: string;
  lastPageFingerprint?: string;
  pausedUntil?: string;
}

export interface AlertSettings {
  thresholds: number[];
  staleAfterMinutes: number;
  notificationsEnabled: boolean;
}

export interface AppSettings {
  providers: Record<ProviderId, ProviderSettings>;
  alerts: AlertSettings;
  showSevenDayUsageTrend: boolean;
}

export interface ProviderState {
  provider: ProviderId;
  latest: QuotaSnapshot[];
  lastResult?: ParseResult;
  lastSuccessfulAt?: string;
  lastAttemptAt?: string;
  lastError?: string;
  failureCount?: number;
  nextRetryAt?: string;
}

export interface DashboardState {
  settings: AppSettings;
  providers: Record<ProviderId, ProviderState>;
}

export const defaultSettings = (): AppSettings => ({
  providers: {
    claude: { enabled: false },
    codex: { enabled: false },
    opencode_go: { enabled: false }
  },
  alerts: {
    thresholds: [50, 20, 10],
    staleAfterMinutes: 10,
    notificationsEnabled: true
  },
  showSevenDayUsageTrend: false
});

export const defaultProviderState = (provider: ProviderId): ProviderState => ({
  provider,
  latest: []
});

export function makeSnapshotId(snapshot: Pick<QuotaSnapshot, "provider" | "quotaKey" | "fetchedAt">): string {
  return `${snapshot.provider}:${snapshot.quotaKey}:${snapshot.fetchedAt}`;
}
