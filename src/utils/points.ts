/**
 * 每周练习积分 + 小红花 + 愿望（2026-11-24）。这里只放纯函数：分数一律由完成记录（task.weeklyLog）算出，
 * 不保存可修改的总分（R1 权威源）。需要单独保存的东西（家长奖励、愿望、已庆祝、每周结算快照……）
 * 存在 app_settings 的 `points_ledger_v1`，读写见 data/pointsLedger.ts。
 *
 * 规则（用户 2026-11-24 定，写死在这里，不做成设置）：
 * - 只有今日页右栏"每周练习"（timeType = weeklyTimes）计分；学校作业、本周作业、提醒、休闲、旅游都不计分。
 * - 积分从 2026-11-23（周一）这一周开始，之前的周不补算。
 * - 每项练习有两个设置（存在任务上，metadata jsonb）：每次分值 practicePoints（默认 1）、
 *   多做的部分是否计分 practiceExtraScores（默认计分）。
 * - 单位是"次"的（钢琴、背诗、听写）每天最多算一次；本 / 页 / 篇 / 题 / 分钟按记的数量算。
 * - 每完成一次得"每次分值"；本周达到目标再 +2（哪天达标都一样）；超过目标的部分，计分的照样按分值得分，
 *   不计分的不得分（界面只提示"多读了 N 本"）；没达标做多少得多少，不扣分。
 * - 只看本周内的记录，不结转到下周。
 * - 家长奖励可加可减、必须写原因、可撤回（撤回的不算）。
 * - 分数跨周累积不清零；小红花 = 累计总分每满 100 得 1 朵，减去已兑换的。
 * - 每周日结束后把那周固定成快照（结算时的分值、目标、多做设置）；之后再改分值或目标，已结算的周不受影响。
 *   结算后家长在那周补勾 / 撤销某次打勾，仍按快照里的设置重算（分数跟着完成记录走）；
 *   任务被删掉的，那周按快照里记下的分数算。
 */
import { addDays } from "date-fns";
import type { Task } from "../types/task";
import { fromDateKey, getWeekStartKey, toDateKey, toLocalDateKey } from "./date";
import { weeklyTimesActiveIn } from "./weeklyTimes";

export const POINTS_START_WEEK = "2026-11-23";
export const POINTS_PER_FLOWER = 100;
export const REACH_BONUS = 2;
export const DEFAULT_PRACTICE_POINTS = 1;
export const DEFAULT_PRACTICE_EXTRA_SCORES = true;
export const PRACTICE_POINTS_MAX = 20;

/**
 * 上线时按标题给现有练习预设的分值（用户 2026-11-24 给的表）。只在第一次打开时套一次（applyPracticePresets），
 * 标题去掉空格、不分大小写后完全相同才算匹配，匹配不到的不猜。
 */
export const PRACTICE_PRESETS: { title: string; points: number; extraScores: boolean }[] = [
  { title: "钢琴练习", points: 2, extraScores: true },
  { title: "我爱背诗", points: 1, extraScores: true },
  { title: "英语单词听写", points: 1, extraScores: true },
  { title: "RAZ阅读", points: 1, extraScores: false },
  { title: "FCE语用", points: 1, extraScores: false },
  { title: "FCE阅读", points: 2, extraScores: true },
  { title: "FCE听力", points: 1, extraScores: true },
  { title: "小白欧", points: 2, extraScores: true },
];

export const normalizePresetTitle = (title: string) => title.replace(/\s+/g, "").toUpperCase();

export function findPracticePreset(title: string) {
  const key = normalizePresetTitle(title);
  return PRACTICE_PRESETS.find((preset) => normalizePresetTitle(preset.title) === key);
}

export interface PracticeSettings { points: number; extraScores: boolean }

export function practiceSettingsOf(task: Pick<Task, "practicePoints" | "practiceExtraScores">): PracticeSettings {
  const points = Number.isFinite(task.practicePoints) && (task.practicePoints ?? 0) >= 0 ? Math.round(task.practicePoints!) : DEFAULT_PRACTICE_POINTS;
  return { points, extraScores: task.practiceExtraScores ?? DEFAULT_PRACTICE_EXTRA_SCORES };
}

type PracticeTask = Pick<Task, "id" | "title" | "weeklyQuota" | "weeklyLog">;

/** 一项练习一周的得分明细 */
export interface PracticeWeekScore {
  taskId: string;
  title: string;
  unit: string;
  target: number;
  points: number;
  extraScores: boolean;
  /** 本周算分的数量（"次"每天最多 1） */
  count: number;
  reached: boolean;
  /** 完成分：目标以内的部分 × 分值 */
  completionPoints: number;
  /** 达标奖励 */
  reachBonus: number;
  /** 超过目标的数量（不管计不计分） */
  extraCount: number;
  /** 多做分：计分的才有 */
  extraPoints: number;
  total: number;
}

