/**
 * statsRepository（TASK_08 统计数据层）
 *
 * 独立于 taskRepository 的原因：统计口径 ≠ 展示口径（getTasksForDate 混入了
 * 可见性过滤、rollover 顶替、月历例外），必须从权威源直读；taskRepository 已近
 * 900 行，统计是纯读侧聚合 + app_settings 读写，独立成文件便于测试和 UI 轮引用。
 *
 * R1 权威源读取：
 * - occurrence 类（isOccurrenceSchedule）：完成状态只看 task_occurrence_statuses；
 * - 非 occurrence 类：只看本体 status + completedAt；
 * - 所有 join 前先过 isActiveTask（软删任务及其 occurrence 残留一律不计）；
 * - timestamp → 日期一律 toLocalDateKey，不做 UTC 截断。
 */
import { addDays, parseISO } from "date-fns";
import { db } from "./db";
import { scheduleOccursOn } from "./taskRepository";
import { isOccurrenceSchedule } from "../utils/taskMeta";
import { getWeekStartKey, getWeekEndKey, todayKey, toDateKey, toLocalDateKey } from "../utils/date";
import { loadRestDays, saveRestDays, loadReviveCards, saveReviveCards, type ReviveCards } from "./appSettingsRepository";
import type { MainCategory, Task, TaskOccurrenceStatus } from "../types/task";

/** 口径开关：childVisible=false 的任务是否计入统计（2026-07 拍板：全计入） */
export const STATS_INCLUDE_HIDDEN = true;

/** 复活卡补卡时限：断卡后 3 天内 */
const REVIVE_WINDOW_DAYS = 3;

const isActiveTask = (task: Task) => !task.deletedAt;
/** 统计基础过滤：软删剔除、readingPlan（阅读走 readingLogs 体系）剔除、可见性按开关 */
const statsEligible = (task: Task) =>
  isActiveTask(task) && task.mainCategory !== "readingPlan" && (STATS_INCLUDE_HIDDEN || task.childVisible);

const prevDayKey = (date: string) => toDateKey(addDays(parseISO(date), -1));
const nextDayKey = (date: string) => toDateKey(addDays(parseISO(date), 1));
const listDays = (start: string, end: string): string[] => {
  const days: string[] = [];
  for (let d = start; d <= end; d = nextDayKey(d)) days.push(d);
  return days;
};

// ── 打卡 ─────────────────────────────────────────────────────────────────────

export interface StreakData {
  currentStreak: number;
  longestStreak: number;
  /** 打卡成功的本地日期（升序，去重），UI 日历数据源 */
  checkinDates: string[];
  /** 休息日（跳过不断卡） */
  restDays: string[];
  /** 复活卡已补的日期（视同打卡成功） */
  revivedDates: string[];
  /** 复活卡余额 */
  reviveBalance: number;
}

/**
 * 打卡日集合：某天完成过至少一件 enableStreak 任务即打卡成功。
 * 非 occurrence 类看本体 completedAt；occurrence 类看 occurrence 行 completedAt
 * （历史行无 completedAt 时回退 occurrenceDate 作为完成日代理）。
 */
async function collectCheckinDates(): Promise<Set<string>> {
  const [tasks, occurrences] = await Promise.all([db.tasks.toArray(), db.taskOccurrenceStatuses.toArray()]);
  const streakTasks = new Map(tasks.filter((t) => statsEligible(t) && t.enableStreak === true).map((t) => [t.id, t]));
  const dates = new Set<string>();
  for (const task of streakTasks.values()) {
    if (!isOccurrenceSchedule(task) && task.status === "done" && task.completedAt) {
      dates.add(toLocalDateKey(task.completedAt));
    }
  }
  for (const occ of occurrences) {
    const owner = streakTasks.get(occ.taskId);
    if (!owner || !isOccurrenceSchedule(owner) || occ.status !== "done") continue;
    dates.add(occ.completedAt ? toLocalDateKey(occ.completedAt) : occ.occurrenceDate);
  }
  return dates;
}

