/**
 * 积分的读取、结算、家长操作、庆祝判定（2026-11-24）。规则与纯计算在 utils/points.ts，存储在 data/pointsLedger.ts。
 */
import { db } from "./db";
import { getRepository } from "./repositoryProvider";
import { taskRepository } from "./taskRepository";
import { loadPointsLedger, loadPresetResult, savePresetResult, updatePointsLedger, type PresetResult } from "./pointsLedger";
import type { Task } from "../types/task";
import { getWeekStartKey, todayKey, toLocalDateKey } from "../utils/date";
import { isWeekPlanTask } from "../utils/taskGrouping";
import { taskShortName } from "../utils/taskMeta";
import {
  buildWeekSnapshot, computePointsSummary, findPracticePreset, flowersFor, formatMoreToDo, isEarlyCompleted, moreToDoToday,
  practiceVerb, PRACTICE_PRESETS, scorePracticeWeek, weeksNeedingSnapshot, type PointsLedger, type PointsSummary, type Wish,
} from "../utils/points";

export interface PointsContext { tasks: Task[]; ledger: PointsLedger; summary: PointsSummary }

export async function loadPointsContext(today = todayKey()): Promise<PointsContext> {
  const [tasks, ledger] = await Promise.all([db.tasks.toArray(), loadPointsLedger()]);
  return { tasks, ledger, summary: computePointsSummary(tasks, ledger, today) };
}

// 结算和预设都要等云端数据拉下来以后再做：没登录的设备本地是空的，拿空数据结算会写出一份空快照
let dataReady = false;
export const markPointsDataReady = () => { dataReady = true; };

/** 补上已经结束、还没结算的周的快照（每周日过完固定一次；那周没打开过应用的，下次打开时补） */
export async function settlePendingWeeks(context: PointsContext, today = todayKey()): Promise<boolean> {
  if (!dataReady) return false;
  const missing = weeksNeedingSnapshot(today, context.ledger.snapshots);
  if (missing.length === 0) return false;
  const now = new Date().toISOString();
  await updatePointsLedger((current) => {
    const snapshots = { ...current.snapshots };
    missing.forEach((week) => { if (!snapshots[week]) snapshots[week] = buildWeekSnapshot(context.tasks, week, now); });
    return { ...current, snapshots };
  });
  return true;
}

/**
 * 上线时按标题给现有每周练习设分值（只套一次，结果记在 app_settings，跨设备只做一次）。
 * 已经手动设过分值的任务不覆盖。返回这次（或以前那次）的匹配结果。
 */
export async function applyPracticePresetsOnce(): Promise<PresetResult | null> {
  if (!dataReady) return null;
  const existing = await loadPresetResult();
  if (existing) return existing;
  const tasks = (await db.tasks.toArray()).filter((task) => task.timeType === "weeklyTimes" && !task.deletedAt && task.status !== "cancelled");
  const matched: PresetResult["matched"] = [];
  for (const task of tasks) {
    const preset = findPracticePreset(task.title);
    if (!preset) continue;
    if (task.practicePoints === undefined && task.practiceExtraScores === undefined) {
      await getRepository().update(task.id, { practicePoints: preset.points, practiceExtraScores: preset.extraScores });
    }
    matched.push({ id: task.id, title: task.title, points: preset.points, extraScores: preset.extraScores });
  }
  const matchedTitles = new Set(matched.map((item) => findPracticePreset(item.title)?.title));
  const result: PresetResult = {
    appliedAt: new Date().toISOString(),
    matched,
    unmatchedPresets: PRACTICE_PRESETS.filter((preset) => !matchedTitles.has(preset.title)).map((preset) => preset.title),
    unmatchedTasks: tasks.filter((task) => !findPracticePreset(task.title)).map((task) => task.title),
  };
  await savePresetResult(result);
  return result;
}

// ── 庆祝 ─────────────────────────────────────────────────────────────────

export type CelebrationLevel = "medium" | "big";
export interface Celebration { id: string; level: CelebrationLevel; title: string; detail?: string }

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

const flowerCelebration = (flowers: number): Celebration => ({ id: `flower:${flowers}`, level: "big", title: "攒到一朵小红花！", detail: `现在有 ${flowers} 朵` });

/**
 * 每周练习当天记了一次之后：某项本周刚达标 → 中档；累计分刚跨过 100 的整数倍 → 大档。补记（过去日期）不调用。
 * priorLog 是记之前界面上的那份记录，用它还原"记之前"的分数（不用在写入前多读一次库）。
 */
export async function practiceCelebrations(taskId: string, priorLog: Record<string, number> | undefined, today = todayKey()): Promise<Celebration[]> {
  const after = await loadPointsContext(today);
  const weekStart = getWeekStartKey(today);
  const taskAfter = after.tasks.find((task) => task.id === taskId);
  if (!taskAfter) return [];
  const was = scorePracticeWeek({ ...taskAfter, weeklyLog: priorLog }, weekStart);
  const now = scorePracticeWeek(taskAfter, weekStart);
  const cumulativeBefore = after.summary.cumulative - (now.total - was.total);
  const result: Celebration[] = [];
  const keys: string[] = [];
  if (now.reached && !was.reached) {
    const key = `reach:${weekStart}:${taskId}`;
    keys.push(key);
    const name = taskShortName(taskAfter);
    result.push({ id: key, level: "medium", title: `${name}本周${practiceVerb(name)}够了！`, detail: `达标奖励 +2。再得 ${after.summary.toNextFlower} 分就能换下一朵小红花` });
  }
  for (let n = flowersFor(cumulativeBefore) + 1; n <= flowersFor(after.summary.cumulative); n += 1) keys.push(`flower:${n}`);
  const fresh = await claimCelebrations(keys);
  const out = result.filter((item) => fresh.has(item.id));
  if (fresh.has(`flower:${flowersFor(after.summary.cumulative)}`)) out.unshift(flowerCelebration(after.summary.flowers));
  return out;
}

