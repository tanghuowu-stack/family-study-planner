/**
 * 积分数据层（2026-11-24）：家长奖励加减与撤回、提前完成待处理、每周快照写入（只固定分值和目标）、待兑现、
 * 上线时按标题套分值预设（只套一次、匹配不到的列出来）、庆祝只弹一次。本地模式（localStorage + fake-indexeddb）。
 * 时间固定 2026-11-25（周三）Asia/Shanghai。
 */
declare const process: { env: Record<string, string | undefined> };
process.env.TZ = "Asia/Shanghai";
const memStore = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => void memStore.set(k, String(v)),
  removeItem: (k: string) => void memStore.delete(k),
  clear: () => memStore.clear(),
};
import "fake-indexeddb/auto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../lib/supabase", () => ({ supabaseConfigured: false, supabase: null }));

import { db } from "../db";
import { taskRepository } from "../taskRepository";
import type { Task, TaskDraft } from "../../types/task";
import {
  addBonus, HOMEWORK_DONE_BAND, homeworkCelebrations, loadPointsContext, markPointsDataReady, practiceCelebrations,
  revokeBonus, settlePendingWeeks,
} from "../pointsService";
import { loadPointsLedger } from "../pointsLedger";

const practice = (title: string, overrides: Partial<Task> = {}): TaskDraft => ({
  title, mainCategory: "interestClass", subCategory: "pianoPractice", timeType: "weeklyTimes", startDate: "2026-11-02",
  weeklyQuota: { enabled: true, targetCount: 3, unit: "次", isWeeklyRecurring: true, allowAutoDistribute: false, allowRollover: false },
  status: "todo", rolloverMode: "keepOverdue", allowRollover: false, childVisible: true, ...overrides,
} as TaskDraft);

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-25T10:00:00+08:00")); markPointsDataReady(); });
afterAll(() => { vi.useRealTimers(); });
beforeEach(async () => {
  memStore.clear();
  await Promise.all([db.tasks.clear(), db.taskOccurrenceStatuses.clear(), db.activityLogs.clear()]);
});

describe("家长奖励", () => {
  it("1. 加分、减分都要写原因；撤回后不再计入，记录仍保留", async () => {
    await expect(addBonus(2, "  ")).rejects.toThrow("原因");
    await addBonus(3, "主动整理书包");
    await addBonus(-1, "练琴时间不够");
    expect((await loadPointsContext()).summary.weekBonus).toBe(2);
    const ledger = await loadPointsLedger();
    await revokeBonus(ledger.bonuses.find((bonus) => bonus.points === 3)!.id);
    const after = await loadPointsContext();
    expect(after.summary.weekBonus).toBe(-1);
    expect(after.summary.weekBonuses).toHaveLength(2);
  });

  it("2. 提前完成的作业：每项自动 +3（2026-11-25 用户改规则），取消完成就去掉；结算快照把它算进零花钱", async () => {
    const homework = (title: string): TaskDraft => ({ title, mainCategory: "extraHomework", subCategory: "math", extraContentType: "homework", timeType: "dateRange", startDate: "2026-11-22", endDate: "2026-11-28", status: "todo", rolloverMode: "autoNextDay", allowRollover: true, childVisible: true } as TaskDraft);
    const { task: a } = await taskRepository.create(homework("奥数班作业"));
    const { task: b } = await taskRepository.create(homework("FCE作业"));
    await taskRepository.setDisplayStatus(a, "done");
    await taskRepository.setDisplayStatus(b, "done");
    let context = await loadPointsContext();
    expect(context.summary.weekEarlyItems.map((item) => [item.title, item.points]).sort()).toEqual([["FCE作业", 3], ["奥数班作业", 3]]);
    expect(context.summary.weekEarly).toBe(6);
    expect(context.summary.weekTotal).toBe(6);
    expect(context.redeemable).toBe(6);
    await taskRepository.setDisplayStatus({ ...b, status: "done" }, "todo");
    context = await loadPointsContext();
    expect(context.summary.weekEarly).toBe(3);
    expect(context.summary.weekBonus).toBe(0);
  });
});

