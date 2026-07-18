/**
 * statsRepository（TASK_08 统计数据层 · 打卡月历重构）
 *
 * 目标形态：打卡 = 若干「打卡项目」各自一张月历，每个项目独立计连续。
 * 不再有总连续/复活卡/徽章/每日覆盖/周完成率/学科对比（2026-07-18 规划内重构删除）。
 *
 * R1 权威源读取：
 * - occurrence 类（isOccurrenceSchedule）：完成状态只看 task_occurrence_statuses 行；
 * - 非 occurrence 类：只看本体 status + completedAt；
 * - join 前先过 isActiveTask（软删任务及其 occurrence 残留一律不计）；
 * - timestamp → 日期一律 toLocalDateKey，不做 UTC 截断。
 */
import { addDays, endOfMonth, parseISO, startOfMonth } from "date-fns";
import { db } from "./db";
import { scheduleOccursOn } from "./taskRepository";
import { getRepository } from "./repositoryProvider";
import { isOccurrenceSchedule, taskShortName } from "../utils/taskMeta";
import { todayKey, toDateKey, toLocalDateKey } from "../utils/date";
import { loadRestDays, saveRestDays } from "./appSettingsRepository";
import type { Task, TaskOccurrenceStatus } from "../types/task";

/** 逐日回看上限（防止极旧任务让连续扫描无界） */
const DAY_SCAN_CAP = 400;

const isActiveTask = (task: Task) => !task.deletedAt;
/** 打卡基础过滤：软删剔除、readingPlan（阅读走 readingLogs 体系）剔除 */
const statsEligible = (task: Task) => isActiveTask(task) && task.mainCategory !== "readingPlan";

const prevDayKey = (date: string) => toDateKey(addDays(parseISO(date), -1));
const nextDayKey = (date: string) => toDateKey(addDays(parseISO(date), 1));
const listDays = (start: string, end: string): string[] => {
  const days: string[] = [];
  for (let d = start; d <= end; d = nextDayKey(d)) days.push(d);
  return days;
};

/** 打卡生效起点保护：勾选前的排期日一律非应做（历史欠账不算漏卡）。无起点的存量任务暂不截断 */
const beforeStreakStart = (task: Task, date: string) => !!task.streakStartDate && date < task.streakStartDate;

type OccMap = Map<string, TaskOccurrenceStatus>;

/**
 * 单项完成判定（沿用完成日归因）：
 * - occurrence 类：当天 occurrence 行 status=done；
 * - 非 occurrence 类：本体 done 且 completedAt 归因的本地完成日 ≤ 当天。
 */
function itemSatisfied(task: Task, date: string, occByKey: OccMap): boolean {
  if (isOccurrenceSchedule(task)) return occByKey.get(`${task.id}:${date}`)?.status === "done";
  return task.status === "done" && !!task.completedAt && toLocalDateKey(task.completedAt) <= date;
}

/** 该项目在某天是否「应做」：排期命中、在生效起点之后、当天未被单独取消 */
function isApplicable(task: Task, date: string, occByKey: OccMap): boolean {
  if (beforeStreakStart(task, date)) return false;
  if (!scheduleOccursOn(task, date)) return false;
  if (isOccurrenceSchedule(task) && occByKey.get(`${task.id}:${date}`)?.status === "cancelled") return false;
  return true;
}

/** 项目自身回看下界：排期起点 / 打卡生效起点 / 扫描上限三者取最晚 */
function itemFloor(task: Task, today: string): string {
  const cap = toDateKey(addDays(parseISO(today), -DAY_SCAN_CAP));
  const scheduleStart = task.date ?? task.recurrence?.startDate ?? task.startDate
    ?? (task.specificDates?.length ? [...task.specificDates].sort()[0] : cap);
  return [scheduleStart, task.streakStartDate ?? cap, cap].reduce((a, b) => (a > b ? a : b));
}

/**
 * 单项当前连续天数：从今天往回，应做日完成 +1、应做日未完成断，
 * 休息日与非应做日穿过；今天应做但未完成不算断（当天未结束）。
 */
