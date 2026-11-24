/**
 * 每周练习积分 → 零花钱（2026-11-24）。这里只放纯函数：分数一律由完成记录（task.weeklyLog）算出，
 * 不保存可修改的总分（R1 权威源）。需要单独保存的东西（家长奖励、已庆祝、每周结算快照……）
 * 存在 app_settings 的 `points_ledger_v1`，读写见 data/pointsLedger.ts。零花钱怎么入账见 utils/ledger.ts。
 *
 * 规则唯一依据是 docs/TASK_09_points.md（下面是摘要，不一致时以那个文件为准；写死在代码里，不做成设置）：
 * - 只有今日页右栏"每周练习"（timeType = weeklyTimes）计分；学校作业、本周作业、提醒、休闲、旅游都不计分。
 * - 积分从 2026-11-23（周一）这一周开始，之前的周不补算。
 * - 每项练习有两个设置（存在任务上，metadata jsonb）：每次分值 practicePoints（默认 1）、
 *   多做的部分是否计分 practiceExtraScores（默认计分）。
 * - 单位是"次"的（钢琴、背诗、听写）每天最多算一次；本 / 页 / 篇 / 题 / 分钟按记的数量算。
 * - 每完成一次得"每次分值"；本周达到目标再 +2（哪天达标都一样）；超过目标的部分，计分的照样按分值得分，
 *   不计分的不得分（界面只提示"多读了 N 本"）；没达标做多少得多少，不扣分。
 * - 只看本周内的记录，不结转到下周。
 * - 家长奖励可加可减、必须写原因、可撤回（撤回的不算）。
 * - 1 分 = 1 元：每周结算后，那周得分（练习 + 家长奖励，不低于 0）就是那周的零花钱，记在快照的 allowance 里，
 *   之后再补勾、撤回奖励都不改已经结算的零花钱。小红花、愿望已取消（2026-11-24）。
 * - 每周日晚上 8 点起（SETTLE_HOUR）结算这一周，那周没打开过应用的，下次打开时补算。快照记下结算时的分值、
 *   目标、多做设置；之后再改分值或目标，已结算的周不受影响。
 *   结算后家长在那周补勾 / 撤销某次打勾，仍按快照里的设置重算（分数跟着完成记录走）；
 *   任务被删掉的，那周按快照里记下的分数算。
 */
import { addDays } from "date-fns";
import type { Task } from "../types/task";
import { fromDateKey, getWeekStartKey, toDateKey, toLocalDateKey } from "./date";
import { weeklyTimesActiveIn } from "./weeklyTimes";
import { taskShortName } from "./taskMeta";

export const POINTS_START_WEEK = "2026-11-23";
/** 1 分 = 1 元 */
export const YUAN_PER_POINT = 1;
/** 周日几点起结算这一周（之前打开只显示，不结算） */
export const SETTLE_HOUR = 20;
export const REACH_BONUS = 2;
export const DEFAULT_PRACTICE_POINTS = 1;
export const DEFAULT_PRACTICE_EXTRA_SCORES = true;
export const PRACTICE_POINTS_MAX = 20;

/**
 * 各项练习的分值预设（docs/TASK_09_points.md §3）。
 *
 * 2026-11-24 第二版匹配：第一版要求标题去空格后完全相同，线上没套上——
 * 钢琴练习是"兴趣班·钢琴练习"、标题留空（界面显示的是分类名），小白欧的标题带页码"小白欧22页-23页"。
 * 现在按"显示名"（taskShortName：标题，空标题用分类名）找关键词；同时命中两项以上的不猜，列出来。
 * short 是提示里用的短名（"钢琴 +2　背诗 +1　听写 +1"）。
 */
export interface PracticePreset { title: string; short: string; points: number; extraScores: boolean; match: RegExp; exclude?: RegExp }

export const PRACTICE_PRESETS: PracticePreset[] = [
  { title: "钢琴练习", short: "钢琴", points: 2, extraScores: true, match: /钢琴|练琴/ },
  { title: "我爱背诗", short: "背诗", points: 1, extraScores: true, match: /背诗/ },
  { title: "英语单词听写", short: "听写", points: 1, extraScores: true, match: /听写/, exclude: /语文|中文|汉字|生字/ },
  { title: "RAZ阅读", short: "RAZ", points: 1, extraScores: false, match: /RAZ/ },
  { title: "FCE语用", short: "FCE语用", points: 1, extraScores: false, match: /语用/ },
  { title: "FCE阅读", short: "FCE阅读", points: 2, extraScores: true, match: /FCE.*(阅读|READING)/ },
  { title: "FCE听力", short: "FCE听力", points: 1, extraScores: true, match: /FCE.*(听力|LISTENING)/ },
  { title: "小白欧", short: "小白欧", points: 2, extraScores: true, match: /小白欧/ },
];

export const normalizePresetTitle = (title: string) => title.replace(/\s+/g, "").toUpperCase();

type NamedTask = { title: string; mainCategory?: Task["mainCategory"]; subCategory?: string };

