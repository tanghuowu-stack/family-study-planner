/**
 * 每周几次（2026-11-17）：钢琴一周 3 次、读书一周 2 本、作文一周 1 篇……
 * 一周按周一到周日算，做够目标就算这周完成；没做够不累计到下周（下周一从 0 开始）。
 * 不排到哪一天：哪天做了就在今日页右栏"每周练习"里点"记一次"（一天做几本就点到几），记在 task.weeklyLog[那天]。
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

/** 一天最多记多少（按页记的练习册一天可能几十页） */
export const WEEKLY_LOG_DAY_MAX = 50;

/** 记一次 / 撤销一次后的记录：那天次数加减 delta，最少 0、最多 WEEKLY_LOG_DAY_MAX；0 次的那天不存，全空时返回 undefined */
export function applyWeeklyLog(log: Record<string, number> | undefined, date: string, delta: number): Record<string, number> | undefined {
  const next = { ...(log ?? {}) };
  const count = Math.min(WEEKLY_LOG_DAY_MAX, Math.max(0, (next[date] ?? 0) + delta));
  if (count > 0) next[date] = count;
  else delete next[date];
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * 一周所有"每周几次"加起来的总量（2026-11-19 用户要求）：目标 = 各项目标次数之和（阅读 2 篇 + 听写 5 次 + 钢琴 4 次 = 11），
 * 已做 = 各项已做之和，每项最多算到它自己的目标（多做的不抵别的项，进度不超过 100%）。各项单位不同，这里只是次数相加。
 */
export function sumWeeklyTimes(items: { done: number; target: number }[]): { done: number; target: number } {
  return items.reduce((sum, item) => ({ done: sum.done + Math.min(item.done, item.target), target: sum.target + item.target }), { done: 0, target: 0 });
}

/** 每周练习的显示顺序：今日页拖过的顺序（sortOrder）→ 截止日 → 建的先后。今日页和统计 › 练习共用，两边顺序一样 */
export const byPracticeOrder = (a: Pick<Task, "sortOrder" | "endDate" | "createdAt">, b: Pick<Task, "sortOrder" | "endDate" | "createdAt">) =>
  (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || (a.endDate ?? "").localeCompare(b.endDate ?? "") || a.createdAt.localeCompare(b.createdAt);

/**
 * 统计 › 练习（2026-11-25 B3，代替原来的“打卡”）：每项每周练习在一串周里的完成情况。
 * 一行一项（那几周里至少有一周在进行的），每格是那一周 做了几次 / 目标、有没有达标；那周还没开始或已经停了的格子为 null。
 */
export interface PracticeHistoryCell { weekStart: string; done: number; target: number; unit: string; reached: boolean }
export interface PracticeHistoryRow { taskId: string; cells: (PracticeHistoryCell | null)[] }
export function practiceHistory(tasks: Task[], weekStarts: string[], thisWeek: string = weekStarts[weekStarts.length - 1]): PracticeHistoryRow[] {
  return tasks
    .filter((task) => isWeeklyTimes(task) && !task.deletedAt && task.status !== "cancelled" && task.mainCategory !== "readingPlan" && task.childVisible)
    .sort(byPracticeOrder)
    .map((task) => {
      // 第一次记录之前的周算"还没开始用"，显示"–"，不当成没做（没记过的从本周算起）
      const logged = Object.entries(task.weeklyLog ?? {}).filter(([, count]) => count > 0).map(([date]) => date).sort();
      const firstWeek = logged.length ? getWeekStartKey(logged[0]) : thisWeek;
      return { task, firstWeek };
    })
    .map(({ task, firstWeek }) => ({
      taskId: task.id,
      cells: weekStarts.map((weekStart) => {
        if (!weeklyTimesActiveIn(task, weekStart) || weekStart < firstWeek) return null;
        const progress = weeklyTimesProgress(task, weekStart);
        return { weekStart, done: progress.done, target: progress.target, unit: progress.unit, reached: progress.reached };
      }),
    }))
    .filter((row) => row.cells.some(Boolean));
}
