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
import { loadRestDays, saveRestDays, loadReviveCards, saveReviveCards, loadDailyOverrides, saveDailyOverrides, type ReviveCards, type DailyOverrides } from "./appSettingsRepository";
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
  /** 打卡成功日 =「当天所有应做打卡项全部完成」的本地日期（升序），UI 日历数据源 */
  checkinDates: string[];
  /** 有应做项但未全部完成的日期（升序，不含休息日/已补卡日），补卡候选来源 */
  missedDays: string[];
  /** 休息日（跳过不断卡） */
  restDays: string[];
  /** 复活卡已补的日期（视同打卡成功） */
  revivedDates: string[];
  /** 复活卡余额 */
  reviveBalance: number;
}

export interface DailyCheckItem {
  task: Task;
  /** default = 当天排期到的 enableStreak 任务；added = 手动加入 */
  source: "default" | "added";
  done: boolean;
}

/** 逐日状态上限回看天数（防止极旧任务让全量扫描无界） */
const DAY_SCAN_CAP = 400;

/** 三态日状态：done 全部完成 / missed 有应做未完成；不在 map 里 = 无需打卡（none） */
type DayStatusMap = Map<string, "done" | "missed">;

interface DayContext {
  defaults: Task[];
  taskById: Map<string, Task>;
  occByKey: Map<string, TaskOccurrenceStatus>;
  overrides: DailyOverrides;
}

async function loadDayContext(): Promise<DayContext> {
  const [tasks, occurrences, overrides] = await Promise.all([
    db.tasks.toArray(),
    db.taskOccurrenceStatuses.toArray(),
    loadDailyOverrides(),
  ]);
  return {
    defaults: tasks.filter((t) => statsEligible(t) && t.enableStreak === true && t.status !== "cancelled"),
    taskById: new Map(tasks.map((t) => [t.id, t])),
    occByKey: new Map(occurrences.map((o) => [`${o.taskId}:${o.occurrenceDate}`, o])),
    overrides,
  };
}

/** 打卡生效起点保护：勾选"计入打卡"之前的排期日一律非应做（历史欠账不算漏卡）。无起点的存量任务暂不截断 */
const beforeStreakStart = (task: Task, date: string) => !!task.streakStartDate && date < task.streakStartDate;

/** 当天应做打卡项 =（默认集：当天排期到的 enableStreak 任务，剔除单日 cancelled 与生效起点前）− removed + added */
function requiredItemsFor(date: string, ctx: DayContext): { task: Task; source: "default" | "added" }[] {
  const items = new Map<string, { task: Task; source: "default" | "added" }>();
  for (const task of ctx.defaults) {
    if (beforeStreakStart(task, date)) continue;
    if (!scheduleOccursOn(task, date)) continue;
    if (isOccurrenceSchedule(task) && ctx.occByKey.get(`${task.id}:${date}`)?.status === "cancelled") continue;
    items.set(task.id, { task, source: "default" });
  }
  const override = ctx.overrides[date];
  if (override) {
    for (const id of override.removed) items.delete(id);
    for (const id of override.added) {
      if (items.has(id)) continue; // 已是默认项
      const task = ctx.taskById.get(id);
      if (!task || !isActiveTask(task) || task.status === "cancelled") continue;
      if (beforeStreakStart(task, date)) continue;
      if (isOccurrenceSchedule(task) && ctx.occByKey.get(`${task.id}:${date}`)?.status === "cancelled") continue;
      items.set(id, { task, source: "added" });
    }
  }
  return [...items.values()];
}

/**
 * 单项完成判定（沿用完成日归因）：
 * - occurrence 类：当天 occurrence 行 status=done（行本身就挂在这一天）；
 * - 非 occurrence 类：本体 done 且 completedAt 按 toLocalDateKey 归因的完成日 ≤ 当天
 *   （完成日当天及其后的排期日视为已满足；完成日之前的排期日算漏卡）。
 */
function itemSatisfied(task: Task, date: string, ctx: DayContext): boolean {
  if (isOccurrenceSchedule(task)) return ctx.occByKey.get(`${task.id}:${date}`)?.status === "done";
  return task.status === "done" && !!task.completedAt && toLocalDateKey(task.completedAt) <= date;
}

/**
 * 逐日三态：应做项为 0 → 不进 map（"无需打卡"，连续性穿过）；
 * 全部完成 → done；有未完成 → missed。
 */
