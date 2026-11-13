import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  format,
  isWithinInterval,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { zhCN } from "date-fns/locale";

export const DATE_FORMAT = "yyyy-MM-dd";
export const toDateKey = (date: Date) => format(date, DATE_FORMAT);
export const fromDateKey = (value: string) => parseISO(value);
export const todayKey = () => toDateKey(new Date());
/** UTC/ISO 时间戳 → 本地日期键。timestamp 转日期一律走这里，禁止 slice(0,10)（UTC 截断在本地 0-8 点会差一天） */
export const toLocalDateKey = (isoTimestamp: string) => toDateKey(new Date(isoTimestamp));

export const formatLongDate = (value: string) =>
  format(fromDateKey(value), "M月d日 EEEE", { locale: zhCN });

export const formatFullDate = (value: string) =>
  format(fromDateKey(value), "yyyy年M月d日 EEEE", { locale: zhCN });

export const formatCompactDate = (value: string) =>
  format(fromDateKey(value), "M月d日", { locale: zhCN });

/** 相对今天的口语说法：今天 / 昨天 / 明天 / 前天 / 后天 / N 天前 / N 天后 */
export function relativeDayLabel(date: string, today: string = todayKey()): string {
  const diff = differenceInCalendarDays(fromDateKey(date), fromDateKey(today));
  if (diff === 0) return "今天";
  if (diff === -1) return "昨天";
  if (diff === 1) return "明天";
  if (diff === -2) return "前天";
  if (diff === 2) return "后天";
  return diff < 0 ? `${-diff} 天前` : `${diff} 天后`;
}

/** 离开页面多久后回来，今日页自动回到今天 */
export const RETURN_TO_TODAY_AFTER_HIDDEN_MS = 30 * 60 * 1000;

/**
 * 今日页是否应自动跳回今天：跨了零点（隔夜没关的 iPad 早上不该还停在昨天），
 * 或页面在后台放了足够久（上次有人翻到别的日期后离开）。
 */
export function shouldReturnToToday(lastSeenToday: string, today: string, hiddenMs = 0): boolean {
  return lastSeenToday !== today || hiddenMs >= RETURN_TO_TODAY_AFTER_HIDDEN_MS;
}

export const getWeekStartKey = (value: string | Date) =>
  toDateKey(startOfWeek(typeof value === "string" ? fromDateKey(value) : value, { weekStartsOn: 1 }));

export const getWeekEndKey = (value: string | Date) =>
  toDateKey(endOfWeek(typeof value === "string" ? fromDateKey(value) : value, { weekStartsOn: 1 }));

export const getMonthKey = (value: string | Date) =>
  format(typeof value === "string" ? fromDateKey(value) : value, "yyyy-MM");

export const getMonthBounds = (value: string | Date) => {
  const date = typeof value === "string" ? fromDateKey(value) : value;
  return { start: toDateKey(startOfMonth(date)), end: toDateKey(endOfMonth(date)) };
};

export const isDateInRange = (date: string, start: string, end: string) =>
  isWithinInterval(fromDateKey(date), { start: fromDateKey(start), end: fromDateKey(end) });

export const getUpcomingDateKeys = (from: string, days: number) =>
  Array.from({ length: days }, (_, index) => toDateKey(addDays(fromDateKey(from), index)));

/** 单个日期：今年内只显示 MM-DD，跨年保留完整日期，undefined/null 返回 fallback */
export function fmtDate(date: string | undefined | null, fallback = "?"): string {
  if (!date) return fallback;
  const currentYear = new Date().getFullYear().toString();
  return date.startsWith(currentYear) ? date.slice(5) : date;
}

/** 格式化 specificDates 数组：连续日期合并为区间，今年内省略年份 */
export function formatSpecificDates(dates: string[]): string {
  if (!dates.length) return "";
  const sorted = [...dates].sort();
  const currentYear = new Date().getFullYear().toString();
  const allThisYear = sorted.every((d) => d.startsWith(currentYear));
  const fmt = (d: string) => (allThisYear ? d.slice(5) : d);

  const runs: { start: string; end: string }[] = [];
  let runStart = sorted[0];
  let runEnd = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const diffMs = fromDateKey(sorted[i]).getTime() - fromDateKey(sorted[i - 1]).getTime();
    if (Math.round(diffMs / 86400000) === 1) {
      runEnd = sorted[i];
    } else {
      runs.push({ start: runStart, end: runEnd });
      runStart = sorted[i];
      runEnd = sorted[i];
    }
  }
  runs.push({ start: runStart, end: runEnd });

  return runs.map((r) => (r.start === r.end ? fmt(r.start) : `${fmt(r.start)}～${fmt(r.end)}`)).join("、");
}
