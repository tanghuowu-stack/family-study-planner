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
import { isCourseTask, isEndedRecurring, isOccurrenceSchedule, subCategoryLabel, taskShortName, MAIN_CATEGORY_META, WEEKDAY_LABELS } from "../utils/taskMeta";
import { todayKey, toDateKey, toLocalDateKey } from "../utils/date";
import { createTravelPauseCheck } from "../utils/travelPause";
import { loadRestDays, saveRestDays, loadHiddenHabitCandidates, saveHiddenHabitCandidates } from "./appSettingsRepository";
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
type TravelPauseCheck = ReturnType<typeof createTravelPauseCheck>;

/**
 * 单项完成判定（沿用完成日归因）：
 * - occurrence 类：当天 occurrence 行 status=done；
 * - 非 occurrence 类：本体 done 且 completedAt 归因的本地完成日 ≤ 当天。
 */
function itemSatisfied(task: Task, date: string, occByKey: OccMap): boolean {
  if (isOccurrenceSchedule(task)) return occByKey.get(`${task.id}:${date}`)?.status === "done";
  return task.status === "done" && !!task.completedAt && toLocalDateKey(task.completedAt) <= date;
}

/**
 * 该项目在某天是否「应做」：排期命中、在生效起点之后、当天未被单独取消。
 * startOverride：分组场景下用组级起点统一判定（组内单次课任务自身没有 streakStartDate）。
 */
function isApplicable(task: Task, date: string, occByKey: OccMap, startOverride?: string, paused?: TravelPauseCheck): boolean {
  const start = startOverride ?? task.streakStartDate;
  if (start ? date < start : beforeStreakStart(task, date)) return false;
  if (!scheduleOccursOn(task, date)) return false;
  if (paused?.(task, date) && !itemSatisfied(task, date, occByKey)) return false;
  if (isOccurrenceSchedule(task) && occByKey.get(`${task.id}:${date}`)?.status === "cancelled") return false;
  return true;
}

/** 项目自身回看下界：排期起点 / 打卡生效起点 / 扫描上限三者取最晚 */
function itemFloor(task: Task, today: string, startOverride?: string): string {
  const cap = toDateKey(addDays(parseISO(today), -DAY_SCAN_CAP));
  const scheduleStart = task.date ?? task.recurrence?.startDate ?? task.startDate
    ?? (task.specificDates?.length ? [...task.specificDates].sort()[0] : cap);
  return [scheduleStart, startOverride ?? task.streakStartDate ?? cap, cap].reduce((a, b) => (a > b ? a : b));
}

/**
 * 当前连续天数（单任务或分组均适用，传入数组长度为 1 即单任务）：从今天往回，
 * 应做日完成 +1（休息日完成同样计入）、应做日未完成断——但休息日"免罚"穿过；
 * 非应做日穿过；今天应做但未完成不算断（当天未结束）。分组时"应做/完成"取组内任一任务满足。
 */
export function computeGroupStreak(tasks: Task[], today: string, occByKey: OccMap, rests: Set<string>, start?: string, paused?: TravelPauseCheck): number {
  if (tasks.length === 0) return 0;
  const floor = tasks.map((t) => itemFloor(t, today, start)).reduce((a, b) => (a < b ? a : b));
  const applicable = (d: string) => groupApplicable(tasks, d, occByKey, start, paused);
  const ok = (d: string) => groupSatisfied(tasks, d, occByKey, start, paused);
  let streak = 0;
  let cursor = today;
  let gap = 0; // 连着多少天没有安排
  if (applicable(cursor) && !ok(cursor)) cursor = prevDayKey(cursor); // 今天未完成不算断
  while (cursor >= floor) {
    if (!applicable(cursor)) { gap++; cursor = prevDayKey(cursor); continue; }
    // 停了很久（间断的任务、旅游暂停等）再开始，连续天数从头算（2026-11-14 用户定）；
    // 每周一次的项目两次之间只隔 6 天，不受影响
    if (gap > STREAK_BREAK_GAP_DAYS) break;
    gap = 0;
    if (ok(cursor)) { streak++; cursor = prevDayKey(cursor); continue; }
    if (rests.has(cursor)) { cursor = prevDayKey(cursor); continue; } // 休息日未完成：免罚穿过
    break;
  }
  return streak;
}