async function computeDayStatuses(today: string, ctx?: DayContext): Promise<DayStatusMap> {
  const dayCtx = ctx ?? (await loadDayContext());
  const startCandidates: string[] = Object.keys(dayCtx.overrides);
  for (const t of dayCtx.defaults) {
    const s = t.date ?? t.recurrence?.startDate ?? t.startDate ?? (t.specificDates?.length ? [...t.specificDates].sort()[0] : undefined);
    if (s) startCandidates.push(s);
  }
  const statuses: DayStatusMap = new Map();
  if (startCandidates.length === 0) return statuses;
  const cap = toDateKey(addDays(parseISO(today), -DAY_SCAN_CAP));
  let earliest = startCandidates.reduce((a, b) => (a < b ? a : b));
  if (earliest < cap) earliest = cap;
  if (earliest > today) return statuses;
  for (const day of listDays(earliest, today)) {
    const required = requiredItemsFor(day, dayCtx);
    if (required.length === 0) continue;
    statuses.set(day, required.every(({ task }) => itemSatisfied(task, day, dayCtx)) ? "done" : "missed");
  }
  return statuses;
}

/**
 * 纯计算：连续天数。休息日与"无需打卡"日跳过（不断卡也不加一）；
 * 复活日视同打卡；today 漏卡不算断（当天未结束）。
 */
