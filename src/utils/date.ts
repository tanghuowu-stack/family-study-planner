import {
  addDays,
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

export const formatLongDate = (value: string) =>
  format(fromDateKey(value), "M月d日 EEEE", { locale: zhCN });

export const formatFullDate = (value: string) =>
  format(fromDateKey(value), "yyyy年M月d日 EEEE", { locale: zhCN });

export const formatCompactDate = (value: string) =>
  format(fromDateKey(value), "M月d日", { locale: zhCN });

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