export const weekDays = (weekStart: string) => Array.from({ length: 7 }, (_, index) => toDateKey(addDays(fromDateKey(weekStart), index)));

/** 某天算分的数量：单位"次"每天最多 1 */
export const countedOnDay = (count: number, unit: string) => (unit === "次" ? Math.min(1, Math.max(0, count)) : Math.max(0, count));

/** 按给定的数量、目标、设置算分（纯算术，供"再做一次能得几分"复用） */
export function scoreFromCount(count: number, target: number, settings: PracticeSettings) {
  const reached = count >= target;
  const completionPoints = Math.min(count, target) * settings.points;
  const reachBonus = reached ? REACH_BONUS : 0;
  const extraCount = Math.max(0, count - target);
  const extraPoints = settings.extraScores ? extraCount * settings.points : 0;
  return { reached, completionPoints, reachBonus, extraCount, extraPoints, total: completionPoints + reachBonus + extraPoints };
}

/** 一项练习某一周的得分。frozen：已结算周用快照里记下的目标、单位、分值设置 */
export function scorePracticeWeek(task: PracticeTask & Partial<Pick<Task, "practicePoints" | "practiceExtraScores">>, weekStart: string, frozen?: { target: number; unit: string; points: number; extraScores: boolean }): PracticeWeekScore {
  const unit = frozen?.unit ?? task.weeklyQuota?.unit ?? "次";
  const target = frozen?.target ?? Math.max(1, task.weeklyQuota?.targetCount ?? 1);
  const settings = frozen ? { points: frozen.points, extraScores: frozen.extraScores } : practiceSettingsOf(task);
  const count = weekDays(weekStart).reduce((sum, day) => sum + countedOnDay(task.weeklyLog?.[day] ?? 0, unit), 0);
  return { taskId: task.id, title: task.title, unit, target, ...settings, count, ...scoreFromCount(count, target, settings) };
}

const hasLogIn = (task: PracticeTask, weekStart: string) => weekDays(weekStart).some((day) => (task.weeklyLog?.[day] ?? 0) > 0);

/** 参与某周计分的练习：每周几次、没删、没取消、不是旧阅读计划；那周在有效期内，或那周有记录 */
export function practiceTasksForWeek(tasks: Task[], weekStart: string): Task[] {
  return tasks.filter((task) => task.timeType === "weeklyTimes" && !task.deletedAt && task.status !== "cancelled" && task.mainCategory !== "readingPlan"
    && (weeklyTimesActiveIn(task, weekStart) || hasLogIn(task, weekStart)));
}

// ── 每周结算快照 ───────────────────────────────────────────────────────────

export interface WeekSnapshot {
  weekStart: string;
  settledAt: string;
  /** 结算时每项的设置和得分；之后按这里的目标 / 单位 / 分值重算 */
  items: PracticeWeekScore[];
  total: number;
  reachedCount: number;
}

export function buildWeekSnapshot(tasks: Task[], weekStart: string, settledAt: string): WeekSnapshot {
  const items = practiceTasksForWeek(tasks, weekStart).map((task) => scorePracticeWeek(task, weekStart));
  return { weekStart, settledAt, items, total: items.reduce((sum, item) => sum + item.total, 0), reachedCount: items.filter((item) => item.reached).length };
}

/** 某周每项的得分：没结算的按现在的设置算；结算过的按快照设置重算，任务已删的用快照里的分数 */
export function weekPracticeScores(tasks: Task[], weekStart: string, snapshot?: WeekSnapshot): PracticeWeekScore[] {
  const live = practiceTasksForWeek(tasks, weekStart);
  if (!snapshot) return live.map((task) => scorePracticeWeek(task, weekStart));
  const byId = new Map(tasks.filter((task) => !task.deletedAt).map((task) => [task.id, task]));
  const frozen = snapshot.items.map((item) => {
    const task = byId.get(item.taskId);
    return task ? scorePracticeWeek(task, weekStart, item) : item;
  });
  const known = new Set(snapshot.items.map((item) => item.taskId));
  // 结算时还没有、之后才补记到那周的练习（少见）：按现在的设置算
  const added = live.filter((task) => !known.has(task.id) && hasLogIn(task, weekStart)).map((task) => scorePracticeWeek(task, weekStart));
  return [...frozen, ...added];
}

/** 从 POINTS_START_WEEK 到 untilWeekStart（含）的每个周一 */
export function weekStartsFrom(startWeek: string, untilWeekStart: string): string[] {
  const result: string[] = [];
  let cursor = startWeek;
  while (cursor <= untilWeekStart) {
    result.push(cursor);
    cursor = toDateKey(addDays(fromDateKey(cursor), 7));
  }
  return result;
}

