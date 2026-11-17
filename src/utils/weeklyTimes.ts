/**
 * 每周几次（2026-11-17）：钢琴一周 3 次、读书一周 2 本、作文一周 1 篇……
 * 一周按周一到周日算，做够目标就算这周完成；没做够不累计到下周（下周一从 0 开始）。
 * 不排到哪一天：哪天做了就在今日页"本周计划"里点"做了一次"，记在 task.weeklyLog[那天]。
 */
import { addDays } from "date-fns";
import type { Task, TaskTimeType } from "../types/task";
import { fromDateKey, getWeekEndKey, getWeekStartKey, toDateKey } from "./date";

export const isWeeklyTimes = (task: { timeType: TaskTimeType }) => task.timeType === "weeklyTimes";

/** 这一周（date 所在的周一到周日）是否在任务的有效期内 */
export function weeklyTimesActiveIn(task: Pick<Task, "timeType" | "startDate" | "endDate">, date: string): boolean {
  if (!isWeeklyTimes(task)) return false;
  const weekStart = getWeekStartKey(date);
  const weekEnd = getWeekEndKey(date);
  return (!task.startDate || task.startDate <= weekEnd) && (!task.endDate || task.endDate >= weekStart);
}

export interface WeeklyTimesProgress {
  weekStart: string;
  target: number;
  unit: string;
  /** 本周已做次数（可以超过目标） */
  done: number;
  /** 查看的那天做了几次 */
  dayCount: number;
  /** 周一到周日每天做了几次 */
  days: { date: string; count: number }[];
  reached: boolean;
}

export function weeklyTimesProgress(task: Pick<Task, "weeklyQuota" | "weeklyLog">, date: string): WeeklyTimesProgress {
  const weekStart = getWeekStartKey(date);
  const days = Array.from({ length: 7 }, (_, index) => {
    const key = toDateKey(addDays(fromDateKey(weekStart), index));
    return { date: key, count: task.weeklyLog?.[key] ?? 0 };
  });
  const target = Math.max(1, task.weeklyQuota?.targetCount ?? 1);
  const done = days.reduce((sum, day) => sum + day.count, 0);
  return { weekStart, target, unit: task.weeklyQuota?.unit ?? "次", done, dayCount: task.weeklyLog?.[date] ?? 0, days, reached: done >= target };
}

/** 记一次 / 撤销一次后的记录：那天次数加减 delta，最少 0、最多 20；0 次的那天不存，全空时返回 undefined */
export function applyWeeklyLog(log: Record<string, number> | undefined, date: string, delta: number): Record<string, number> | undefined {
  const next = { ...(log ?? {}) };
  const count = Math.min(20, Math.max(0, (next[date] ?? 0) + delta));
  if (count > 0) next[date] = count;
  else delete next[date];
  return Object.keys(next).length > 0 ? next : undefined;
}