/** 家长加了奖励之后：累计分刚跨过 100 的整数倍 → 大档 */
export async function flowerCelebrations(cumulativeBefore: number, today = todayKey()): Promise<Celebration[]> {
  const after = await loadPointsContext(today);
  const keys: string[] = [];
  for (let n = flowersFor(cumulativeBefore) + 1; n <= flowersFor(after.summary.cumulative); n += 1) keys.push(`flower:${n}`);
  const fresh = await claimCelebrations(keys);
  return fresh.has(`flower:${flowersFor(after.summary.cumulative)}`) ? [flowerCelebration(after.summary.flowers)] : [];
}

/** 当天学校作业（不含本周作业、提醒）的完成情况；没有学校作业时 total = 0 */
export async function schoolHomeworkState(date: string): Promise<{ ids: string[]; allDone: boolean }> {
  const tasks = (await taskRepository.getTasksForDate(date)).filter((task) => task.mainCategory === "school" && !isWeekPlanTask(task, date));
  return { ids: tasks.map((task) => task.id), allDone: tasks.length > 0 && tasks.every((task) => task.status === "done" || task.status === "cancelled") };
}

/** "还可以再做：钢琴练习 +2 我爱背诗 +1"；没有可做的返回空串 */
export async function moreToDoText(today = todayKey()): Promise<string> {
  const practice = await taskRepository.getWeeklyTimes(today);
  return formatMoreToDo(moreToDoToday(practice, today));
}

/**
 * 当天打勾（不是补记）之后：本周作业提前完成 → 中档；当天学校作业刚全部做完 → 中档。
 * "刚全部做完"：这一项是今天的学校作业、勾之前没完成、勾之后今天的学校作业全完成了（只有这一项变了，所以之前一定没全完成）。
 */
export async function homeworkCelebrations(taskId: string, wasDone: boolean, today = todayKey()): Promise<Celebration[]> {
  if (wasDone) return [];
  const result: Celebration[] = [];
  const task = await taskRepository.getTask(taskId);
  if (task && isEarlyCompleted(task) && toLocalDateKey(task.completedAt!) === today) {
    result.push({ id: `early:${task.id}`, level: "medium", title: "提前完成了！", detail: "拿给妈妈检查，通过了有奖励" });
  }
  const school = await schoolHomeworkState(today);
  if (school.allDone && school.ids.includes(taskId)) {
    const more = await moreToDoText(today);
    result.push({ id: `school:${today}`, level: "medium", title: "哇，全完成了！", detail: more ? `你还可以再做：${more}` : undefined });
  }
  const fresh = await claimCelebrations(result.map((item) => item.id));
  return result.filter((item) => fresh.has(item.id));
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

export async function skipEarly(taskId: string): Promise<PointsLedger> {
  const now = new Date().toISOString();
  return updatePointsLedger((current) => ({ ...current, earlyDecisions: { ...current.earlyDecisions, [taskId]: { decision: "skip", decidedAt: now, updatedAt: now } } }));
}

export async function addWish(text: string): Promise<PointsLedger> {
  const value = text.trim();
  if (!value) throw new Error("写一下愿望是什么");
  const now = new Date().toISOString();
  const wish: Wish = { id: newId(), text: value.slice(0, 60), status: "pending", cost: 1, createdAt: now, updatedAt: now };
  return updatePointsLedger((current) => ({ ...current, wishes: [...current.wishes, wish] }));
}

export async function confirmWish(id: string, cost: number): Promise<PointsLedger> {
  const flowers = Math.max(1, Math.min(99, Math.round(cost) || 1));
  const now = new Date().toISOString();
  return updatePointsLedger((current) => ({ ...current, wishes: current.wishes.map((wish) => wish.id === id && wish.status !== "redeemed" ? { ...wish, status: "confirmed", cost: flowers, confirmedAt: now, updatedAt: now } : wish) }));
}

/** 兑换：小红花够才行（以最新数据为准），扣除并记下兑换时间 */
export async function redeemWish(id: string): Promise<PointsLedger> {
  const tasks = await db.tasks.toArray();
  return updatePointsLedger((current) => {
    const wish = current.wishes.find((item) => item.id === id);
    if (!wish || wish.status !== "confirmed" || wish.deletedAt) throw new Error("这个愿望还没确认，或者已经兑换过了");
    const { flowers } = computePointsSummary(tasks, current, todayKey());
    if (flowers < wish.cost) throw new Error(`小红花还不够（需要 ${wish.cost} 朵，现在 ${flowers} 朵）`);
    const now = new Date().toISOString();
    return { ...current, wishes: current.wishes.map((item) => item.id === id ? { ...item, status: "redeemed", redeemedAt: now, updatedAt: now } : item) };
  });
}

export async function deleteWish(id: string): Promise<PointsLedger> {
  const now = new Date().toISOString();
  return updatePointsLedger((current) => ({ ...current, wishes: current.wishes.map((wish) => wish.id === id && wish.status !== "redeemed" ? { ...wish, deletedAt: now, updatedAt: now } : wish) }));
}