export function computeStreaks(
  statuses: DayStatusMap,
  rests: Set<string>,
  revived: Set<string>,
  today: string
): { currentStreak: number; longestStreak: number } {
  const success = (d: string) => revived.has(d) || statuses.get(d) === "done";
  const skip = (d: string) => rests.has(d) || (!statuses.has(d) && !revived.has(d));
  const allDates = [...statuses.keys(), ...revived];
  if (allDates.length === 0) return { currentStreak: 0, longestStreak: 0 };
  const earliest = allDates.reduce((a, b) => (a < b ? a : b));

  let currentStreak = 0;
  let cursor = today;
  if (!success(cursor) && !skip(cursor)) cursor = prevDayKey(cursor); // today 漏卡：从昨天起算
  while (cursor >= earliest) {
    if (success(cursor)) { currentStreak++; cursor = prevDayKey(cursor); continue; }
    if (skip(cursor)) { cursor = prevDayKey(cursor); continue; }
    break; // missed
  }

  let longestStreak = 0;
  let run = 0;
  for (const day of listDays(earliest, today)) {
    if (success(day)) { run++; if (run > longestStreak) longestStreak = run; continue; }
    if (skip(day)) continue;
    if (day !== today) run = 0; // today 漏卡不清零，与 currentStreak 口径一致
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
  statuses: DayStatusMap,
  rests: Set<string>,
  cards: ReviveCards,
  today: string
): Promise<ReviveCards> {
  const revived = new Set(cards.usedDates);
  const success = (d: string) => revived.has(d) || statuses.get(d) === "done";
  const skip = (d: string) => rests.has(d) || (!statuses.has(d) && !revived.has(d));
  const allDates = [...statuses.keys(), ...revived];
  if (allDates.length === 0) return cards;
  const earliest = allDates.reduce((a, b) => (a < b ? a : b));
  const granted = new Set(cards.grantedMilestones ?? []);
  let balance = cards.balance;
  let changed = false;
  let run = 0;
  for (const day of listDays(earliest, today)) {
    if (success(day)) {
      run++;
      if (run % STREAK_PER_CARD === 0 && !granted.has(day)) {
        granted.add(day);
        if (balance < REVIVE_CAP) balance++;
        changed = true;
      }
      continue;
    }
    if (skip(day)) continue;
    if (day !== today) run = 0;
  }
  if (!changed) return cards;
  const updated: ReviveCards = { ...cards, balance, grantedMilestones: [...granted].sort() };
  await saveReviveCards(updated);
  return updated;
}

export async function getStreakData(today: string = todayKey()): Promise<StreakData> {
  const [statuses, restDays, cards0] = await Promise.all([computeDayStatuses(today), loadRestDays(), loadReviveCards()]);
  const rests = new Set(restDays);
  const cards = await accrueReviveCards(statuses, rests, cards0, today);
  const revived = new Set(cards.usedDates);
  const { currentStreak, longestStreak } = computeStreaks(statuses, rests, revived, today);
  const checkinDates: string[] = [];
  const missedDays: string[] = [];
  for (const [day, status] of statuses) {
    if (status === "done") checkinDates.push(day);
    else if (!rests.has(day) && !revived.has(day)) missedDays.push(day);
  }
  return {
    currentStreak,
    longestStreak,
    checkinDates: checkinDates.sort(),
    missedDays: missedDays.sort(),
    restDays: [...rests].sort(),
    revivedDates: [...revived].sort(),
    reviveBalance: cards.balance,
  };
}

// ── 每日打卡项（UI 勾选数据源）──────────────────────────────────────────────

/** 当天应做打卡项及各自完成状态。空数组 = 该日"无需打卡" */
export async function getDailyCheckItems(date: string): Promise<DailyCheckItem[]> {
  const ctx = await loadDayContext();
  return requiredItemsFor(date, ctx).map(({ task, source }) => ({ task, source, done: itemSatisfied(task, date, ctx) }));
}

/**
 * 设置某天的打卡项手动覆盖：应做集 =（默认集 − removed）+ added。
 * added/removed 去重；同时出现在两边的 id 视为无效（互相抵消剔除）；
 * 两边均空时删除该日键，完全回到默认口径。返回最新完整 overrides。
 */
export async function setDailyCheckOverride(
  date: string,
  override: { added?: string[]; removed?: string[] }
): Promise<DailyOverrides> {
  const overrides = await loadDailyOverrides();
  const addedSet = new Set(override.added ?? []);
  const removedSet = new Set(override.removed ?? []);
  for (const id of [...addedSet]) if (removedSet.has(id)) { addedSet.delete(id); removedSet.delete(id); }
  if (addedSet.size === 0 && removedSet.size === 0) delete overrides[date];
  else overrides[date] = { added: [...addedSet].sort(), removed: [...removedSet].sort() };
  await saveDailyOverrides(overrides);
  return overrides;
}

// ── 单项连续 ─────────────────────────────────────────────────────────────────

export type PerItemDayStatus = "done" | "missed" | "off";

export interface PerItemStreak {
  taskId: string;
  title: string;
  /** 该项目自己的当前连续天数 */
  currentStreak: number;
  /** 最近 7 个自然日（升序，含今天）：done 完成 / missed 应做未完成 / off 非应做日或休息日 */
  recentDays: { date: string; status: PerItemDayStatus }[];
}

/**
 * 每个 enableStreak 活跃任务的单项连续：
 * - 应做日与总打卡同源（requiredItemsFor，含当日手动覆盖与单日 cancelled 剔除）；
 * - 休息日跳过；总打卡的复活卡补卡日对所有项目视同完成；
 * - 应做日完成 +1、应做日未完成断、非应做日穿过；今天未完成不算断（当天未结束）。
 */
export async function getPerItemStreaks(today: string = todayKey()): Promise<PerItemStreak[]> {
  const ctx = await loadDayContext();
  const [restDays, cards] = await Promise.all([loadRestDays(), loadReviveCards()]);
  const rests = new Set(restDays);
  const revived = new Set(cards.usedDates);
  const requiredCache = new Map<string, Set<string>>();
  const requiredIds = (d: string): Set<string> => {
    let cached = requiredCache.get(d);
    if (!cached) {
      cached = new Set(requiredItemsFor(d, ctx).map((i) => i.task.id));
      requiredCache.set(d, cached);
    }
    return cached;
  };
  const capDate = toDateKey(addDays(parseISO(today), -DAY_SCAN_CAP));

  const items = [...ctx.defaults].sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || a.createdAt.localeCompare(b.createdAt));
  return items.map((task) => {
    const isRequired = (d: string) => requiredIds(d).has(task.id);
    const ok = (d: string) => revived.has(d) || itemSatisfied(task, d, ctx);
    // 该项排期起点 / 打卡生效起点之前无需回看
    const itemStart = task.date ?? task.recurrence?.startDate ?? task.startDate ?? (task.specificDates?.length ? [...task.specificDates].sort()[0] : capDate);
    const floor = [itemStart, task.streakStartDate ?? capDate, capDate].reduce((a, b) => (a > b ? a : b));

    let currentStreak = 0;
    let cursor = today;
    if (isRequired(cursor) && !rests.has(cursor) && !ok(cursor)) cursor = prevDayKey(cursor); // 今天未完成不算断
    while (cursor >= floor) {
      if (rests.has(cursor) || !isRequired(cursor)) { cursor = prevDayKey(cursor); continue; }
      if (!ok(cursor)) break;
      currentStreak++;
      cursor = prevDayKey(cursor);
    }

    const recentDays = listDays(toDateKey(addDays(parseISO(today), -6)), today).map((d) => ({
      date: d,
      status: (rests.has(d) || !isRequired(d) ? "off" : ok(d) ? "done" : "missed") as PerItemDayStatus,
    }));
    return { taskId: task.id, title: task.title || "（无标题）", currentStreak, recentDays };
  });
}

// ── 复活卡 ───────────────────────────────────────────────────────────────────

/**
 * 用 1 张复活卡补 date 一天。校验：余额、3 天时限、只能补过去、未重复补、
 * 非休息日、且该日必须是"漏卡"（已打卡或无需打卡都不消耗卡）。
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
  const statuses = await computeDayStatuses(today);
  const status = statuses.get(date);
  if (status === "done") throw new Error("该日已打卡，无需补卡");
  if (status === undefined) throw new Error("该日没有打卡任务，无需补卡");
  const updated: ReviveCards = { ...cards, balance: cards.balance - 1, usedDates: [...cards.usedDates, date].sort() };
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