/** 练习的显示名：标题；空标题的兴趣班 / 课外阅读用分类名（与 taskShortName 一致） */
export function practiceDisplayName(task: NamedTask): string {
  const title = task.title.trim();
  if (title || !task.mainCategory) return title;
  return taskShortName({ mainCategory: task.mainCategory, subCategory: task.subCategory ?? "", title });
}

/** 显示名命中的所有预设（0 个 = 没匹配上，2 个以上 = 拿不准） */
export function matchPracticePresets(task: NamedTask | string): PracticePreset[] {
  const key = normalizePresetTitle(typeof task === "string" ? task : practiceDisplayName(task));
  if (!key) return [];
  return PRACTICE_PRESETS.filter((preset) => preset.match.test(key) && !preset.exclude?.test(key));
}

/** 唯一命中的预设；没命中或命中多项返回 undefined */
export function findPracticePreset(task: NamedTask | string): PracticePreset | undefined {
  const found = matchPracticePresets(task);
  return found.length === 1 ? found[0] : undefined;
}

/** 提示里用的短名："钢琴""背诗""小白欧"；没匹配上预设的用显示名 */
export const practiceShortName = (task: NamedTask) => findPracticePreset(task)?.short ?? practiceDisplayName(task);

export interface PracticeSettings { points: number; extraScores: boolean }

export function practiceSettingsOf(task: Pick<Task, "practicePoints" | "practiceExtraScores">): PracticeSettings {
  const points = Number.isFinite(task.practicePoints) && (task.practicePoints ?? 0) >= 0 ? Math.round(task.practicePoints!) : DEFAULT_PRACTICE_POINTS;
  return { points, extraScores: task.practiceExtraScores ?? DEFAULT_PRACTICE_EXTRA_SCORES };
}

/**
 * 编辑 / 新建任务时显示和保存的分值：任务上设过的用设过的；没设过的按显示名套预设（例如新建一条"小白欧24页-25页"
 * 自动是每页 2 分）；都没有就是默认的 1 分、多做计分。
 */
export function practiceSettingsForForm(task: NamedTask & Pick<Task, "practicePoints" | "practiceExtraScores">): PracticeSettings {
  if (task.practicePoints !== undefined || task.practiceExtraScores !== undefined) return practiceSettingsOf(task);
  const preset = findPracticePreset(task);
  return preset ? { points: preset.points, extraScores: preset.extraScores } : practiceSettingsOf(task);
}

type PracticeTask = Pick<Task, "id" | "title" | "weeklyQuota" | "weeklyLog"> & Partial<Pick<Task, "mainCategory" | "subCategory">>;

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
  return { taskId: task.id, title: practiceDisplayName(task), unit, target, ...settings, count, ...scoreFromCount(count, target, settings) };
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
  /** 练习分合计 */
  total: number;
  reachedCount: number;
  /** 结算时这周的家长奖励合计（可负） */
  bonus?: number;
  /** 这周的零花钱（元）= 练习 + 家长奖励，不低于 0。结算后固定，"待转账"金额就取这个 */
  allowance?: number;
}

/** 那周的零花钱（元）：得分（含家长奖励和扣分）不低于 0 */
export const allowanceFor = (weekTotal: number) => Math.max(0, weekTotal) * YUAN_PER_POINT;

export function buildWeekSnapshot(tasks: Task[], weekStart: string, settledAt: string, bonus = 0): WeekSnapshot {
  const items = practiceTasksForWeek(tasks, weekStart).map((task) => scorePracticeWeek(task, weekStart));
  const total = items.reduce((sum, item) => sum + item.total, 0);
  return { weekStart, settledAt, items, total, reachedCount: items.filter((item) => item.reached).length, bonus, allowance: allowanceFor(total + bonus) };
}

/** 周日晚上 8 点以后：这一周可以结算了 */
export const isSettleTime = (now: Date) => now.getDay() === 0 && now.getHours() >= SETTLE_HOUR;

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

/** 该结算还没有快照的周：已经过完的周，加上（周日晚 8 点后的）这一周。下次打开时补算 */
export function weeksNeedingSnapshot(today: string, snapshots: Record<string, WeekSnapshot>, includeCurrentWeek = false): string[] {
  const thisWeek = getWeekStartKey(today);
  const lastSettled = includeCurrentWeek ? thisWeek : toDateKey(addDays(fromDateKey(thisWeek), -7));
  return weekStartsFrom(POINTS_START_WEEK, lastSettled).filter((week) => !snapshots[week]);
}

// ── 家长奖励、提前完成 ─────────────────────────────────────────────────────

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

export interface PointsLedger {
  version: 1;
  bonuses: BonusEntry[];
  /** 键是作业任务 id */
  earlyDecisions: Record<string, EarlyDecision>;
  /** 已庆祝过的事：reach:周一:任务id / early:任务id / school:日期 → 时间 */
  celebrated: Record<string, string>;
  snapshots: Record<string, WeekSnapshot>;
  /**
   * 代码已经不用、但不能丢的旧字段（例如已取消的愿望 wishes），读进来原样带着，写回时原样写回，
   * 这样 app_settings 里已有的数据不动（2026-11-24 取消小红花和愿望）。
   */
  legacy?: Record<string, unknown>;
}

