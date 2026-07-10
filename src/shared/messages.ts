import type { AppSettings, DashboardState, ParseResult, ProviderId } from "./schema";

export type RuntimeMessage =
  | { type: "CONTENT_READY"; provider: ProviderId; url: string }
  | { type: "COLLECT_NOW"; requestId?: string; allowConfiguredUsageUrl?: boolean }
  | { type: "COLLECT_RESULT"; provider: ProviderId; url: string; result: ParseResult; live?: boolean }
  | { type: "GET_DASHBOARD" }
  | { type: "REFRESH_ALL" }
  | { type: "REFRESH_PROVIDER"; provider: ProviderId }
  | { type: "CONNECT_PROVIDER"; provider: ProviderId }
  | { type: "DISCONNECT_PROVIDER"; provider: ProviderId }
  | { type: "SET_PROVIDER_ENABLED"; provider: ProviderId; enabled: boolean }
  | { type: "GET_HISTORY"; provider: ProviderId; quotaKey: string; days?: number }
  | { type: "GET_SETTINGS" }
  | { type: "UPDATE_SETTINGS"; settings: AppSettings }
  | { type: "CLEAR_LOCAL_DATA" }
  | { type: "OPEN_OPTIONS" };

export interface MessageResponse {
  ok: boolean;
  error?: string;
  state?: DashboardState;
  result?: ParseResult;
  history?: unknown[];
}
