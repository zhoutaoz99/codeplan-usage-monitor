export function opencodeWorkspaceIdFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "opencode.ai") return undefined;
    return parsed.pathname.match(/^\/workspace\/(wrk_[^/]+)\/go\/?$/i)?.[1];
  } catch {
    return undefined;
  }
}

export function opencodeGoUrl(workspaceId: string): string {
  return `https://opencode.ai/workspace/${workspaceId}/go`;
}