/** 纯计算：连续天数。休息日跳过（不断卡也不加一）；复活日视同打卡；today 未打卡不算断（当天未结束） */
export function computeStreaks(
  checkins: Set<string>,
  rests: Set<string>,
  revived: Set<string>,
  today: string
): { currentStreak: number; longestStreak: number } {
  const success = (d: string) => checkins.has(d) || revived.has(d);
  const allDates = [...checkins, ...revived];
  if (allDates.length === 0) return { currentStreak: 0, longestStreak: 0 };
  const earliest = allDates.reduce((a, b) => (a < b ? a : b));

  let currentStreak = 0;
  let cursor = today;
  if (!success(cursor) && !rests.has(cursor)) cursor = prevDayKey(cursor);
  while (cursor >= earliest) {
    if (rests.has(cursor)) { cursor = prevDayKey(cursor); continue; }
    if (!success(cursor)) break;
    currentStreak++;
    cursor = prevDayKey(cursor);
  }

  let longestStreak = 0;
  let run = 0;
  for (const day of listDays(earliest, today)) {
    if (rests.has(day)) continue;
    if (success(day)) { run++; if (run > longestStreak) longestStreak = run; }
    else if (day !== today) run = 0; // today 未打卡不清零，与 currentStreak 口径一致
  }
  return { currentStreak, longestStreak };
}

/** 复活卡持有上限 */
const REVIVE_CAP = 2;
/** 每连续满多少天发 1 张复活卡 */
const STREAK_PER_CARD = 7;

/**
 * 发卡：连续每满 7 天自动 +1 张（持有上限 2）。里程碑日期记账保证幂等；
 * 达到里程碑时若已满持有上限，该里程碑仍记为已发（不补发）。
 */
async function accrueReviveCards(
  checkins: Set<string>,
  rests: Set<string>,
  cards: ReviveCards,
  today: string
): Promise<ReviveCards> {
  const revived = new Set(cards.usedDates);
  const success = (d: string) => checkins.has(d) || revived.has(d);
  const allDates = [...checkins, ...revived];
  if (allDates.length === 0) return cards;
  const earliest = allDates.reduce((a, b) => (a < b ? a : b));
  const granted = new Set(cards.grantedMilestones ?? []);
  let balance = cards.balance;
  let changed = false;
  let run = 0;
  for (const day of listDays(earliest, today)) {
    if (rests.has(day)) continue;
    if (success(day)) {
      run++;
      if (run % STREAK_PER_CARD === 0 && !granted.has(day)) {
        granted.add(day);
        if (balance < REVIVE_CAP) balance++;
        changed = true;
      }
    } else if (day !== today) run = 0;
  }
  if (!changed) return cards;
  const updated: ReviveCards = { balance, usedDates: cards.usedDates, grantedMilestones: [...granted].sort() };
  await saveReviveCards(updated);
  return updated;
}

export async function getStreakData(today: string = todayKey()): Promise<StreakData> {
  const [checkins, restDays, cards0] = await Promise.all([collectCheckinDates(), loadRestDays(), loadReviveCards()]);
  const rests = new Set(restDays);
  const cards = await accrueReviveCards(checkins, rests, cards0, today);
  const revived = new Set(cards.usedDates);
  const { currentStreak, longestStreak } = computeStreaks(checkins, rests, revived, today);
  return {
    currentStreak,
    longestStreak,
    checkinDates: [...checkins].sort(),
    restDays: [...rests].sort(),
    revivedDates: [...revived].sort(),
    reviveBalance: cards.balance,
  };
}

// ── 复活卡 ───────────────────────────────────────────────────────────────────

/**
 * 用 1 张复活卡补 date 一天。校验：余额、3 天时限、只能补过去、
 * 非休息日、未打卡、未重复补。发卡（连续满 7 天得 1 张、上限 2）与家长确认留给后续轮。
 */
export async function applyReviveCard(date: string, today: string = todayKey()): Promise<ReviveCards> {
  const cards = await loadReviveCards();
  if (cards.balance <= 0) throw new Error("复活卡余额不足");
  if (date >= today) throw new Error("只能补今天之前的日期");
  const daysAgo = listDays(date, today).length - 1;
  if (daysAgo > REVIVE_WINDOW_DAYS) throw new Error(`断卡超过 ${REVIVE_WINDOW_DAYS} 天，无法补卡`);
  if (cards.usedDates.includes(date)) throw new Error("该日已用复活卡补过");
  const rests = new Set(await loadRestDays());
  if (rests.has(date)) throw new Error("休息日不断卡，无需补卡");
  const checkins = await collectCheckinDates();
  if (checkins.has(date)) throw new Error("该日已打卡，无需补卡");
  const updated: ReviveCards = { balance: cards.balance - 1, usedDates: [...cards.usedDates, date].sort() };
  await saveReviveCards(updated);
  return updated;
}

// ── 休息日 ───────────────────────────────────────────────────────────────────

export async function getRestDays(): Promise<string[]> {
  return loadRestDays();
}

