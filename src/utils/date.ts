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
