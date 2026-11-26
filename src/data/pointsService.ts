/**
 * 积分的读取、结算、家长操作、庆祝判定（2026-11-24）。规则与纯计算在 utils/points.ts，存储在 data/pointsLedger.ts。
 */
import { db } from "./db";
import { taskRepository } from "./taskRepository";
import { loadPointsLedger, updatePointsLedger } from "./pointsLedger";
import type { Task } from "../types/task";
import { getWeekStartKey, todayKey, toLocalDateKey } from "../utils/date";
import { isWeekPlanTask } from "../utils/taskGrouping";
import {
  activeBonuses, REACH_BONUS, buildWeekSnapshot, computePointsSummary, earlyItemsForWeek, EARLY_POINTS, isEarlyCompleted, isSettleTime,
  moreToDoToday, pendingRedeemPoints, practiceShortName, practiceVerb, redemptionsOf,
  scorePracticeWeek, weeksNeedingSnapshot, type PointsLedger, type PointsSummary, type RedeemEntry,
} from "../utils/points";

export interface PointsContext {
  tasks: Task[];
  ledger: PointsLedger;
  summary: PointsSummary;
  /** 待兑现积分（可为负 = 多兑了），2026-11-26 */
  redeemable: number;
  /** 兑现记录（记账里没删的练习奖励），新的在前 */
  redemptions: RedeemEntry[];
}

export async function loadPointsContext(today = todayKey()): Promise<PointsContext> {
  // 记账记录在本机 Dexie（云端拉取时合并进来），读它不等网络
  const [tasks, ledger, entries] = await Promise.all([db.tasks.toArray(), loadPointsLedger(), db.ledgerEntries.toArray()]);
  const summary = computePointsSummary(tasks, ledger, today);
  return { tasks, ledger, summary, redeemable: pendingRedeemPoints(summary.history, entries), redemptions: redemptionsOf(entries) };
}

// 结算和预设都要等云端数据拉下来以后再做：没登录的设备本地是空的，拿空数据结算会写出一份空快照
let dataReady = false;
export const markPointsDataReady = () => { dataReady = true; };

/**
 * 补上该拍、还没拍的周快照：已经过完的周，以及周日晚上 8 点以后的这一周；那周没打开过应用的，下次打开时补。
 * 快照只固定那周的分值、目标、多做设置（2026-11-26 起不再固定零花钱，零花钱由家长在记账页兑现）。
 */
export async function settlePendingWeeks(context: PointsContext, today = todayKey(), now = new Date()): Promise<boolean> {
  if (!dataReady) return false;
  const includeCurrent = isSettleTime(now) && getWeekStartKey(now) === getWeekStartKey(today);
  const missing = weeksNeedingSnapshot(today, context.ledger.snapshots, includeCurrent);
  if (missing.length === 0) return false;
  const settledAt = now.toISOString();
  await updatePointsLedger((current) => {
    const snapshots = { ...current.snapshots };
    const bonusOf = (week: string) => activeBonuses(current).filter((bonus) => getWeekStartKey(bonus.date) === week).reduce((sum, bonus) => sum + bonus.points, 0);
    const earlyOf = (week: string) => earlyItemsForWeek(context.tasks, current, week).reduce((sum, item) => sum + item.points, 0);
    missing.forEach((week) => { if (!snapshots[week]) snapshots[week] = buildWeekSnapshot(context.tasks, week, settledAt, bonusOf(week), earlyOf(week)); });
    return { ...current, snapshots };
  });
  return true;
}

// ── 庆祝 ─────────────────────────────────────────────────────────────────

/** 中档庆祝：少量散花 + 一句提示，点一下消失（"攒到一朵小红花"的大档已随小红花取消） */
/**
 * 庆祝：card = 屏幕中间的卡片 + 大散花（停 4.5 秒）；mini = 只炸一小圈散花和"✓ 做完了"小胶囊（1.6 秒，不挡点击）。
 * flyTo：卡片收起时飞到页面上这个元素的位置（CSS 选择器），找不到就原地淡出。
 */
export interface Celebration { id: string; title: string; detail?: string; kind?: "card" | "mini"; flyTo?: string }

/** 记下"已庆祝"，返回其中这次真正第一次庆祝的 key（另一台设备已经庆祝过的不再弹） */
async function claimCelebrations(keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const fresh = new Set<string>();
  const now = new Date().toISOString();
  await updatePointsLedger((current) => {
    const celebrated = { ...current.celebrated };
    keys.forEach((key) => { if (!celebrated[key]) { celebrated[key] = now; fresh.add(key); } });
    return { ...current, celebrated };
  });
  return fresh;
}

/**
 * 每周练习当天记了一次之后：某项本周刚达标 → 中档庆祝"钢琴本周练够了！达标奖励 +2。本周 N 分"。补记（过去日期）不调用。
 * priorLog 是记之前界面上的那份记录，用它判断"刚达标"（不用在写入前多读一次库）。
 */