/** 中间连续超过这么多天没有安排，连续天数从头算 */
export const STREAK_BREAK_GAP_DAYS = 14;

const sortTasks = (a: Task, b: Task) =>
  (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || a.createdAt.localeCompare(b.createdAt);

/**
 * 打卡分组（2026-08-12）：同一习惯的不同任务形式合并成一张打卡月历卡
 * （如"钢琴课" piano + "钢琴练习" pianoPractice → 统一显示"钢琴"），
 * 组内任一任务当天完成即算这一天打卡成功。
 *
 * 按 subCategory 聚合而非任务实例字段：这是分类体系自身的属性（枚举值，非用户可编辑的
 * 自由文本），新建的同类任务自动归组、无需用户逐条配置。未命中这张表的任务照旧各自一张卡。
 * 只新增分组，不要在这里放跨分类体系的临时组合——那种需求应该用任务级字段单独设计。
 */
const HABIT_GROUPS: Record<string, { groupKey: string; label: string }> = {
  piano: { groupKey: "piano", label: "钢琴" },
  pianoPractice: { groupKey: "piano", label: "钢琴" },
};

/**
 * 打卡项目归属：固定分组（钢琴）> 手动接上的项目（habitKey）> 任务自身 id。
 * 同一个 key 的任务在打卡矩阵里合成一行。
 */
export const habitProjectKey = (task: Pick<Task, "id" | "subCategory" | "habitKey">): string =>
  HABIT_GROUPS[task.subCategory]?.groupKey ?? task.habitKey ?? task.id;
/** 能计入某个打卡项目的任务：固定分组不限排期类型（每次单独建的钢琴课），其余只认重复类 */
const isHabitMember = (task: Task) => !!HABIT_GROUPS[task.subCategory] || isOccurrenceSchedule(task);
/** 项目显示名：固定分组用分组名，其余用最近那个任务的名字 */
const latestFirst = (a: Task, b: Task) => (b.recurrence?.startDate ?? b.startDate ?? b.createdAt).localeCompare(a.recurrence?.startDate ?? a.startDate ?? a.createdAt);
const projectTitle = (members: Task[]) => HABIT_GROUPS[members[0].subCategory]?.label ?? taskShortName([...members].sort(latestFirst)[0]);

/** 分组版应做判定：组内任一任务当天应做 */
const groupApplicable = (tasks: Task[], date: string, occByKey: OccMap, start?: string, paused?: TravelPauseCheck) =>
  tasks.some((t) => isApplicable(t, date, occByKey, start, paused));
/** 分组版完成判定：组内任一应做任务当天完成 */
const groupSatisfied = (tasks: Task[], date: string, occByKey: OccMap, start?: string, paused?: TravelPauseCheck) =>
  tasks.some((t) => isApplicable(t, date, occByKey, start, paused) && itemSatisfied(t, date, occByKey));

// ── 管理打卡项目 ─────────────────────────────────────────────────────────────

export interface HabitCandidate {
  taskId: string;
  title: string;
  /** 当前是否已勾选为打卡项目 */
  enabled: boolean;
  /** 已勾选项目的打卡起点（本地日）；未勾选恒为 undefined */
  streakStartDate?: string;
  /** 是否上课类（isCourseTask 统一判定）：管理弹窗把未勾选的上课类折叠起来，只读派生、不落库 */
  isCourse: boolean;
  /** 命中 HABIT_GROUPS 分组时，它计入的那张月历卡的名字（如"钢琴"）；未分组为 undefined */
  calendarTitle?: string;
  /** 所属打卡项目 key（见 habitProjectKey） */
  projectKey: string;
  /** 排期已经结束（"今天起不再安排"过或到了结束日期） */
  ended: boolean;
  /** 分类，如"课外班·英语" */
  categoryText: string;
  /** 安排，如"每天""每周一三五" */
  scheduleText: string;
  /** 起止，如"9/1–9/28""11/3 起" */
  rangeText: string;
}

const shortDate = (date?: string) => (date ? `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}` : "");
const categoryTextOf = (t: Task) => `${MAIN_CATEGORY_META[t.mainCategory]?.label ?? ""}·${subCategoryLabel(t.mainCategory, t.subCategory)}`;
const scheduleTextOf = (t: Task) => {
  if (t.schedulePattern === "dailyRecurring" || t.schedulePattern === "dateRangeDaily") return "每天";
  const days = t.schedulePattern === "dateRangeWeekdays" ? t.rangeWeekdays : t.recurrence?.weekdays;
  if (days?.length) return `每周${[1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d)).map((d) => WEEKDAY_LABELS[d].replace("周", "")).join("")}`;
  if (t.schedulePattern === "specificDates") return "指定日期";
  return "重复";
};
const rangeOf = (t: Task): [string | undefined, string | undefined] => {
  if (t.schedulePattern === "specificDates") { const sorted = [...(t.specificDates ?? [])].sort(); return [sorted[0], sorted.at(-1)]; }
  if (t.schedulePattern === "dateRangeDaily" || t.schedulePattern === "dateRangeWeekdays") return [t.startDate, t.endDate];
  return [t.recurrence?.startDate ?? t.startDate, t.recurrence?.endDate];
};
const rangeTextOf = (t: Task) => { const [from, to] = rangeOf(t); return to ? `${shortDate(from)}–${shortDate(to)}` : `${shortDate(from)} 起`; };

/** 可成为打卡项目的活跃重复类任务（供「管理打卡项目」选择器）。已隐藏且未勾选的任务不出现 */
export async function getHabitCandidates(): Promise<HabitCandidate[]> {
  const [tasks, hidden] = await Promise.all([db.tasks.toArray(), loadHiddenHabitCandidates()]);
  const hiddenSet = new Set(hidden);
  return tasks
    .filter((t) => statsEligible(t) && isOccurrenceSchedule(t) && t.status !== "cancelled")
    .filter((t) => !hiddenSet.has(t.id) || t.enableStreak === true) // 已勾选的即使在隐藏名单里也要露出，避免"关不掉"
    .sort(sortTasks)
    .map((t) => ({
      taskId: t.id,
      title: taskShortName(t),
      enabled: t.enableStreak === true,
      streakStartDate: t.enableStreak === true ? t.streakStartDate : undefined,
      isCourse: isCourseTask(t),
      calendarTitle: HABIT_GROUPS[t.subCategory]?.label,
      projectKey: habitProjectKey(t),
      ended: isEndedRecurring(t),
      categoryText: categoryTextOf(t),
      scheduleText: scheduleTextOf(t),
      rangeText: rangeTextOf(t),
    }));
}

// ── 打卡项目（2026-11-14：间断后新建的任务可以接上以前的项目）──────────────────

export interface HabitProjectMember {
  taskId: string;
  title: string;
  rangeText: string;
  ended: boolean;
  enabled: boolean;
  /** 是靠"接上"进来的（habitKey），可以移出 */
  linked: boolean;
}

export interface HabitProject {
  key: string;
  title: string;
  categoryText: string;
  scheduleText: string;
  /** 项目打卡起点：成员里最早的起点 */
  startDate?: string;
  /** 所有成员都已停（没有今天及以后的安排） */
  paused: boolean;
  /** 最后一次有安排的日期（停掉的项目才有意义），用于显示"上次：9/28" */
  lastDate?: string;
  /** 历史上一共打卡完成了几天 */
  doneDays: number;
  enabled: boolean;
  members: HabitProjectMember[];
}

/** 收集所有打卡项目：已勾选的，以及以前打过卡（有起点记录）的。fixed 分组（钢琴）只列已勾选的成员 */
async function collectProjects(): Promise<HabitProject[]> {
  const [tasks, occurrences] = await Promise.all([db.tasks.toArray(), db.taskOccurrenceStatuses.toArray()]);
  const doneByTask = new Map<string, Set<string>>();
  for (const o of occurrences) if (o.status === "done") { const set = doneByTask.get(o.taskId) ?? new Set<string>(); set.add(o.occurrenceDate); doneByTask.set(o.taskId, set); }
  const members = tasks.filter((t) => statsEligible(t) && t.status !== "cancelled" && isHabitMember(t));
  const byKey = new Map<string, Task[]>();
  for (const t of [...members].sort(sortTasks)) { const key = habitProjectKey(t); byKey.set(key, [...(byKey.get(key) ?? []), t]); }
  const projects: HabitProject[] = [];
  for (const [key, list] of byKey) {
    const fixed = !!HABIT_GROUPS[list[0].subCategory];
    const enabled = list.some((t) => t.enableStreak === true);
    const tracked = list.filter((t) => t.enableStreak === true || !!t.streakStartDate);
    if (!tracked.length) continue; // 从没打过卡的任务不算项目，只是候选
    const shown = fixed ? list.filter((t) => t.enableStreak === true) : list;
    const days = new Set<string>();
    for (const t of list) doneByTask.get(t.id)?.forEach((d) => days.add(d));
    const lastDate = list.map((t) => rangeOf(t)[1]).every(Boolean) ? list.map((t) => rangeOf(t)[1]!).sort().at(-1) : undefined;
    const latest = [...list].sort(latestFirst)[0];
    projects.push({
      key, title: projectTitle(list), categoryText: categoryTextOf(latest), scheduleText: scheduleTextOf(latest),
      startDate: tracked.map((t) => t.streakStartDate).filter((d): d is string => !!d).sort()[0],
      paused: list.every((t) => isEndedRecurring(t)), lastDate, doneDays: days.size, enabled,
      members: shown.map((t) => ({ taskId: t.id, title: taskShortName(t), rangeText: rangeTextOf(t), ended: isEndedRecurring(t), enabled: t.enableStreak === true, linked: !!t.habitKey && t.habitKey !== t.id })),
    });
  }
  return projects;
}

/** 已勾选的打卡项目（管理弹窗"正在打卡"一栏），按排序 */
export async function getHabitProjects(): Promise<HabitProject[]> {
  return (await collectProjects()).filter((p) => p.enabled);
}

const nameGrams = (text: string) => {
  const chars = [...text.replace(/[\s·:：,，、()（）【】\[\]0-9a-zA-Z]+/g, "")];
  const grams = new Set<string>();
  for (let i = 0; i < chars.length - 1; i++) grams.add(chars[i] + chars[i + 1]);
  return grams;
};

/**
 * 两个任务像不像同一件事：同分类同学科 +3（同学科不同分类 +1），名字里相同的两字词每个 +2（最多算 3 个）。
 * 只用来排序和预选，最后由家长确认——名字常常不一样，不做自动合并。
 */
export function habitLinkScore(a: Pick<Task, "title" | "mainCategory" | "subCategory">, b: Pick<Task, "title" | "mainCategory" | "subCategory">): number {
  let score = a.mainCategory === b.mainCategory && a.subCategory === b.subCategory ? 3 : a.subCategory === b.subCategory ? 1 : 0;
  const ga = nameGrams(a.title), gb = nameGrams(b.title);
  let shared = 0;
  ga.forEach((g) => { if (gb.has(g)) shared++; });
  return score + Math.min(shared, 3) * 2;
}

export interface HabitLinkSuggestion {
  project: HabitProject;
  score: number;
}

/**
 * 某个任务勾成打卡项目时，可以"接上"的以前的项目，按像不像排序（同分数时最近停的在前）。
 * 包括正在打卡的和以前打过卡、已经停掉的；不含它自己所在的项目。
 */
export async function suggestHabitLinks(taskId: string): Promise<HabitLinkSuggestion[]> {
  const [task, projects, tasks] = await Promise.all([db.tasks.get(taskId), collectProjects(), db.tasks.toArray()]);
  if (!task) return [];
  const own = habitProjectKey(task);
  const byKey = new Map<string, Task[]>();
  for (const t of tasks) { const key = habitProjectKey(t); byKey.set(key, [...(byKey.get(key) ?? []), t]); }
  return projects
    .filter((p) => p.key !== own)
    .map((project) => ({ project, score: Math.max(0, ...(byKey.get(project.key) ?? []).map((m) => habitLinkScore(task, m))) }))
    .sort((a, b) => b.score - a.score || (b.project.lastDate ?? "9999").localeCompare(a.project.lastDate ?? "9999"));
}

/** 勾成打卡项目并接上以前的项目：成员合成一行，历史连在一起 */
export async function linkHabit(taskId: string, projectKey: string): Promise<void> {
  if (taskId === projectKey) return setHabitEnabled(taskId, true);
  await getRepository().update(taskId, { habitKey: projectKey, enableStreak: true });
}

/** 从项目里移出（接错了时用）：变回它自己一个项目，勾选状态不变 */
export async function unlinkHabit(taskId: string): Promise<void> {
  await getRepository().update(taskId, { habitKey: undefined });
}

/** 整个项目取消打卡：项目里所有已勾选的任务取消勾选（起点保留，历史可回看） */
export async function disableHabitProject(projectKey: string): Promise<void> {
  const tasks = (await db.tasks.toArray()).filter((t) => statsEligible(t) && isHabitMember(t) && habitProjectKey(t) === projectKey && t.enableStreak === true);
  for (const t of tasks) await getRepository().update(t.id, { enableStreak: false });
}

/** 修改整个项目的打卡起点：项目里打过卡的任务一起改，不允许晚于今天 */
export async function setHabitProjectStartDate(projectKey: string, date: string, today: string = todayKey()): Promise<void> {
  if (date > today) throw new Error("打卡起点不能晚于今天");
  const tasks = (await db.tasks.toArray()).filter((t) => statsEligible(t) && isHabitMember(t) && habitProjectKey(t) === projectKey && (t.enableStreak === true || !!t.streakStartDate));
  if (!tasks.length) throw new Error("没有找到这个打卡项目");
  for (const t of tasks) await getRepository().update(t.id, { streakStartDate: date });
}

/**
 * 隐藏某个候选任务（如"奥数暑假班"这类肯定不会用来打卡的），使其不再出现在管理弹窗列表里。
 * 只允许隐藏未勾选的任务——已勾选的任务隐藏了就没法在弹窗里取消勾选，会陷入"关不掉"的死角。
 */
export async function hideHabitCandidate(taskId: string): Promise<void> {
  const task = await db.tasks.get(taskId);
  if (task?.enableStreak === true) throw new Error("已勾选为打卡项目的任务不能隐藏，请先取消勾选");
  const hidden = await loadHiddenHabitCandidates();
  if (!hidden.includes(taskId)) await saveHiddenHabitCandidates([...hidden, taskId]);
}

export async function unhideHabitCandidate(taskId: string): Promise<void> {
  const hidden = await loadHiddenHabitCandidates();
  await saveHiddenHabitCandidates(hidden.filter((id) => id !== taskId));
}

/** 已隐藏的候选任务列表（供"已隐藏 N 项"展开区用，可从这里取消隐藏） */
export async function getHiddenHabitCandidates(): Promise<{ taskId: string; title: string }[]> {
  const [tasks, hidden] = await Promise.all([db.tasks.toArray(), loadHiddenHabitCandidates()]);
  const hiddenSet = new Set(hidden);
  return tasks
    .filter((t) => hiddenSet.has(t.id))
    .sort(sortTasks)
    .map((t) => ({ taskId: t.id, title: taskShortName(t) }));
}

/**
 * 勾选 / 取消某任务为打卡项目。走 getRepository().update 以同步云端。
 * 勾选 → enableStreak=true，起点由 taskRepository 写为今天（重勾更新为新起点）；
 * 取消 → enableStreak=false，起点保留（历史月历可回看）。
 */
export async function setHabitEnabled(taskId: string, enabled: boolean): Promise<void> {
  await getRepository().update(taskId, { enableStreak: enabled });
}

/**
 * 手动修改已勾选项目的打卡起点（管理弹窗直接编辑，默认值仍是勾选当天，此为手动调整）。
 * 只允许改动已勾选项目；不允许晚于今天（避免"起点在未来"这种无意义状态）。
 */
export async function setHabitStartDate(taskId: string, date: string, today: string = todayKey()): Promise<void> {
  if (date > today) throw new Error("打卡起点不能晚于今天");
  const task = await db.tasks.get(taskId);
  if (!task || task.enableStreak !== true) throw new Error("该任务不是已勾选的打卡项目");
  await getRepository().update(taskId, { streakStartDate: date });
}

// ── 打卡月历 ─────────────────────────────────────────────────────────────────

export type HabitDayStatus = "done" | "missed" | "off";

export interface HabitCalendar {
  /** 单任务时是真实 taskId；命中 HABIT_GROUPS 分组时是合成的组 key（如 "piano"） */
  taskId: string;
  title: string;
  /** 该项目自身的当前连续天数（与展示月份无关，恒从今天往回算） */
  currentStreak: number;
  /** Completion days in the displayed month, counted once per calendar day. */
  monthCompletedDays: number;
  /** 这个月有没有任何一天排了它（停掉的月份为 false，打卡矩阵不显示这一行） */
  hasScheduleInMonth: boolean;
  /**
   * 该月逐日状态：done 完成（休息日完成同样算 done）/ missed 应做未完成 /
   * off 非应做日（起点前、未排期、未来）或"休息日且未完成"（免罚不算漏卡）
   */
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
  const paused = createTravelPauseCheck(tasks, occurrences);
  const occByKey: OccMap = new Map(occurrences.map((o) => [`${o.taskId}:${o.occurrenceDate}`, o]));
  // 与 getHabitCandidates 口径对齐：非 recurring 类任务即使 enableStreak=true 也不出现
  // （管理弹窗只认重复类任务，若这里不同步限制，会出现"月历有卡但管理不了"的孤儿卡）
  const eligible = tasks.filter((t) => statsEligible(t) && t.status !== "cancelled");

  // 已启用的项目：项目里任一任务被勾选，整个项目即启用；成员按归属 key 收集——
  // 固定分组（钢琴）按 subCategory 自动纳入（每次上课单独建的单日任务无需逐条勾选），
  // 接上的项目（habitKey）把间断后新建的任务和以前的任务合成一行（2026-11-14）。
  const enabledKeys = new Set(eligible.filter((t) => t.enableStreak === true && isHabitMember(t)).map(habitProjectKey));
  const groups = new Map<string, Task[]>();
  for (const task of [...eligible].sort(sortTasks)) {
    const key = habitProjectKey(task);
    if (!enabledKeys.has(key) || !isHabitMember(task)) continue;
    const list = groups.get(key);
    if (list) list.push(task); else groups.set(key, [task]);
  }
  // 项目起点：固定分组沿用"已勾选任务里最早的起点"；其余取成员里最早的起点
  // （接上的旧任务即使已取消勾选，起点也保留着，历史月历照常显示）
  const projectStart = (members: Task[]): string | undefined => {
    if (HABIT_GROUPS[members[0].subCategory]) {
      // 固定分组：与 2026-08-12 起的口径完全一致（按排序依次取已勾选任务的起点，取更早的）
      let start: string | undefined;
      let seen = false;
      for (const t of members) {
        if (t.enableStreak !== true) continue;
        start = !seen || (start && t.streakStartDate && t.streakStartDate < start) ? t.streakStartDate : start;
        seen = true;
      }
      return start;
    }
    return members.map((t) => t.streakStartDate).filter((d): d is string => !!d).sort()[0];
  };

  const monthStart = toDateKey(startOfMonth(parseISO(`${month}-01`)));
  const monthEnd = toDateKey(endOfMonth(parseISO(`${month}-01`)));
  const monthDays = listDays(monthStart, monthEnd);

  return [...groups.entries()].map(([key, groupTasks]) => {
    const start = projectStart(groupTasks);
    const days = monthDays.map((date) => {
      let status: HabitDayStatus;
      if (date > today) status = "off";                                                 // 未来日
      else if (!groupApplicable(groupTasks, date, occByKey, start, paused)) status = "off"; // 起点前 / 未排期 / 取消或旅游暂停
      else if (groupSatisfied(groupTasks, date, occByKey, start, paused)) status = "done"; // 完成（含旅游期间已完成的历史记录）
      else if (rests.has(date)) status = "off";                                        // 休息日未完成：免罚不算漏卡
      else status = "missed";
      return { date, status };
    });
    return {
      taskId: key,
      title: projectTitle(groupTasks),
      currentStreak: computeGroupStreak(groupTasks, today, occByKey, rests, start, paused),
      monthCompletedDays: days.filter((day) => day.status === "done").length,
      hasScheduleInMonth: monthDays.some((date) => groupTasks.some((t) => scheduleOccursOn(t, date))),
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
