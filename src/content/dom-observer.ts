export function observeUsagePage(collect: () => void, delayMs = 700): () => void {
  let timer: number | undefined;
  const schedule = () => {
    if (timer != null) window.clearTimeout(timer);
    timer = window.setTimeout(collect, delayMs);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-valuenow", "aria-valuemax", "data-state", "aria-busy"]
  });
  window.addEventListener("popstate", schedule);
  window.addEventListener("hashchange", schedule);
  schedule();
  return () => {
    observer.disconnect();
    if (timer != null) window.clearTimeout(timer);
    window.removeEventListener("popstate", schedule);
    window.removeEventListener("hashchange", schedule);
  };
}