export async function practiceCelebrations(taskId: string, priorLog: Record<string, number> | undefined, today = todayKey()): Promise<Celebration[]> {
  const after = await loadPointsContext(today);
  const weekStart = getWeekStartKey(today);
  const taskAfter = after.tasks.find((task) => task.id === taskId);
  if (!taskAfter) return [];
  const was = scorePracticeWeek({ ...taskAfter, weeklyLog: priorLog }, weekStart);
  const now = scorePracticeWeek(taskAfter, weekStart);
  if (!now.reached || was.reached) return [];
  const key = `reach:${weekStart}:${taskId}`;
  const fresh = await claimCelebrations([key]);
  if (!fresh.has(key)) return [];
  const name = practiceShortName(taskAfter);
  return [{ id: key, title: `${name}本周${practiceVerb(name)}够了！`, detail: `达标奖励 +${REACH_BONUS}。本周 ${after.summary.weekTotal} 分` }];
}

/** 当天学校作业（不含本周作业、提醒）的完成情况；没有学校作业时 total = 0 */
export async function schoolHomeworkState(date: string): Promise<{ ids: string[]; allDone: boolean }> {
  const tasks = (await taskRepository.getTasksForDate(date)).filter((task) => task.mainCategory === "school" && !isWeekPlanTask(task, date));
  return { ids: tasks.map((task) => task.id), allDone: tasks.length > 0 && tasks.every((task) => task.status === "done" || task.status === "cancelled") };
}

/** 今日页“今天的作业做完了，快去赚积分吧！”那一条（庆祝卡片收起时飞到这里） */
export const HOMEWORK_DONE_BAND = '[data-testid="more-to-do"]';

/**
 * 当天打勾（不是补记）之后的作业庆祝。2026-11-24 用户："只要某一项做完了，都要有庆祝的礼花和奖励"——
 * - 本周课外作业整项做完（截止日之前，就是提前完成）→ 卡片"提前完成了！拿给妈妈检查，通过了有奖励"；
 * - 本周课外作业勾掉其中一小项、整项还没完 → mini 散花"✓ 做完了"；
 * - 当天学校作业刚全部做完 → 卡片"今天的作业做完了，快去赚积分吧！"（练习都做过了写"今天的作业都做完了！"），
 *   收起时飞到今日页左上角那一条。
 * 作业庆祝**不限次数**（取消再勾上也会再庆祝；原来每项 / 每天只庆祝一次，用户试的时候没弹出来）。
 * subItem：这次勾的是小项。
 */
export async function homeworkCelebrations(taskId: string, wasDone: boolean, today = todayKey(), subItem = false): Promise<Celebration[]> {
  if (wasDone) return [];
  const result: Celebration[] = [];
  const stamp = Date.now();
  const task = await taskRepository.getTask(taskId);
  if (task && isEarlyCompleted(task) && toLocalDateKey(task.completedAt!) === today) {
    result.push({ id: `early:${task.id}:${stamp}`, title: `提前完成，加 ${EARLY_POINTS} 分！`, detail: "截止日之前做完的课外作业，每项自动加 3 分" });
  } else if (task && subItem && task.status !== "done" && isWeekPlanTask(task, today)) {
    result.push({ id: `item:${task.id}:${stamp}`, title: "做完了", kind: "mini" });
  }
  const school = await schoolHomeworkState(today);
  if (school.allDone && school.ids.includes(taskId)) {
    const more = moreToDoToday(await taskRepository.getWeeklyTimes(today), today).length > 0;
    result.push({ id: `school:${today}:${stamp}`, title: more ? "今天的作业做完了，快去赚积分吧！" : "今天的作业都做完了！", flyTo: HOMEWORK_DONE_BAND });
  }
  return result;
}

// ── 家长操作 ──────────────────────────────────────────────────────────────

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export async function addBonus(points: number, reason: string, earlyTaskId?: string, date = todayKey()): Promise<PointsLedger> {
  const value = Math.round(points);
  const text = reason.trim();
  if (!value) throw new Error("请填写加几分或减几分");
  if (!text) throw new Error("请写上原因");
  const now = new Date().toISOString();
  const id = newId();
  return updatePointsLedger((current) => ({
    ...current,
    bonuses: [...current.bonuses, { id, date, points: value, reason: text, earlyTaskId, createdAt: now, updatedAt: now }],
    earlyDecisions: earlyTaskId ? { ...current.earlyDecisions, [earlyTaskId]: { decision: "award", bonusId: id, decidedAt: now, updatedAt: now } } : current.earlyDecisions,
  }));
}

export async function revokeBonus(id: string): Promise<PointsLedger> {
  const now = new Date().toISOString();
  return updatePointsLedger((current) => ({ ...current, bonuses: current.bonuses.map((bonus) => bonus.id === id && !bonus.revokedAt ? { ...bonus, revokedAt: now, updatedAt: now } : bonus) }));
}

