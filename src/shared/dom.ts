import { toIsoFromRelative } from "./time";

export interface ProgressValue {
  usedPercent?: number;
  remainingPercent?: number;
}

export function normalizedText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function parseNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const normalized = raw.replace(/,/g, "").replace(/\s/g, "");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

export function parseCurrency(raw: string): number | undefined {
  const match = raw.replace(/,/g, "").match(/(?:\$|usd|us\$|美元)?\s*(\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : undefined;
}

export function parseProgressBar(root: ParentNode): ProgressValue | undefined {
  const bars = Array.from(root.querySelectorAll<HTMLElement>('[role="progressbar"], progress'));
  for (const bar of bars) {
    const element = bar as HTMLProgressElement;
    const now = Number(bar.getAttribute("aria-valuenow") ?? (bar.tagName === "PROGRESS" ? element.value : Number.NaN));
    const max = Number(bar.getAttribute("aria-valuemax") ?? (bar.tagName === "PROGRESS" ? element.max : 100));
    if (Number.isFinite(now) && Number.isFinite(max) && max > 0) {
      const usedPercent = Math.min(100, Math.max(0, now / max * 100));
      return { usedPercent, remainingPercent: 100 - usedPercent };
    }
    // Some current usage cards expose their visible percentage through an
    // accessible label instead of aria-valuenow. It is still page-visible DOM
    // and avoids depending on private page data or CSS implementation details.
    const accessibleText = `${bar.getAttribute("aria-valuetext") ?? ""} ${bar.getAttribute("aria-label") ?? ""}`;
    const percent = accessibleText.match(/(\d+(?:[.,]\d+)?)\s*%/);
    if (!percent) continue;
    const value = Number(percent[1].replace(",", "."));
    if (!Number.isFinite(value) || value < 0 || value > 100) continue;
    const remaining = /(?:remaining|left|available|剩余|剩餘|残り)/i.test(accessibleText);
    return remaining
      ? { usedPercent: 100 - value, remainingPercent: value }
      : { usedPercent: value, remainingPercent: 100 - value };
  }
  return undefined;
}

export function closestMeaningfulContainer(node: Element): HTMLElement {
  let current: Element | null = node;
  let fallback: HTMLElement | undefined;
  let metricContainer: HTMLElement | undefined;
  for (let i = 0; current && i < 5; i += 1, current = current.parentElement) {
    const text = normalizedText(current.textContent);
    if (text.length >= 12 && text.length <= 500) fallback = current as HTMLElement;
    const hasMetric = Boolean(current.querySelector('[role="progressbar"], progress')) || /(?:\d+(?:[.,]\d+)?\s*%|(?:\$|usd|us\$|美元)\s*\d+(?:[.,]\d+)?)/i.test(text);
    if (text.length <= 500 && hasMetric) {
      metricContainer ??= current as HTMLElement;
      // A header row can contain the label and percentage while the reset line
      // is a sibling immediately below it. Prefer the smallest card containing
      // both, but avoid stepping up to a parent that groups several cards.
      const percentCount = (text.match(/\d+(?:[.,]\d+)?\s*%/g) ?? []).length;
      const progressCount = current.querySelectorAll('[role="progressbar"], progress').length;
      const hasReset = /(?:reset(?:s|ting)?|重置|将在|將在|リセット)/i.test(text);
      if (hasReset && percentCount <= 1 && progressCount <= 1) return current as HTMLElement;
    }
  }
  return metricContainer ?? fallback ?? node.parentElement as HTMLElement ?? document.body;
}

export function findLabelContainer(document: Document, labels: string[]): HTMLElement | undefined {
  const all = Array.from(document.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6,p,span,div,dt,th,label,[aria-label]"));
  const matches = all.filter((element) => {
    const text = `${normalizedText(element.textContent)} ${element.getAttribute("aria-label") ?? ""}`.toLowerCase();
    return text.length <= 500 && labels.some((label) => text.includes(label.toLowerCase()));
  });
  const match = matches.sort((left, right) => normalizedText(left.textContent).length - normalizedText(right.textContent).length)[0];
  return match ? closestMeaningfulContainer(match) : undefined;
}

export function getResetAt(root: ParentNode, now = new Date()): string | undefined {
  const text = normalizedText(root.textContent);
  const match = text.match(/(?:reset(?:s|ting)?(?:\s+(?:in|at|on))?|resets?\s+in|重置(?:时间|時間|于)?|将在|將在|リセット)\s*[:：]?\s*([^|·\n]{1,70})/i);
  return toIsoFromRelative(match?.[1] ?? text, now);
}

export function hashText(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function pageFingerprint(document: Document): string {
  const headings = Array.from(document.querySelectorAll("h1,h2,h3,[role=heading]"))
    .slice(0, 12)
    .map((element) => normalizedText(element.textContent).replace(/\d+(?:[.,]\d+)?/g, "#"));
  const ariaNames = Array.from(document.querySelectorAll("[aria-label],[role=progressbar]"))
    .slice(0, 12)
    .map((element) => `${element.tagName}:${element.getAttribute("aria-label") ?? element.getAttribute("role") ?? ""}`);
  return hashText(`${document.title}|${headings.join("|")}|${ariaNames.join("|")}`);
}
