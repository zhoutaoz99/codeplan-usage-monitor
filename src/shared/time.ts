import type { QuotaSnapshot } from "./schema";

const numberPattern = "(\\d+(?:[.,]\\d+)?)";

function nextWeekdayAt(text: string, now: Date): string | undefined {
  const englishWeekday = text.match(/\b(sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)\b/i);
  const chineseWeekday = text.match(/(?:星期|周|週)\s*([日天一二三四五六])/);
  const englishDays: Record<string, number> = {
    sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
    thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6
  };
  const chineseDays: Record<string, number> = { "日": 0, "天": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6 };
  const weekday = englishWeekday ? englishDays[englishWeekday[1].toLowerCase()] : chineseWeekday ? chineseDays[chineseWeekday[1]] : undefined;
  const time = text.match(/(\d{1,2})\s*[:：]\s*(\d{2})(?:\s*(am|pm))?/i);
  if (weekday == null || !time) return undefined;

  let hour = Number(time[1]);
  const minute = Number(time[2]);
  const meridiem = time[3]?.toLowerCase();
  if (hour > 23 || minute > 59 || (meridiem && hour > 12)) return undefined;
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  const target = new Date(now);
  target.setDate(target.getDate() + (weekday - target.getDay() + 7) % 7);
  target.setHours(hour, minute, 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 7);
  return target.toISOString();
}

export function toIsoFromRelative(raw: string, now = new Date()): string | undefined {
  const text = raw.trim().toLowerCase().replace(/，/g, ",");
  const chineseDate = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})\s*[:：]\s*(\d{2})/);
  if (chineseDate) {
    const [, year, month, day, hour, minute] = chineseDate;
    return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)).toISOString();
  }
  const clockTime = text.match(/^(\d{1,2})\s*[:：]\s*(\d{2})$/);
  if (clockTime) {
    const target = new Date(now);
    target.setHours(Number(clockTime[1]), Number(clockTime[2]), 0, 0);
    if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
    return target.toISOString();
  }
  const weekdayTime = nextWeekdayAt(text, now);
  if (weekdayTime) return weekdayTime;
  const minutes = text.match(new RegExp(`${numberPattern}\\s*(?:minutes?|mins?|分钟|分後|分后|分)`));
  const hours = text.match(new RegExp(`${numberPattern}\\s*(?:hours?|hrs?|小时|小時|時間|時)`));
  const days = text.match(new RegExp(`${numberPattern}\\s*(?:days?|天|日)`));
  const weeks = text.match(new RegExp(`${numberPattern}\\s*(?:weeks?|周|週)`));
  const parse = (match: RegExpMatchArray | null) => match ? Number(match[1].replace(",", ".")) : 0;
  const milliseconds = parse(minutes) * 60_000 + parse(hours) * 3_600_000 + parse(days) * 86_400_000 + parse(weeks) * 604_800_000;

  // Callers extract the reset phrase before passing its value here, so strings
  // such as "4 hr 33 min" no longer contain the word "reset" or "in".
  if (milliseconds > 0) {
    return new Date(now.getTime() + milliseconds).toISOString();
  }

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) && parsed > now.getTime() - 60_000 ? new Date(parsed).toISOString() : undefined;
}

export function relativeTime(iso?: string): string {
  if (!iso) return "尚未更新";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes <= 0) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export function formatReset(iso?: string, includeWeekday = false): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  const dateTime = new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
  if (!includeWeekday) return dateTime;
  const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(date);
  return `${weekday} ${dateTime}`;
}

export function isResetWithin24Hours(iso?: string, now = new Date()): boolean {
  if (!iso) return false;
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return false;
  const remainingMilliseconds = target - now.getTime();
  return remainingMilliseconds > 0 && remainingMilliseconds < 24 * 60 * 60 * 1_000;
}

export function formatResetCountdown(iso?: string, now = new Date()): string | undefined {
  if (!iso) return undefined;
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return undefined;
  const remainingMinutes = Math.ceil((target - now.getTime()) / 60_000);
  if (remainingMinutes <= 0) return "已到重置时间";
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  return `${hours}小时${minutes}分`;
}

export function calculateBurnRate(previous: QuotaSnapshot, current: QuotaSnapshot): number | undefined {
  if (previous.remainingPercent == null || current.remainingPercent == null) return undefined;
  const elapsedHours = (Date.parse(current.fetchedAt) - Date.parse(previous.fetchedAt)) / 3_600_000;
  if (elapsedHours <= 0) return undefined;
  const consumed = previous.remainingPercent - current.remainingPercent;
  return consumed <= 0 ? 0 : consumed / elapsedHours;
}

export function estimatedExhaustion(remainingPercent: number | undefined, ratePerHour: number | undefined): string | undefined {
  if (remainingPercent == null || ratePerHour == null || ratePerHour <= 0) return undefined;
  const hours = remainingPercent / ratePerHour;
  if (!Number.isFinite(hours) || hours > 24 * 30) return undefined;
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}