function computeItemStreak(task: Task, today: string, occByKey: OccMap, rests: Set<string>): number {
  const floor = itemFloor(task, today);
  const applicable = (d: string) => isApplicable(task, d, occByKey);
  const ok = (d: string) => itemSatisfied(task, d, occByKey);
  let streak = 0;
  let cursor = today;
  if (applicable(cursor) && !rests.has(cursor) && !ok(cursor)) cursor = prevDayKey(cursor); // 今天未完成不算断
  while (cursor >= floor) {
    if (rests.has(cursor) || !applicable(cursor)) { cursor = prevDayKey(cursor); continue; }
    if (!ok(cursor)) break;
    streak++;
    cursor = prevDayKey(cursor);
  }
  return streak;
}

const sortTasks = (a: Task, b: Task) =>
  (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || a.createdAt.localeCompare(b.createdAt);

// ── 管理打卡项目 ─────────────────────────────────────────────────────────────

export interface HabitCandidate {
  taskId: string;
  title: string;
  /** 当前是否已勾选为打卡项目 */
  enabled: boolean;
}

/** 可成为打卡项目的活跃重复类任务（供「管理打卡项目」选择器） */
export async function getHabitCandidates(): Promise<HabitCandidate[]> {
  const tasks = await db.tasks.toArray();
  return tasks
    .filter((t) => statsEligible(t) && isOccurrenceSchedule(t) && t.status !== "cancelled")
    .sort(sortTasks)
    .map((t) => ({ taskId: t.id, title: taskShortName(t), enabled: t.enableStreak === true }));
}

/**
 * 勾选 / 取消某任务为打卡项目。走 getRepository().update 以同步云端。
 * 勾选 → enableStreak=true，起点由 taskRepository 写为今天（重勾更新为新起点）；
 * 取消 → enableStreak=false，起点保留（历史月历可回看）。
 */
export async function setHabitEnabled(taskId: string, enabled: boolean): Promise<void> {
  await getRepository().update(taskId, { enableStreak: enabled });
}

// ── 打卡月历 ─────────────────────────────────────────────────────────────────

export type HabitDayStatus = "done" | "missed" | "off";

export interface HabitCalendar {
  taskId: string;
  title: string;
  /** 该项目自身的当前连续天数（与展示月份无关，恒从今天往回算） */
  currentStreak: number;
  /** 该月逐日状态：done 完成 / missed 应做未完成 / off 非应做日（起点前、未排期、休息日、未来） */
  days: { date: string; status: HabitDayStatus }[];
}

/** 所有当前勾选项目在指定月份（"YYYY-MM"）的月历数据 */
export async function getHabitCalendars(month: string, today: string = todayKey()): Promise<HabitCalendar[]> {
  const [tasks, occurrences, restDays] = await Promise.all([
    db.tasks.toArray(),
    db.taskOccurrenceStatuses.toArray(),
    loadRestDays(),
  ]);
  const rests = new Set(restDays);
  const occByKey: OccMap = new Map(occurrences.map((o) => [`${o.taskId}:${o.occurrenceDate}`, o]));
  const enabled = tasks
    .filter((t) => statsEligible(t) && t.enableStreak === true && t.status !== "cancelled")
    .sort(sortTasks);

  const monthStart = toDateKey(startOfMonth(parseISO(`${month}-01`)));
  const monthEnd = toDateKey(endOfMonth(parseISO(`${month}-01`)));
  const monthDays = listDays(monthStart, monthEnd);

  return enabled.map((task) => {
    const days = monthDays.map((date) => {
      let status: HabitDayStatus;
      if (date > today) status = "off";                                    // 未来日
      else if (rests.has(date)) status = "off";                           // 休息日
      else if (!isApplicable(task, date, occByKey)) status = "off";       // 起点前 / 未排期 / 单日取消
      else status = itemSatisfied(task, date, occByKey) ? "done" : "missed";
      return { date, status };
    });
    return {
      taskId: task.id,
      title: taskShortName(task),
      currentStreak: computeItemStreak(task, today, occByKey, rests),
      days,
    };
  });
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