/** 已经结束（周日过完）但还没有快照的周：下次打开时补算 */
export function weeksNeedingSnapshot(today: string, snapshots: Record<string, WeekSnapshot>): string[] {
  const lastSettled = toDateKey(addDays(fromDateKey(getWeekStartKey(today)), -7));
  return weekStartsFrom(POINTS_START_WEEK, lastSettled).filter((week) => !snapshots[week]);
}

// ── 家长奖励、提前完成、愿望 ───────────────────────────────────────────────

export interface BonusEntry {
  id: string;
  /** 给奖励的那天（YYYY-MM-DD），决定算在哪一周 */
  date: string;
  /** 可正可负的整数 */
  points: number;
  reason: string;
  /** 来自"本周作业提前完成"的待处理项 */
  earlyTaskId?: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
}

export interface EarlyDecision {
  decision: "award" | "skip";
  bonusId?: string;
  decidedAt: string;
  updatedAt: string;
}

export type WishStatus = "pending" | "confirmed" | "redeemed";

export interface Wish {
  id: string;
  text: string;
  status: WishStatus;
  /** 需要几朵小红花（家长确认时设定，默认 1） */
  cost: number;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  redeemedAt?: string;
  deletedAt?: string;
}

export interface PointsLedger {
  version: 1;
  bonuses: BonusEntry[];
  /** 键是作业任务 id */
  earlyDecisions: Record<string, EarlyDecision>;
  wishes: Wish[];
  /** 已庆祝过的事：reach:周一:任务id / early:任务id / school:日期 / flower:第几朵 → 时间 */
  celebrated: Record<string, string>;
  snapshots: Record<string, WeekSnapshot>;
}

export const emptyLedger = (): PointsLedger => ({ version: 1, bonuses: [], earlyDecisions: {}, wishes: [], celebrated: {}, snapshots: {} });

export const activeBonuses = (ledger: PointsLedger) => ledger.bonuses.filter((bonus) => !bonus.revokedAt);

/** 本周作业（时段作业，"其他安排"除外）在截止日之前（不含截止日当天）做完；积分开始之前做完的不算 */
export function isEarlyCompleted(task: Task): boolean {
  if (task.deletedAt || task.timeType !== "dateRange" || task.mainCategory === "temporary" || task.mainCategory === "readingPlan") return false;
  if (task.status !== "done" || !task.completedAt || !task.endDate) return false;
  const completed = toLocalDateKey(task.completedAt);
  return completed < task.endDate && completed >= POINTS_START_WEEK;
}

export interface PendingEarly { taskId: string; title: string; completedDate: string; endDate: string }

/** 待处理的提前完成作业：没处理过，或给了分但那笔奖励被撤回了 */
export function pendingEarlyItems(tasks: Task[], ledger: PointsLedger): PendingEarly[] {
  const revoked = new Set(ledger.bonuses.filter((bonus) => bonus.revokedAt).map((bonus) => bonus.id));
  return tasks.filter(isEarlyCompleted).filter((task) => {
    const decision = ledger.earlyDecisions[task.id];
    return !decision || (decision.decision === "award" && !!decision.bonusId && revoked.has(decision.bonusId));
  }).map((task) => ({ taskId: task.id, title: task.title, completedDate: toLocalDateKey(task.completedAt!), endDate: task.endDate! }))
    .sort((a, b) => a.completedDate.localeCompare(b.completedDate));
}

export const flowersRedeemed = (ledger: PointsLedger) => ledger.wishes.filter((wish) => wish.status === "redeemed").reduce((sum, wish) => sum + wish.cost, 0);

/** 当前愿望：最早写的、还没兑换的（没删的） */
export const currentWish = (ledger: PointsLedger) => ledger.wishes.filter((wish) => !wish.deletedAt && wish.status !== "redeemed").sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];

// ── 汇总 ──────────────────────────────────────────────────────────────────

export interface WeekHistory {
  weekStart: string;
  practice: number;
  bonus: number;
  total: number;
  reachedCount: number;
  settled: boolean;
  cumulativeAfter: number;
  flowersEarned: number;
}

export interface PointsSummary {
  weekStart: string;
  weekScores: PracticeWeekScore[];
  weekPractice: number;
  weekBonus: number;
  weekTotal: number;
  weekBonuses: BonusEntry[];
  history: WeekHistory[];
  cumulative: number;
  flowersEarned: number;
  flowersRedeemed: number;
  flowers: number;
  /** 当前这朵攒了多少（0–99） */
  progress: number;
  toNextFlower: number;
  pendingEarly: PendingEarly[];
  wish?: Wish;
}

export const flowersFor = (cumulative: number) => Math.max(0, Math.floor(cumulative / POINTS_PER_FLOWER));