describe("每周快照（2026-11-26 起只固定分值和目标，不再固定零花钱）", () => {
  it("3. 周日晚 8 点起拍快照；得分 = 练习分 + 家长奖励（撤回的不算）；之后加奖励，分数和待兑现都跟着变", async () => {
    await taskRepository.create(practice("钢琴练习", { practicePoints: 2, weeklyLog: { "2026-11-23": 1, "2026-11-24": 1, "2026-11-25": 1 } }));
    await addBonus(3, "主动整理书包");
    const minus = await addBonus(-1, "练琴时间不够");
    const revoked = await addBonus(5, "记错了");
    await revokeBonus(revoked.bonuses[revoked.bonuses.length - 1].id);
    expect(minus.bonuses).toHaveLength(2);
    // 周日晚上 8 点前不结算这一周，8 点起结算
    const sundayEvening = new Date("2026-11-29T19:59:00+08:00");
    expect(await settlePendingWeeks(await loadPointsContext("2026-11-29"), "2026-11-29", sundayEvening)).toBe(false);
    expect(await settlePendingWeeks(await loadPointsContext("2026-11-29"), "2026-11-29", new Date("2026-11-29T20:00:00+08:00"))).toBe(true);
    const ledger = await loadPointsLedger();
    // 钢琴 3 次 × 2 + 达标 2 = 8；奖励 +3 −1 = 2
    expect(ledger.snapshots["2026-11-23"]).toMatchObject({ total: 8, bonus: 2 });
    expect(ledger.snapshots["2026-11-23"].allowance).toBeUndefined();
    await addBonus(4, "拍快照后才加");
    const context = await loadPointsContext("2026-11-29");
    expect(context.summary.weekTotal).toBe(14);
    expect(context.redeemable).toBe(14);
  });

  it("3b. 那周扣成负分：快照照拍，待兑现是负数（不托底）", async () => {
    await addBonus(-6, "测试扣分");
    vi.setSystemTime(new Date("2026-12-01T09:00:00+08:00"));
    expect(await settlePendingWeeks(await loadPointsContext())).toBe(true);
    expect((await loadPointsLedger()).snapshots["2026-11-23"]).toMatchObject({ total: 0, bonus: -6 });
    expect((await loadPointsContext()).redeemable).toBe(-6);
    vi.setSystemTime(new Date("2026-11-25T10:00:00+08:00"));
  });
});

