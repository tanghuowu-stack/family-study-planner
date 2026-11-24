/**
 * 积分的读取、结算、家长操作、庆祝判定（2026-11-24）。规则与纯计算在 utils/points.ts，存储在 data/pointsLedger.ts。
 */
import { db } from "./db";
import { getRepository } from "./repositoryProvider";
import { taskRepository } from "./taskRepository";
import { loadPointsLedger, loadPresetResult, savePresetResult, updatePointsLedger, type PresetMatch, type PresetResult } from "./pointsLedger";
import type { Task } from "../types/task";
import { getWeekStartKey, todayKey, toLocalDateKey } from "../utils/date";
import { isWeekPlanTask } from "../utils/taskGrouping";
import {
  activeBonuses, buildWeekSnapshot, computePointsSummary, DEFAULT_PRACTICE_EXTRA_SCORES, DEFAULT_PRACTICE_POINTS, formatMoreToDo, isEarlyCompleted, isSettleTime,
  matchPracticePresets, moreToDoToday, POINTS_START_WEEK, practiceDisplayName, practiceSettingsOf, practiceShortName, practiceVerb, PRACTICE_PRESETS,
  scorePracticeWeek, weeksNeedingSnapshot, type PointsLedger, type PointsSummary,
} from "../utils/points";

export interface PointsContext { tasks: Task[]; ledger: PointsLedger; summary: PointsSummary }

export async function loadPointsContext(today = todayKey()): Promise<PointsContext> {
  const [tasks, ledger] = await Promise.all([db.tasks.toArray(), loadPointsLedger()]);
  return { tasks, ledger, summary: computePointsSummary(tasks, ledger, today) };
}

// 结算和预设都要等云端数据拉下来以后再做：没登录的设备本地是空的，拿空数据结算会写出一份空快照
let dataReady = false;
export const markPointsDataReady = () => { dataReady = true; };

/**
 * 补上该结算、还没结算的周的快照：已经过完的周，以及周日晚上 8 点以后的这一周；那周没打开过应用的，下次打开时补。
 * 快照固定那周的零花钱（练习 + 家长奖励，不低于 0），记账页的"待转账"金额就取它（docs/TASK_10_ledger.md）。
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
    missing.forEach((week) => { if (!snapshots[week]) snapshots[week] = buildWeekSnapshot(context.tasks, week, settledAt, bonusOf(week)); });
    return { ...current, snapshots };
  });
  return true;
}

/**
 * 按显示名给现有每周练习套分值预设（docs/TASK_09_points.md §3）。只套一次，结果记在 app_settings，跨设备只做一次。
 * - 没设过分值的，或者还是默认值（1 分、多做计分）的 → 套预设。第一版没匹配上时，新建 / 编辑保存会把默认 1 分
 *   明确写进任务，所以"等于默认值"也当作没设过。
 * - 家长手动设成别的值的 → 不覆盖（记为 kept）。
 * - 同时命中两项以上的不猜，列在 ambiguousTasks。
 * 返回这次（或以前那次）的结果。
 */
export async function applyPracticePresetsOnce(): Promise<PresetResult | null> {
  if (!dataReady) return null;
  const existing = await loadPresetResult();
  if (existing) return existing;
  const tasks = (await db.tasks.toArray()).filter((task) => task.timeType === "weeklyTimes" && !task.deletedAt && task.status !== "cancelled" && task.mainCategory !== "readingPlan"
    && (!task.endDate || task.endDate >= POINTS_START_WEEK));
  const matched: PresetMatch[] = [];
  const unmatchedTasks: string[] = [];
  const ambiguousTasks: string[] = [];
  for (const task of tasks) {
    const name = practiceDisplayName(task);
    const hits = matchPracticePresets(task);
    if (hits.length === 0) { unmatchedTasks.push(name); continue; }
    if (hits.length > 1) { ambiguousTasks.push(name); continue; }
    const preset = hits[0];
    const pointsDefault = task.practicePoints === undefined || task.practicePoints === DEFAULT_PRACTICE_POINTS;
    const extraDefault = task.practiceExtraScores === undefined || task.practiceExtraScores === DEFAULT_PRACTICE_EXTRA_SCORES;
    const same = task.practicePoints === preset.points && task.practiceExtraScores === preset.extraScores;
    let action: PresetMatch["action"] = same ? "same" : "kept";
    if (!same && pointsDefault && extraDefault) {
      await getRepository().update(task.id, { practicePoints: preset.points, practiceExtraScores: preset.extraScores });
      action = "applied";
    }
    const final = action === "kept" ? practiceSettingsOf(task) : { points: preset.points, extraScores: preset.extraScores };
    matched.push({ id: task.id, title: name, preset: preset.title, points: final.points, extraScores: final.extraScores, action });
  }
  const hitPresets = new Set(matched.map((item) => item.preset));
  const result: PresetResult = {
    appliedAt: new Date().toISOString(),
    matched,
    unmatchedPresets: PRACTICE_PRESETS.filter((preset) => !hitPresets.has(preset.title)).map((preset) => preset.title),
    unmatchedTasks,
    ambiguousTasks,
  };
  await savePresetResult(result);
  return result;
}

// ── 庆祝 ─────────────────────────────────────────────────────────────────

/** 中档庆祝：少量散花 + 一句提示，点一下消失（"攒到一朵小红花"的大档已随小红花取消） */
export interface Celebration { id: string; title: string; detail?: string }

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
 * 每周练习当天记了一次之后：某项本周刚达标 → 中档庆祝"钢琴本周练够了！达标奖励 +2。本周已挣 N 元"。补记（过去日期）不调用。
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
  return [{ id: key, title: `${name}本周${practiceVerb(name)}够了！`, detail: `达标奖励 +2。本周已挣 ${after.summary.weekAllowance} 元` }];
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
    result.push({ id: `early:${task.id}`, title: "提前完成了！", detail: "拿给妈妈检查，通过了有奖励" });
  }
  const school = await schoolHomeworkState(today);
  if (school.allDone && school.ids.includes(taskId)) {
    const more = await moreToDoText(today);
    result.push({ id: `school:${today}`, title: "哇，全完成了！", detail: more ? `你还可以再做：${more}` : undefined });
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