export function computePointsSummary(tasks: Task[], ledger: PointsLedger, today: string): PointsSummary {
  const weekStart = getWeekStartKey(today);
  const bonusesByWeek = new Map<string, BonusEntry[]>();
  activeBonuses(ledger).forEach((bonus) => {
    const week = getWeekStartKey(bonus.date);
    bonusesByWeek.set(week, [...(bonusesByWeek.get(week) ?? []), bonus]);
  });
  const weeks = weekStart >= POINTS_START_WEEK ? weekStartsFrom(POINTS_START_WEEK, weekStart) : [];
  let cumulative = 0;
  let previousFlowers = 0;
  let weekScores: PracticeWeekScore[] = [];
  const history: WeekHistory[] = weeks.map((week) => {
    const snapshot = week < weekStart ? ledger.snapshots[week] : undefined;
    const scores = weekPracticeScores(tasks, week, snapshot);
    if (week === weekStart) weekScores = scores;
    const practice = scores.reduce((sum, item) => sum + item.total, 0);
    const bonus = (bonusesByWeek.get(week) ?? []).reduce((sum, item) => sum + item.points, 0);
    cumulative += practice + bonus;
    const flowersNow = flowersFor(cumulative);
    const entry = { weekStart: week, practice, bonus, total: practice + bonus, reachedCount: scores.filter((item) => item.reached).length, settled: !!snapshot, cumulativeAfter: cumulative, flowersEarned: Math.max(0, flowersNow - previousFlowers) };
    previousFlowers = Math.max(previousFlowers, flowersNow);
    return entry;
  });
  const current = history[history.length - 1];
  const earned = flowersFor(cumulative);
  const redeemed = flowersRedeemed(ledger);
  const progress = cumulative <= 0 ? 0 : cumulative % POINTS_PER_FLOWER;
  return {
    weekStart,
    weekScores,
    weekPractice: current?.practice ?? 0,
    weekBonus: current?.bonus ?? 0,
    weekTotal: current?.total ?? 0,
    weekBonuses: ledger.bonuses.filter((bonus) => getWeekStartKey(bonus.date) === weekStart).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    history,
    cumulative,
    flowersEarned: earned,
    flowersRedeemed: redeemed,
    flowers: Math.max(0, earned - redeemed),
    progress,
    toNextFlower: POINTS_PER_FLOWER - progress,
    pendingEarly: pendingEarlyItems(tasks, ledger),
    wish: currentWish(ledger),
  };
}

// ── 今天还可以再做什么 ───────────────────────────────────────────────────

export interface MoreToDo { taskId: string; title: string; gain: number; reachesTarget: boolean; unit: string }

/**
 * 今天还能做、且本周还没达标的练习，以及再做一次能得几分（离达标只差一次的含 +2）。
 * "次"的练习今天已经记过就不算"还能做"。
 */
export function moreToDoToday(tasks: Pick<Task, "id" | "title" | "weeklyQuota" | "weeklyLog" | "practicePoints" | "practiceExtraScores" | "endDate">[], today: string): MoreToDo[] {
  const weekStart = getWeekStartKey(today);
  return tasks.flatMap((task) => {
    if (task.endDate && task.endDate < today) return [];
    const score = scorePracticeWeek(task, weekStart);
    if (score.reached) return [];
    if (score.unit === "次" && (task.weeklyLog?.[today] ?? 0) > 0) return [];
    const next = scoreFromCount(score.count + 1, score.target, score);
    return [{ taskId: task.id, title: task.title, gain: next.total - score.total, reachesTarget: next.reached, unit: score.unit }];
  });
}

/** "钢琴练习 +2 我爱背诗 +1"；差一次达标的写"钢琴练习再练 1 次 +4" */
export function formatMoreToDo(items: MoreToDo[]): string {
  return items.map((item) => item.reachesTarget ? `${item.title}再${practiceVerb(item.title)} 1 ${item.unit} +${item.gain}` : `${item.title} +${item.gain}`).join("  ");
}

/** 达标提示里的动词：钢琴"练"、阅读"读"，其余"做" */
export function practiceVerb(title: string): string {
  if (/钢琴|琴/.test(title)) return "练";
  if (/读|阅读|RAZ/i.test(title)) return "读";
  if (/背/.test(title)) return "背";
  if (/听写/.test(title)) return "写";
  return "做";
}

/** 记一次后多得几分（可能为 0：已达标且多做不计分；"次"当天已记过） */
export function gainForLog(task: Pick<Task, "id" | "title" | "weeklyQuota" | "weeklyLog" | "practicePoints" | "practiceExtraScores">, date: string, delta: number): number {
  const weekStart = getWeekStartKey(date);
  const before = scorePracticeWeek(task, weekStart).total;
  const log = { ...(task.weeklyLog ?? {}) };
  log[date] = Math.max(0, (log[date] ?? 0) + delta);
  const after = scorePracticeWeek({ ...task, weeklyLog: log }, weekStart).total;
  return after - before;
}
