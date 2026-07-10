import type { RuntimeMessage } from "../shared/messages";

export async function sendRuntimeMessage<T = Record<string, unknown>>(message: RuntimeMessage): Promise<T> {
  let runtime: typeof chrome.runtime | undefined;
  try {
    runtime = typeof chrome === "undefined" ? undefined : chrome.runtime;
  } catch {
    runtime = undefined;
  }
  if (!runtime?.id) throw new Error("扩展已更新，请关闭并重新打开侧边栏。");
  try {
    return await runtime.sendMessage(message) as T;
  } catch (error) {
    if (/extension context invalidated/i.test(error instanceof Error ? error.message : "")) {
      throw new Error("扩展已更新，请关闭并重新打开侧边栏。");
    }
    throw error;
  }
}
