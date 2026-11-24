/**
 * 每周练习积分 + 小红花 + 愿望（2026-11-24）：纯函数规则（utils/points.ts）与账本合并（data/pointsLedger.ts）。
 * 积分第一周 = 2026-11-23（周一）。时区按 Asia/Shanghai（完成时间换算本地日期）。
 */
declare const process: { env: Record<string, string | undefined> };
process.env.TZ = "Asia/Shanghai";
import { describe, expect, it } from "vitest";
import type { Task, WeeklyQuota } from "../../types/task";
import {
  buildWeekSnapshot, computePointsSummary, emptyLedger, findPracticePreset, formatMoreToDo, gainForLog, isEarlyCompleted, moreToDoToday,
  pendingEarlyItems, scorePracticeWeek, weeksNeedingSnapshot, type BonusEntry, type PointsLedger, type Wish,
} from "../points";
import { mergeLedgers } from "../../data/pointsLedger";

const W1 = "2026-11-23"; // 积分第一周（周一）
const W0 = "2026-11-16"; // 积分开始之前的一周
const W2 = "2026-11-30";
const day = (week: string, offset: number) => {
  const date = new Date(`${week}T00:00:00`);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const quota = (targetCount: number, unit: WeeklyQuota["unit"]): WeeklyQuota => ({ enabled: true, targetCount, unit, isWeeklyRecurring: true, allowAutoDistribute: false, allowRollover: false });

function practice(id: string, title: string, target: number, unit: WeeklyQuota["unit"], log: Record<string, number>, extra: Partial<Task> = {}): Task {
  return {
    id, title, mainCategory: "interestClass", subCategory: "pianoPractice", timeType: "weeklyTimes", startDate: "2026-11-17",
    weeklyQuota: quota(target, unit), weeklyLog: log, status: "todo", rolloverMode: "skipIfMissed", allowRollover: false, childVisible: true,
    createdAt: "2026-11-17T00:00:00.000Z", updatedAt: "2026-11-17T00:00:00.000Z", ...extra,
  };
}

const bonus = (id: string, date: string, points: number, extra: Partial<BonusEntry> = {}): BonusEntry => ({ id, date, points, reason: "测试", createdAt: `${date}T10:00:00.000Z`, updatedAt: `${date}T10:00:00.000Z`, ...extra });
const ledgerWith = (changes: Partial<PointsLedger>): PointsLedger => ({ ...emptyLedger(), ...changes });

describe("一项练习一周的得分", () => {
  it("单位是次的每天最多算一次（钢琴一天记 2 次也只算 1 次）", () => {
    const piano = practice("p", "钢琴练习", 4, "次", { [day(W1, 0)]: 2, [day(W1, 1)]: 1 }, { practicePoints: 2 });
    const score = scorePracticeWeek(piano, W1);
    expect(score.count).toBe(2);
    expect(score.total).toBe(4);
  });

  it("按本 / 页记的不封顶：一天读 3 本就算 3 本", () => {
    const raz = practice("r", "RAZ阅读", 5, "本", { [day(W1, 0)]: 3 }, { practiceExtraScores: false });
    expect(scorePracticeWeek(raz, W1).count).toBe(3);
  });

  it("达到目标再 +2，不论哪天达标", () => {
    const piano = practice("p", "钢琴练习", 3, "次", { [day(W1, 0)]: 1, [day(W1, 3)]: 1, [day(W1, 6)]: 1 }, { practicePoints: 2 });
    const score = scorePracticeWeek(piano, W1);
    expect(score).toMatchObject({ reached: true, completionPoints: 6, reachBonus: 2, extraPoints: 0, total: 8 });
  });

  it("多做的部分计分：超过目标的照样按分值得分", () => {
    const poem = practice("s", "我爱背诗", 3, "次", Object.fromEntries([0, 1, 2, 3, 4].map((i) => [day(W1, i), 1])), { practicePoints: 1, practiceExtraScores: true });
    expect(scorePracticeWeek(poem, W1)).toMatchObject({ count: 5, completionPoints: 3, reachBonus: 2, extraCount: 2, extraPoints: 2, total: 7 });
  });

  it("多做的部分不计分：超过目标的不得分，只记多了几本", () => {
    const raz = practice("r", "RAZ阅读", 5, "本", { [day(W1, 0)]: 4, [day(W1, 2)]: 4 }, { practicePoints: 1, practiceExtraScores: false });
    expect(scorePracticeWeek(raz, W1)).toMatchObject({ count: 8, completionPoints: 5, reachBonus: 2, extraCount: 3, extraPoints: 0, total: 7 });
  });

  it("没达到目标：做了多少得多少，不扣分", () => {
    const fce = practice("f", "FCE阅读", 4, "篇", { [day(W1, 1)]: 1 }, { practicePoints: 2 });
    expect(scorePracticeWeek(fce, W1)).toMatchObject({ reached: false, completionPoints: 2, reachBonus: 0, total: 2 });
    expect(scorePracticeWeek(practice("z", "听写", 5, "次", {}), W1).total).toBe(0);
  });

  it("没设过分值的按每次 1 分、多做计分", () => {
    expect(scorePracticeWeek(practice("n", "新练习", 1, "次", { [day(W1, 0)]: 1, [day(W1, 1)]: 1 }), W1)).toMatchObject({ points: 1, extraScores: true, total: 1 + 2 + 1 });
  });

  it("只看本周的记录，上周多做的不结转", () => {
    const piano = practice("p", "钢琴练习", 2, "次", { [day(W1, 5)]: 1, [day(W1, 6)]: 1, [day(W2, 0)]: 1 });
    expect(scorePracticeWeek(piano, W2)).toMatchObject({ count: 1, reached: false });
  });
});

describe("累计、小红花、家长奖励、兑换", () => {
  it("积分开始那周之前的记录不计分", () => {
    const piano = practice("p", "钢琴练习", 1, "次", { [day(W0, 0)]: 1, [day(W0, 1)]: 1 }, { practicePoints: 2 });
    const summary = computePointsSummary([piano], emptyLedger(), day(W1, 1));
    expect(summary.cumulative).toBe(0);
    expect(summary.history.map((week) => week.weekStart)).toEqual([W1]);
  });

  it("今天还在积分开始之前：什么都不算", () => {
    const summary = computePointsSummary([practice("p", "钢琴练习", 1, "次", { [day(W0, 0)]: 1 })], emptyLedger(), day(W0, 3));
    expect(summary.history).toEqual([]);
    expect(summary.cumulative).toBe(0);
  });

  it("家长奖励可加可减，撤回的不算", () => {
    const ledger = ledgerWith({ bonuses: [bonus("a", day(W1, 1), 3), bonus("b", day(W1, 2), -1), bonus("c", day(W1, 2), 5, { revokedAt: "2026-11-25T00:00:00.000Z" })] });
    const summary = computePointsSummary([], ledger, day(W1, 3));
    expect(summary.weekBonus).toBe(2);
    expect(summary.weekTotal).toBe(2);
    expect(summary.weekBonuses).toHaveLength(3); // 列表里仍显示被撤回的那笔（划掉）
  });

  it("分数跨周累积；每满 100 分一朵小红花", () => {
    // 第一周：60 分家长奖励；第二周：钢琴 4 次 ×2 + 达标 2 = 10 分，再加 35 分奖励 → 累计 105
    const piano = practice("p", "钢琴练习", 4, "次", Object.fromEntries([0, 1, 2, 3].map((i) => [day(W2, i), 1])), { practicePoints: 2 });
    const ledger = ledgerWith({ bonuses: [bonus("a", day(W1, 2), 60), bonus("b", day(W2, 4), 35)] });
    const summary = computePointsSummary([piano], ledger, day(W2, 5));
    expect(summary.history.map((week) => [week.weekStart, week.total, week.cumulativeAfter, week.flowersEarned])).toEqual([[W1, 60, 60, 0], [W2, 45, 105, 1]]);
    expect(summary).toMatchObject({ weekTotal: 45, cumulative: 105, flowersEarned: 1, flowers: 1, progress: 5, toNextFlower: 95 });
  });

  it("兑换扣除小红花：数量 = 累计得到的 − 已兑换的", () => {
    const wish = (id: string, status: Wish["status"], cost: number): Wish => ({ id, text: id, status, cost, createdAt: "2026-11-24T00:00:00.000Z", updatedAt: "2026-11-24T00:00:00.000Z" });
    const ledger = ledgerWith({ bonuses: [bonus("a", day(W1, 1), 250)], wishes: [wish("乐高", "redeemed", 2), wish("游乐场", "confirmed", 3)] });
    const summary = computePointsSummary([], ledger, day(W1, 2));
    expect(summary).toMatchObject({ flowersEarned: 2, flowersRedeemed: 2, flowers: 0 });
    expect(summary.wish?.text).toBe("游乐场");
  });

  it("减分让累计回落时小红花不会变成负数", () => {
    const summary = computePointsSummary([], ledgerWith({ bonuses: [bonus("a", day(W1, 1), -5)] }), day(W1, 2));
    expect(summary).toMatchObject({ cumulative: -5, flowers: 0, progress: 0 });
  });
});

describe("每周结算快照", () => {
  const piano = (log: Record<string, number>, extra: Partial<Task> = {}) => practice("p", "钢琴练习", 3, "次", log, { practicePoints: 2, ...extra });
  const w1Log = { [day(W1, 0)]: 1, [day(W1, 2)]: 1, [day(W1, 4)]: 1 };

  it("周日过完才需要结算；那周没打开过，下次打开时补算", () => {
    expect(weeksNeedingSnapshot(day(W1, 6), {})).toEqual([]);
    expect(weeksNeedingSnapshot(day(W2, 0), {})).toEqual([W1]);
    expect(weeksNeedingSnapshot(day(W2, 8), {})).toEqual([W1, W2]);
  });

  it("结算之后再改分值或目标，已结算的周不受影响；没结算的本周按新设置算", () => {
    const snapshot = buildWeekSnapshot([piano(w1Log)], W1, "2026-11-30T00:01:00.000Z");
    expect(snapshot.total).toBe(8);
    const changed = piano({ ...w1Log, [day(W2, 0)]: 1 }, { practicePoints: 5, weeklyQuota: quota(1, "次") });
    const summary = computePointsSummary([changed], ledgerWith({ snapshots: { [W1]: snapshot } }), day(W2, 0));
    expect(summary.history[0]).toMatchObject({ weekStart: W1, practice: 8, settled: true });
    expect(summary.weekPractice).toBe(5 + 2); // 本周：新设置每次 5 分、目标 1 次 → 达标
  });

  it("结算后家长撤销那周的一次打勾，分数按结算时的设置跟着扣回", () => {
    const snapshot = buildWeekSnapshot([piano(w1Log)], W1, "2026-11-30T00:01:00.000Z");
    const undone = piano({ [day(W1, 0)]: 1, [day(W1, 2)]: 1 }, { practicePoints: 5 });
    const summary = computePointsSummary([undone], ledgerWith({ snapshots: { [W1]: snapshot } }), day(W2, 1));
    expect(summary.history[0].practice).toBe(4); // 2 次 × 结算时的 2 分，没达标
  });

  it("结算后任务被删掉：那周按快照里记下的分数算", () => {
    const snapshot = buildWeekSnapshot([piano(w1Log)], W1, "2026-11-30T00:01:00.000Z");
    const deleted = piano(w1Log, { deletedAt: "2026-12-01T00:00:00.000Z" });
    expect(computePointsSummary([deleted], ledgerWith({ snapshots: { [W1]: snapshot } }), day(W2, 2)).history[0].practice).toBe(8);
  });
});

describe("本周作业提前完成", () => {
  const homework = (extra: Partial<Task>): Task => ({
    id: "h", title: "大增语文课后作业", mainCategory: "extraHomework", subCategory: "chinese", extraContentType: "homework", timeType: "dateRange",
    startDate: "2026-11-21", endDate: "2026-11-27", status: "done", completedAt: "2026-11-25T12:00:00.000Z", rolloverMode: "autoNextDay", allowRollover: true,
    childVisible: true, createdAt: "2026-11-21T00:00:00.000Z", updatedAt: "2026-11-25T12:00:00.000Z", ...extra,
  });

  it("截止日之前做完算提前完成", () => { expect(isEarlyCompleted(homework({}))).toBe(true); });
  it("截止日当天做完不算", () => { expect(isEarlyCompleted(homework({ completedAt: "2026-11-27T09:00:00.000Z" }))).toBe(false); });
  it("带小项的：小项没勾完（任务没完成）不算，全勾完（任务自动完成）才算", () => {
    const items = [{ id: "1", title: "B卷", done: true, completedDate: "2026-11-25" }, { id: "2", title: "背诵", done: false }];
    expect(isEarlyCompleted(homework({ status: "todo", completedAt: undefined, checklistItems: items }))).toBe(false);
    expect(isEarlyCompleted(homework({ checklistItems: items.map((item) => ({ ...item, done: true, completedDate: "2026-11-25" })) }))).toBe(true);
  });
  it("其他安排（旅游等）和积分开始之前做完的不算", () => {
    expect(isEarlyCompleted(homework({ mainCategory: "temporary", subCategory: "travel" }))).toBe(false);
    expect(isEarlyCompleted(homework({ completedAt: "2026-11-20T12:00:00.000Z", endDate: "2026-11-22" }))).toBe(false);
  });
  it("待处理：没处理过的才算；给了分但那笔被撤回的回到待处理；选了不给的不再出现", () => {
    const tasks = [homework({ id: "a" }), homework({ id: "b" }), homework({ id: "c" })];
    const now = "2026-11-25T13:00:00.000Z";
    const ledger = ledgerWith({
      bonuses: [bonus("x", "2026-11-25", 2, { earlyTaskId: "b", revokedAt: now })],
      earlyDecisions: { b: { decision: "award", bonusId: "x", decidedAt: now, updatedAt: now }, c: { decision: "skip", decidedAt: now, updatedAt: now } },
    });
    expect(pendingEarlyItems(tasks, ledger).map((item) => item.taskId)).toEqual(["a", "b"]);
  });
});

describe("还可以再做 / 打勾能得几分", () => {
  const today = day(W1, 2);
  it("列出今天还能做、还没达标的；差一次达标的写达标后能得的分；次的今天做过就不列", () => {
    const tasks = [
      practice("p", "钢琴练习", 4, "次", { [day(W1, 0)]: 1, [day(W1, 1)]: 1, [day(W1, 2)]: 0, [day(W1, 3)]: 0 }, { practicePoints: 2 }),
      practice("s", "我爱背诗", 2, "次", { [day(W1, 0)]: 1 }, { practicePoints: 1 }),
      practice("t", "英语单词听写", 5, "次", { [today]: 1 }),
      practice("r", "RAZ阅读", 2, "本", { [day(W1, 0)]: 2 }, { practiceExtraScores: false }),
    ];
    const more = moreToDoToday(tasks, today);
    expect(more.map((item) => [item.title, item.gain, item.reachesTarget])).toEqual([["钢琴练习", 2, false], ["我爱背诗", 3, true]]);
    expect(formatMoreToDo(more)).toBe("钢琴练习 +2  我爱背诗再背 1 次 +3");
  });
  it("打勾能得的分：达标那一下含 +2；不计分的多做为 0", () => {
    const piano = practice("p", "钢琴练习", 2, "次", { [day(W1, 0)]: 1 }, { practicePoints: 2 });
    expect(gainForLog(piano, today, 1)).toBe(4);
    const raz = practice("r", "RAZ阅读", 2, "本", { [day(W1, 0)]: 2 }, { practiceExtraScores: false });
    expect(gainForLog(raz, today, 1)).toBe(0);
  });
});

describe("预设分值按标题匹配", () => {
  it("去掉空格、不分大小写后完全相同才算", () => {
    expect(findPracticePreset("钢琴练习")?.points).toBe(2);
    expect(findPracticePreset("raz 阅读")).toMatchObject({ points: 1, extraScores: false });
    expect(findPracticePreset("钢琴")).toBeUndefined();
    expect(findPracticePreset("小白鸥")).toBeUndefined();
  });
});

describe("账本跨设备合并", () => {
  it("记录取并集，同一条取较新的；已庆祝取并集；快照保留最早结算的", () => {
    const local = ledgerWith({
      bonuses: [bonus("a", "2026-11-24", 1), bonus("b", "2026-11-24", 2, { revokedAt: "2026-11-24T12:00:00.000Z", updatedAt: "2026-11-24T12:00:00.000Z" })],
      celebrated: { "school:2026-11-24": "2026-11-24T10:00:00.000Z" },
      snapshots: { [W1]: { weekStart: W1, settledAt: "2026-11-30T08:00:00.000Z", items: [], total: 0, reachedCount: 0 } },
    });
    const remote = ledgerWith({
      bonuses: [bonus("b", "2026-11-24", 2), bonus("c", "2026-11-24", 3)],
      celebrated: { "reach:2026-11-23:p": "2026-11-24T09:00:00.000Z" },
      snapshots: { [W1]: { weekStart: W1, settledAt: "2026-11-30T07:00:00.000Z", items: [], total: 5, reachedCount: 1 } },
    });
    const merged = mergeLedgers(local, remote);
    expect(merged.bonuses.map((item) => [item.id, !!item.revokedAt]).sort()).toEqual([["a", false], ["b", true], ["c", false]]);
    expect(Object.keys(merged.celebrated).sort()).toEqual(["reach:2026-11-23:p", "school:2026-11-24"]);
    expect(merged.snapshots[W1].total).toBe(5);
  });
  it("坏数据不会让账本整体失效", () => {
    expect(mergeLedgers(null, { bonuses: [{ id: 1 }], wishes: "x" })).toEqual(emptyLedger());
  });
});