/** 切换某天的休息日标记，返回最新列表 */
export async function toggleRestDay(date: string): Promise<string[]> {
  const days = await loadRestDays();
  const next = days.includes(date) ? days.filter((d) => d !== date) : [...days, date];
  await saveRestDays(next);
  return loadRestDays();
}

// ── 本周完成率 / 学科对比 ────────────────────────────────────────────────────

interface TaskWeekStat {
  task: Task;
  total: number;
  done: number;
}

/**
 * 周内逐任务应做/已完成：
 * - occurrence 类：按 scheduleOccursOn 展开到每天，occurrence 行 cancelled 的当天剔出分母；
 * - 非 occurrence 类：日期字段落在本周计 1（singleDate 看 date、dateRange/assignmentWindow
 *   看区间与本周重叠、weekGoal 看 weekStart），本体 cancelled 整体剔除；
 * - 有活跃子任务的父任务跳过（子任务按 singleDate 单独计，避免双算）。
 */
async function computeWeekTaskStats(date: string): Promise<TaskWeekStat[]> {
  const weekStart = getWeekStartKey(date);
  const weekEnd = getWeekEndKey(date);
  const weekDays = listDays(weekStart, weekEnd);
  const [tasks, occurrences] = await Promise.all([db.tasks.toArray(), db.taskOccurrenceStatuses.toArray()]);
  const active = tasks.filter(statsEligible);
  const hasActiveChildren = new Set(active.filter((t) => t.parentTaskId).map((t) => t.parentTaskId as string));
  const occByKey = new Map(occurrences.map((o) => [`${o.taskId}:${o.occurrenceDate}`, o] as [string, TaskOccurrenceStatus]));

  const stats: TaskWeekStat[] = [];
  for (const task of active) {
    if (task.status === "cancelled") continue;          // 整体取消：任务级剔除
    if (hasActiveChildren.has(task.id)) continue;        // 父任务由子任务代表

    if (isOccurrenceSchedule(task)) {
      let total = 0;
      let done = 0;
      for (const day of weekDays) {
        if (!scheduleOccursOn(task, day)) continue;
        const occ = occByKey.get(`${task.id}:${day}`);
        if (occ?.status === "cancelled") continue;       // 单日取消：剔出分母
        total++;
        if (occ?.status === "done") done++;
      }
      if (total > 0) stats.push({ task, total, done });
      continue;
    }

    const inWeek =
      task.timeType === "singleDate"
        ? !!task.date && task.date >= weekStart && task.date <= weekEnd
        : task.timeType === "dateRange"
          ? !!task.startDate && !!task.endDate && task.startDate <= weekEnd && task.endDate >= weekStart
          : task.timeType === "weekGoal"
            ? task.weekStart === weekStart
            : task.timeType === "assignmentWindow"
              ? !!task.assignmentWindow && task.assignmentWindow.startDate <= weekEnd && task.assignmentWindow.endDate >= weekStart
              : false;
    if (inWeek) stats.push({ task, total: 1, done: task.status === "done" ? 1 : 0 });
  }
  return stats;
}

export interface WeekCompletionRate {
  weekStart: string;
  weekEnd: string;
  total: number;
  done: number;
  /** 0-1；total 为 0 时为 null（无应做任务，UI 显示"本周无安排"而非 0%） */
  rate: number | null;
}

export async function getWeekCompletionRate(date: string = todayKey()): Promise<WeekCompletionRate> {
  const stats = await computeWeekTaskStats(date);
  const total = stats.reduce((sum, s) => sum + s.total, 0);
  const done = stats.reduce((sum, s) => sum + s.done, 0);
  return { weekStart: getWeekStartKey(date), weekEnd: getWeekEndKey(date), total, done, rate: total > 0 ? done / total : null };
}

export interface SubjectComparisonItem {
  mainCategory: MainCategory;
  total: number;
  done: number;
  rate: number | null;
}

/** 学科对比：与本周完成率同一套逐任务口径，按一级分类聚合 */
export async function getSubjectComparison(date: string = todayKey()): Promise<SubjectComparisonItem[]> {
  const stats = await computeWeekTaskStats(date);
  const byCategory = new Map<MainCategory, { total: number; done: number }>();
  for (const s of stats) {
    const entry = byCategory.get(s.task.mainCategory) ?? { total: 0, done: 0 };
    entry.total += s.total;
    entry.done += s.done;
    byCategory.set(s.task.mainCategory, entry);
  }
  return [...byCategory.entries()]
    .map(([mainCategory, { total, done }]) => ({ mainCategory, total, done, rate: total > 0 ? done / total : null }))
    .sort((a, b) => b.total - a.total);
}