export const emptyLedger = (): PointsLedger => ({ version: 1, bonuses: [], earlyDecisions: {}, celebrated: {}, snapshots: {} });

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

// ── 汇总 ──────────────────────────────────────────────────────────────────

export interface WeekHistory {
  weekStart: string;
  practice: number;
  bonus: number;
  total: number;
  reachedCount: number;
  settled: boolean;
  /** 那周的零花钱（元）：结算过的取快照里固定的金额，没结算的按现在的得分算 */
  allowance: number;
}

export interface PointsSummary {
  weekStart: string;
  weekScores: PracticeWeekScore[];
  weekPractice: number;
  weekBonus: number;
  weekTotal: number;
  weekBonuses: BonusEntry[];
  /** 本周挣的零花钱（元）= 本周得分，不低于 0 */
  weekAllowance: number;
  history: WeekHistory[];
  pendingEarly: PendingEarly[];
}

export function computePointsSummary(tasks: Task[], ledger: PointsLedger, today: string): PointsSummary {
  const weekStart = getWeekStartKey(today);
  const bonusesByWeek = new Map<string, BonusEntry[]>();
  activeBonuses(ledger).forEach((bonus) => {
    const week = getWeekStartKey(bonus.date);
    bonusesByWeek.set(week, [...(bonusesByWeek.get(week) ?? []), bonus]);
  });
  const weeks = weekStart >= POINTS_START_WEEK ? weekStartsFrom(POINTS_START_WEEK, weekStart) : [];
  let weekScores: PracticeWeekScore[] = [];
  const history: WeekHistory[] = weeks.map((week) => {
    // 这一周在周日晚上结算以后也有快照，但本周的分数仍按现在的设置实时算（快照只固定零花钱）
    const snapshot = week < weekStart ? ledger.snapshots[week] : undefined;
    const scores = weekPracticeScores(tasks, week, snapshot);
    if (week === weekStart) weekScores = scores;
    const practice = scores.reduce((sum, item) => sum + item.total, 0);
    const bonus = (bonusesByWeek.get(week) ?? []).reduce((sum, item) => sum + item.points, 0);
    const settledSnapshot = ledger.snapshots[week];
    const allowance = settledSnapshot?.allowance ?? allowanceFor(practice + bonus);
    return { weekStart: week, practice, bonus, total: practice + bonus, reachedCount: scores.filter((item) => item.reached).length, settled: !!settledSnapshot, allowance };
  });
  const current = history[history.length - 1];
  return {
    weekStart,
    weekScores,
    weekPractice: current?.practice ?? 0,
    weekBonus: current?.bonus ?? 0,
    weekTotal: current?.total ?? 0,
    weekBonuses: ledger.bonuses.filter((bonus) => getWeekStartKey(bonus.date) === weekStart).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    weekAllowance: allowanceFor(current?.total ?? 0),
    history,
    pendingEarly: pendingEarlyItems(tasks, ledger),
  };
}

// ── 今天还可以再做什么 ───────────────────────────────────────────────────

export interface MoreToDo { taskId: string; title: string; name: string; gain: number; reachesTarget: boolean; unit: string }

type MoreToDoTask = Pick<Task, "id" | "title" | "weeklyQuota" | "weeklyLog" | "practicePoints" | "practiceExtraScores" | "endDate"> & Partial<Pick<Task, "mainCategory" | "subCategory">>;

/**
 * 今天还能做、且本周还没达标的练习，以及再做一次能得几分（离达标只差一次的含 +2）。
 * "次"的练习今天已经记过就不算"还能做"。
 */
export function moreToDoToday(tasks: MoreToDoTask[], today: string): MoreToDo[] {
  const weekStart = getWeekStartKey(today);
  return tasks.flatMap((task) => {
    if (task.endDate && task.endDate < today) return [];
    const score = scorePracticeWeek(task, weekStart);
    if (score.reached) return [];
    if (score.unit === "次" && (task.weeklyLog?.[today] ?? 0) > 0) return [];
    const next = scoreFromCount(score.count + 1, score.target, score);
    return [{ taskId: task.id, title: task.title, name: practiceShortName(task), gain: next.total - score.total, reachesTarget: next.reached, unit: score.unit }];
  });
}

/** "钢琴 +2　背诗 +1　听写 +1"；差一次达标的写"钢琴再练 1 次 +4"（docs/TASK_09_points.md §9.5、§10） */
export function formatMoreToDo(items: MoreToDo[]): string {
  return items.map((item) => item.reachesTarget ? `${item.name}再${practiceVerb(item.name)} 1 ${item.unit} +${item.gain}` : `${item.name} +${item.gain}`).join("　");
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
