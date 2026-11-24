/**
 * 积分数据层（2026-11-24）：家长奖励加减与撤回、提前完成待处理、愿望确认与兑换扣除、每周结算快照写入、
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
  addBonus, addWish, applyPracticePresetsOnce, confirmWish, homeworkCelebrations, loadPointsContext, markPointsDataReady, practiceCelebrations,
  redeemWish, revokeBonus, settlePendingWeeks, skipEarly,
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

describe("愿望与兑换", () => {
  it("3. 写愿望 → 待确认；家长确认并设定 2 朵；小红花不够不能兑换，够了兑换后扣除", async () => {
    await addWish("周末去游乐场");
    let context = await loadPointsContext();
    const wish = context.summary.wish!;
    expect(wish).toMatchObject({ text: "周末去游乐场", status: "pending", cost: 1 });
    await confirmWish(wish.id, 2);
    await expect(redeemWish(wish.id)).rejects.toThrow("不够");
    await addBonus(230, "测试：攒够两朵");
    context = await loadPointsContext();
    expect(context.summary.flowers).toBe(2);
    await redeemWish(wish.id);
    context = await loadPointsContext();
    expect(context.summary).toMatchObject({ flowersEarned: 2, flowersRedeemed: 2, flowers: 0 });
    expect(context.summary.wish).toBeUndefined();
    await expect(redeemWish(wish.id)).rejects.toThrow();
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

  it("5. 按标题套预设：匹配上的写进任务，手动设过的不覆盖，匹配不到的列出来；只套一次", async () => {
    const { task: piano } = await taskRepository.create(practice("钢琴练习"));
    const { task: raz } = await taskRepository.create(practice("RAZ 阅读", { weeklyQuota: { enabled: true, targetCount: 5, unit: "本", isWeeklyRecurring: true, allowAutoDistribute: false, allowRollover: false } }));
    const { task: manual } = await taskRepository.create(practice("FCE阅读", { practicePoints: 5, practiceExtraScores: false }));
    await taskRepository.create(practice("跳绳"));
    const result = await applyPracticePresetsOnce();
    expect(result?.matched.map((item) => item.title).sort()).toEqual(["FCE阅读", "RAZ 阅读", "钢琴练习"]);
    expect(result?.unmatchedTasks).toEqual(["跳绳"]);
    expect(result?.unmatchedPresets.sort()).toEqual(["FCE听力", "FCE语用", "小白欧", "我爱背诗", "英语单词听写"].sort());
    expect(await taskRepository.getTask(piano.id)).toMatchObject({ practicePoints: 2, practiceExtraScores: true });
    expect(await taskRepository.getTask(raz.id)).toMatchObject({ practicePoints: 1, practiceExtraScores: false });
    expect(await taskRepository.getTask(manual.id)).toMatchObject({ practicePoints: 5, practiceExtraScores: false });
    await taskRepository.update(piano.id, { practicePoints: 3 });
    await applyPracticePresetsOnce();
    expect((await taskRepository.getTask(piano.id))?.practicePoints).toBe(3);
  });

  it("6. 某项本周达标只庆祝一次：取消再勾上不重复弹出", async () => {
    const { task } = await taskRepository.create(practice("钢琴练习", { practicePoints: 2, weeklyLog: { "2026-11-23": 1, "2026-11-24": 1 } }));
    const prior = { "2026-11-23": 1, "2026-11-24": 1 };
    await taskRepository.writeWeeklyLog(task.id, "2026-11-25", 1);
    const first = await practiceCelebrations(task.id, prior);
    expect(first.map((item) => item.title)).toEqual(["钢琴练习本周练够了！"]);
    expect(first[0].detail).toBe("达标奖励 +2。再得 92 分就能换下一朵小红花");
    await taskRepository.writeWeeklyLog(task.id, "2026-11-25", -1);
    await taskRepository.writeWeeklyLog(task.id, "2026-11-25", 1);
    expect(await practiceCelebrations(task.id, prior)).toEqual([]);
  });

  it("7. 累计刚跨过 100 → 大档（攒到一朵小红花）", async () => {
    await addBonus(95, "测试");
    const { task } = await taskRepository.create(practice("钢琴练习", { practicePoints: 2, weeklyQuota: { enabled: true, targetCount: 5, unit: "次", isWeeklyRecurring: true, allowAutoDistribute: false, allowRollover: false }, weeklyLog: { "2026-11-23": 1, "2026-11-24": 1 } }));
    await taskRepository.writeWeeklyLog(task.id, "2026-11-25", 1);
    const items = await practiceCelebrations(task.id, { "2026-11-23": 1, "2026-11-24": 1 });
    expect(items.map((item) => [item.level, item.title, item.detail])).toEqual([["big", "攒到一朵小红花！", "现在有 1 朵"]]);
  });

  it("8. 当天学校作业全部做完 → 中档，带“还可以再做”；只看学校作业", async () => {
    const school = (title: string): TaskDraft => ({ title, mainCategory: "school", subCategory: "chinese", timeType: "singleDate", date: "2026-11-25", status: "todo", rolloverMode: "autoNextDay", allowRollover: true, childVisible: true } as TaskDraft);
    const { task: a } = await taskRepository.create(school("语文家庭作业"));
    const { task: b } = await taskRepository.create(school("数学家庭作业"));
    await taskRepository.create({ ...school("带水杯"), mainCategory: "temporary", subCategory: "other" } as TaskDraft);
    await taskRepository.create(practice("钢琴练习", { practicePoints: 2 }));
    await taskRepository.setDisplayStatus(a, "done");
    expect(await homeworkCelebrations(a.id, false)).toEqual([]);
    await taskRepository.setDisplayStatus(b, "done");
    const items = await homeworkCelebrations(b.id, false);
    expect(items.map((item) => [item.title, item.detail])).toEqual([["哇，全完成了！", "你还可以再做：钢琴练习 +2"]]);
    expect(await homeworkCelebrations(b.id, false)).toEqual([]);
  });
});