describe("结算、预设、庆祝", () => {
  it("4. 上一周结束后补算快照（只补一次）", async () => {
    vi.setSystemTime(new Date("2026-12-01T09:00:00+08:00")); // 下周二
    await taskRepository.create(practice("钢琴练习", { practicePoints: 2, weeklyLog: { "2026-11-23": 1, "2026-11-24": 1, "2026-11-25": 1 } }));
    const context = await loadPointsContext();
    expect(await settlePendingWeeks(context)).toBe(true);
    const ledger = await loadPointsLedger();
    expect(ledger.snapshots["2026-11-23"]).toMatchObject({ total: 8, reachedCount: 1 });
    expect(await settlePendingWeeks(await loadPointsContext())).toBe(false);
    vi.setSystemTime(new Date("2026-11-25T10:00:00+08:00"));
  });

  it("6. 某项本周达标只庆祝一次：取消再勾上不重复弹出", async () => {
    const { task } = await taskRepository.create(practice("钢琴练习", { practicePoints: 2, weeklyLog: { "2026-11-23": 1, "2026-11-24": 1 } }));
    const prior = { "2026-11-23": 1, "2026-11-24": 1 };
    await taskRepository.writeWeeklyLog(task.id, "2026-11-25", 1);
    const first = await practiceCelebrations(task.id, prior);
    expect(first.map((item) => item.title)).toEqual(["钢琴本周练够了！"]);
    expect(first[0].detail).toBe("达标奖励 +2。本周 8 分");
    await taskRepository.writeWeeklyLog(task.id, "2026-11-25", -1);
    await taskRepository.writeWeeklyLog(task.id, "2026-11-25", 1);
    expect(await practiceCelebrations(task.id, prior)).toEqual([]);
  });

  it("7. 没有小红花大档了：分数再多，达标也只弹中档，提示本周多少分", async () => {
    await addBonus(100, "测试");
    const { task } = await taskRepository.create(practice("钢琴练习", { practicePoints: 2, weeklyLog: { "2026-11-23": 1, "2026-11-24": 1 } }));
    await taskRepository.writeWeeklyLog(task.id, "2026-11-25", 1);
    const items = await practiceCelebrations(task.id, { "2026-11-23": 1, "2026-11-24": 1 });
    expect(items.map((item) => [item.title, item.detail])).toEqual([["钢琴本周练够了！", "达标奖励 +2。本周 108 分"]]);
  });

  it("8. 当天学校作业全部做完 → 卡片“今天的作业做完了，快去赚积分吧！”，飞到今日页那一条；不限次数；只看学校作业", async () => {
    const school = (title: string): TaskDraft => ({ title, mainCategory: "school", subCategory: "chinese", timeType: "singleDate", date: "2026-11-25", status: "todo", rolloverMode: "autoNextDay", allowRollover: true, childVisible: true } as TaskDraft);
    const { task: a } = await taskRepository.create(school("语文家庭作业"));
    const { task: b } = await taskRepository.create(school("数学家庭作业"));
    await taskRepository.create({ ...school("带水杯"), mainCategory: "temporary", subCategory: "other" } as TaskDraft);
    await taskRepository.create(practice("钢琴练习", { practicePoints: 2 }));
    await taskRepository.setDisplayStatus(a, "done");
    expect(await homeworkCelebrations(a.id, false)).toEqual([]);
    await taskRepository.setDisplayStatus(b, "done");
    const items = await homeworkCelebrations(b.id, false);
    expect(items.map((item) => [item.title, item.detail, item.flyTo])).toEqual([["今天的作业做完了，快去赚积分吧！", undefined, HOMEWORK_DONE_BAND]]);
    // 取消再勾上也再庆祝一次（2026-11-24 用户：做完了都要有庆祝）
    expect((await homeworkCelebrations(b.id, false)).map((item) => item.title)).toEqual(["今天的作业做完了，快去赚积分吧！"]);
    // 已经是完成状态再触发（wasDone）不庆祝
    expect(await homeworkCelebrations(b.id, true)).toEqual([]);
  });

  it("9. 练习都做过了：作业做完的卡片不写“快去赚积分”", async () => {
    const { task } = await taskRepository.create({ title: "语文家庭作业", mainCategory: "school", subCategory: "chinese", timeType: "singleDate", date: "2026-11-25", status: "todo", rolloverMode: "autoNextDay", allowRollover: true, childVisible: true } as TaskDraft);
    await taskRepository.setDisplayStatus(task, "done");
    expect((await homeworkCelebrations(task.id, false)).map((item) => item.title)).toEqual(["今天的作业都做完了！"]);
  });

  it("10. 本周课外作业：勾一小项 → mini 散花；整项做完（截止日之前）→ 提前完成卡片；不限次数", async () => {
    const { task } = await taskRepository.create({
      title: "FCE家庭作业", mainCategory: "extraHomework", subCategory: "english", timeType: "dateRange", startDate: "2026-11-23", endDate: "2026-11-29",
      status: "todo", rolloverMode: "keepOverdue", allowRollover: false, childVisible: true,
      checklistItems: [{ id: "i1", title: "FCE作文一篇", done: false }, { id: "i2", title: "背诵上周作文", done: false }],
    } as TaskDraft);
    await taskRepository.toggleChecklistItem(task.id, "i1", undefined, { done: true });
    const first = await homeworkCelebrations(task.id, false, "2026-11-25", true);
    expect(first.map((item) => [item.kind, item.title])).toEqual([["mini", "做完了"]]);
    await taskRepository.toggleChecklistItem(task.id, "i2", undefined, { done: true });
    const done = await homeworkCelebrations(task.id, false, "2026-11-25", true);
    expect(done.map((item) => [item.kind, item.title, item.detail])).toEqual([[undefined, "提前完成，加 3 分！", "截止日之前做完的课外作业，每项自动加 3 分"]]);
    await taskRepository.toggleChecklistItem(task.id, "i2", undefined, { done: false });
    await taskRepository.toggleChecklistItem(task.id, "i2", undefined, { done: true });
    expect((await homeworkCelebrations(task.id, false, "2026-11-25", true)).map((item) => item.title)).toEqual(["提前完成，加 3 分！"]);
  });
});
