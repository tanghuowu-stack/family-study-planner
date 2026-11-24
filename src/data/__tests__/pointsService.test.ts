/**
 * 积分数据层（2026-11-24）：家长奖励加减与撤回、提前完成待处理、每周结算快照写入（1 分 = 1 元的零花钱）、
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
  addBonus, applyPracticePresetsOnce, homeworkCelebrations, loadPointsContext, markPointsDataReady, practiceCelebrations,
  revokeBonus, settlePendingWeeks, skipEarly,
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

  it("2. 提前完成的作业：给分记为家长奖励、处理后不再待处理；选不给也不再待处理；作业本身不自动加分", async () => {
    const homework = (title: string): TaskDraft => ({ title, mainCategory: "extraHomework", subCategory: "math", extraContentType: "homework", timeType: "dateRange", startDate: "2026-11-22", endDate: "2026-11-28", status: "todo", rolloverMode: "autoNextDay", allowRollover: true, childVisible: true } as TaskDraft);
    const { task: a } = await taskRepository.create(homework("奥数班作业"));
    const { task: b } = await taskRepository.create(homework("FCE作业"));
    await taskRepository.setDisplayStatus(a, "done");
    await taskRepository.setDisplayStatus(b, "done");
    let context = await loadPointsContext();
    expect(context.summary.pendingEarly.map((item) => item.title).sort()).toEqual(["FCE作业", "奥数班作业"]);
    expect(context.summary.weekTotal).toBe(0);
    await addBonus(2, "提前完成：奥数班作业", a.id);
    await skipEarly(b.id);
    context = await loadPointsContext();
    expect(context.summary.pendingEarly).toEqual([]);
    expect(context.summary.weekBonus).toBe(2);
  });
});

describe("零花钱结算（1 分 = 1 元）", () => {
  it("3. 结算时固定那周的零花钱 = 练习分 + 家长奖励（撤回的不算）", async () => {
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
    // 钢琴 3 次 × 2 + 达标 2 = 8；奖励 +3 −1 = 2 → 10 元
    expect(ledger.snapshots["2026-11-23"]).toMatchObject({ total: 8, bonus: 2, allowance: 10 });
    // 结算以后再加奖励：分数显示跟着变，已结算的零花钱不变
    await addBonus(4, "结算后才加");
    const context = await loadPointsContext("2026-11-29");
    expect(context.summary.weekTotal).toBe(14);
    expect(context.summary.history[0].allowance).toBe(10);
  });

  it("3b. 那周扣成负分：零花钱是 0", async () => {
    await addBonus(-6, "测试扣分");
    vi.setSystemTime(new Date("2026-12-01T09:00:00+08:00"));
    expect(await settlePendingWeeks(await loadPointsContext())).toBe(true);
    expect((await loadPointsLedger()).snapshots["2026-11-23"]).toMatchObject({ total: 0, bonus: -6, allowance: 0 });
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
    expect(ledger.snapshots["2026-11-23"]).toMatchObject({ total: 8, reachedCount: 1, allowance: 8 });
    expect(await settlePendingWeeks(await loadPointsContext())).toBe(false);
    vi.setSystemTime(new Date("2026-11-25T10:00:00+08:00"));
  });

  it("5. 按显示名套预设：空标题钢琴、带页码的小白欧都能套上；还是默认值的覆盖，家长手动设过别的不覆盖；匹配不到的列出来；只套一次", async () => {
    const { task: piano } = await taskRepository.create(practice("")); // 兴趣班·钢琴练习，标题留空
    const { task: xbo } = await taskRepository.create(practice("小白欧22页-23页", { subCategory: "otherInterest", practicePoints: 1, practiceExtraScores: true, weeklyQuota: { enabled: true, targetCount: 2, unit: "页", isWeeklyRecurring: true, allowAutoDistribute: false, allowRollover: false } }));
    const { task: raz } = await taskRepository.create(practice("RAZ 阅读", { weeklyQuota: { enabled: true, targetCount: 5, unit: "本", isWeeklyRecurring: true, allowAutoDistribute: false, allowRollover: false } }));
    const { task: manual } = await taskRepository.create(practice("FCE阅读", { practicePoints: 5, practiceExtraScores: false }));
    const { task: poem } = await taskRepository.create(practice("我爱背诗", { practicePoints: 1, practiceExtraScores: true }));
    await taskRepository.create(practice("跳绳"));
    await taskRepository.create(practice("FCE阅读和听力"));
    const result = await applyPracticePresetsOnce();
    expect(result?.matched.map((item) => [item.title, item.preset, item.points, item.extraScores, item.action]).sort()).toEqual([
      ["FCE阅读", "FCE阅读", 5, false, "kept"],
      ["RAZ 阅读", "RAZ阅读", 1, false, "applied"],
      ["小白欧22页-23页", "小白欧", 2, true, "applied"],
      ["我爱背诗", "我爱背诗", 1, true, "same"],
      ["钢琴练习", "钢琴练习", 2, true, "applied"],
    ].sort());
    expect(result?.unmatchedTasks).toEqual(["跳绳"]);
    expect(result?.ambiguousTasks).toEqual(["FCE阅读和听力"]);
    expect(result?.unmatchedPresets.sort()).toEqual(["FCE听力", "FCE语用", "英语单词听写"].sort());
    expect(await taskRepository.getTask(piano.id)).toMatchObject({ practicePoints: 2, practiceExtraScores: true });
    expect(await taskRepository.getTask(xbo.id)).toMatchObject({ practicePoints: 2, practiceExtraScores: true });
    expect(await taskRepository.getTask(raz.id)).toMatchObject({ practicePoints: 1, practiceExtraScores: false });
    expect(await taskRepository.getTask(manual.id)).toMatchObject({ practicePoints: 5, practiceExtraScores: false });
    expect(await taskRepository.getTask(poem.id)).toMatchObject({ practicePoints: 1, practiceExtraScores: true });
    await taskRepository.update(piano.id, { practicePoints: 1 });
    await applyPracticePresetsOnce();
    expect((await taskRepository.getTask(piano.id))?.practicePoints).toBe(1);
  });

  it("5b. 修好匹配后本周已打的勾按正确分值重算：钢琴 3 次、小白欧 3 页", async () => {
    const piano = await taskRepository.create(practice("", { practicePoints: 1, practiceExtraScores: true, weeklyQuota: { enabled: true, targetCount: 4, unit: "次", isWeeklyRecurring: true, allowAutoDistribute: false, allowRollover: false }, weeklyLog: { "2026-11-23": 1, "2026-11-24": 1, "2026-11-25": 1 } }));
    await taskRepository.create(practice("小白欧22页-23页", { subCategory: "otherInterest", weeklyQuota: { enabled: true, targetCount: 2, unit: "页", isWeeklyRecurring: true, allowAutoDistribute: false, allowRollover: false }, weeklyLog: { "2026-11-24": 3 } }));
    const before = await loadPointsContext();
    // 修复前：都按默认 1 分 → 钢琴 3，小白欧 2 + 达标 2 + 多做 1 = 5
    expect(before.summary.weekPractice).toBe(8);
    await applyPracticePresetsOnce();
    const after = await loadPointsContext();
    // 修复后：钢琴 3×2 = 6；小白欧 2×2 + 达标 2 + 多做 1×2 = 8
    expect(after.summary.weekScores.map((item) => [item.title, item.total]).sort()).toEqual([["小白欧22页-23页", 8], ["钢琴练习", 6]]);
    expect(after.summary.weekPractice).toBe(14);
    expect(piano.task.id).toBeTruthy();
  });

  it("6. 某项本周达标只庆祝一次：取消再勾上不重复弹出", async () => {
    const { task } = await taskRepository.create(practice("钢琴练习", { practicePoints: 2, weeklyLog: { "2026-11-23": 1, "2026-11-24": 1 } }));
    const prior = { "2026-11-23": 1, "2026-11-24": 1 };
    await taskRepository.writeWeeklyLog(task.id, "2026-11-25", 1);
    const first = await practiceCelebrations(task.id, prior);
    expect(first.map((item) => item.title)).toEqual(["钢琴本周练够了！"]);
    expect(first[0].detail).toBe("达标奖励 +2。本周已挣 8 元");
    await taskRepository.writeWeeklyLog(task.id, "2026-11-25", -1);
    await taskRepository.writeWeeklyLog(task.id, "2026-11-25", 1);
    expect(await practiceCelebrations(task.id, prior)).toEqual([]);
  });

  it("7. 没有小红花大档了：分数再多，达标也只弹中档，提示本周已挣多少元", async () => {
    await addBonus(100, "测试");
    const { task } = await taskRepository.create(practice("钢琴练习", { practicePoints: 2, weeklyLog: { "2026-11-23": 1, "2026-11-24": 1 } }));
    await taskRepository.writeWeeklyLog(task.id, "2026-11-25", 1);
    const items = await practiceCelebrations(task.id, { "2026-11-23": 1, "2026-11-24": 1 });
    expect(items.map((item) => [item.title, item.detail])).toEqual([["钢琴本周练够了！", "达标奖励 +2。本周已挣 108 元"]]);
  });

  it("8. 当天学校作业全部做完 → 中档，不带“还可以再做”；只看学校作业", async () => {
    const school = (title: string): TaskDraft => ({ title, mainCategory: "school", subCategory: "chinese", timeType: "singleDate", date: "2026-11-25", status: "todo", rolloverMode: "autoNextDay", allowRollover: true, childVisible: true } as TaskDraft);
    const { task: a } = await taskRepository.create(school("语文家庭作业"));
    const { task: b } = await taskRepository.create(school("数学家庭作业"));
    await taskRepository.create({ ...school("带水杯"), mainCategory: "temporary", subCategory: "other" } as TaskDraft);
    await taskRepository.create(practice("钢琴练习", { practicePoints: 2 }));
    await taskRepository.setDisplayStatus(a, "done");
    expect(await homeworkCelebrations(a.id, false)).toEqual([]);
    await taskRepository.setDisplayStatus(b, "done");
    const items = await homeworkCelebrations(b.id, false);
    expect(items.map((item) => [item.title, item.detail])).toEqual([["哇，全完成了！", undefined]]);
    expect(await homeworkCelebrations(b.id, false)).toEqual([]);
  });
});
