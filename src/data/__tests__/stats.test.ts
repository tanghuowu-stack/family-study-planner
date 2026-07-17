/**
 * TASK_08 统计数据层回归测试。
 * 本地时区固定 Asia/Shanghai（UTC+8），验证午夜边界归因；
 * localStorage 用内存 shim（本地模式下 app_settings 只走 localStorage，不碰 Supabase）。
 */
declare const process: { env: Record<string, string | undefined> };
process.env.TZ = "Asia/Shanghai";
import "fake-indexeddb/auto";

const memStore = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => void memStore.set(k, String(v)),
  removeItem: (k: string) => void memStore.delete(k),
  clear: () => memStore.clear(),
};

import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { taskRepository } from "../taskRepository";
import { getStreakData, getWeekCompletionRate, getSubjectComparison, applyReviveCard, toggleRestDay } from "../statsRepository";
import { saveRestDays, saveReviveCards } from "../appSettingsRepository";
import type { Task, TaskOccurrenceStatus } from "../../types/task";

const now = "2026-07-10T04:00:00.000Z";
const makeTask = (id: string, overrides: Partial<Task> = {}): Task => ({
  id,
  title: id,
  mainCategory: "school",
  subCategory: "math",
  timeType: "singleDate",
  date: "2026-07-15",
  status: "todo",
  rolloverMode: "keepOverdue",
  allowRollover: false,
  childVisible: true,
  createdAt: now,
  updatedAt: now,
  ...overrides,
} as Task);
/** 本地日 12:00（UTC+8）的时间戳，避免测试自身踩时区边界 */
const noonOf = (d: string) => new Date(`${d}T12:00:00+08:00`).toISOString();
const doneSingle = (id: string, localDate: string, overrides: Partial<Task> = {}) =>
  makeTask(id, { enableStreak: true, date: localDate, status: "done", completedAt: noonOf(localDate), ...overrides });
const occRow = (taskId: string, date: string, status: string, completedAt?: string): TaskOccurrenceStatus => ({
  id: `${taskId}:${date}`,
  taskId,
  occurrenceDate: date,
  status: status as TaskOccurrenceStatus["status"],
  completedAt,
  createdAt: now,
  updatedAt: now,
});

beforeEach(async () => {
  memStore.clear();
  await Promise.all([db.tasks.clear(), db.taskOccurrenceStatuses.clear(), db.activityLogs.clear()]);
});

describe("getStreakData", () => {
  it("19. 跨月连续天数：6/28-7/2 连续 5 天，跨月不断", async () => {
    await db.tasks.bulkAdd(["2026-06-28", "2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02"].map((d, i) => doneSingle(`t${i}`, d)));
    const data = await getStreakData("2026-07-02");
    expect(data.currentStreak).toBe(5);
    expect(data.longestStreak).toBe(5);
    expect(data.checkinDates).toEqual(["2026-06-28", "2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02"]);
  });

  it("20. 休息日跳过不断卡：7/1 打卡、7/2 休息、7/3 打卡 → 连续 2 天", async () => {
    await db.tasks.bulkAdd([doneSingle("a", "2026-07-01"), doneSingle("b", "2026-07-03")]);
    await saveRestDays(["2026-07-02"]);
    const data = await getStreakData("2026-07-03");
    expect(data.currentStreak).toBe(2);
    expect(data.longestStreak).toBe(2);
    expect(data.restDays).toEqual(["2026-07-02"]);
  });

  it("21. UTC+8 午夜边界：completedAt 为 UTC 前一日 16:30（本地 0:30）归本地当天", async () => {
    await db.tasks.bulkAdd([
      makeTask("m1", { enableStreak: true, status: "done", completedAt: "2026-07-16T16:30:00.000Z" }),
      makeTask("rec", { enableStreak: true, timeType: "recurring", schedulePattern: "dailyRecurring", date: undefined, startDate: "2026-07-01" }),
    ]);
    await db.taskOccurrenceStatuses.add(occRow("rec", "2026-07-18", "done", "2026-07-17T16:30:00.000Z"));
    const data = await getStreakData("2026-07-18");
    expect(data.checkinDates).toContain("2026-07-17"); // 本体：UTC 07-16 → 本地 07-17
    expect(data.checkinDates).toContain("2026-07-18"); // occurrence 行：UTC 07-17 → 本地 07-18
    expect(data.currentStreak).toBe(2);
  });

  it("22. 软删任务与非 enableStreak 任务不产生打卡日", async () => {
    await db.tasks.bulkAdd([
      doneSingle("del", "2026-07-01", { deletedAt: now }),
      makeTask("noStreak", { date: "2026-07-02", status: "done", completedAt: noonOf("2026-07-02") }),
      makeTask("recDel", { enableStreak: true, timeType: "recurring", schedulePattern: "dailyRecurring", date: undefined, startDate: "2026-07-01", deletedAt: now }),
    ]);
    await db.taskOccurrenceStatuses.add(occRow("recDel", "2026-07-03", "done", noonOf("2026-07-03")));
    const data = await getStreakData("2026-07-03");
    expect(data.checkinDates).toEqual([]);
    expect(data.currentStreak).toBe(0);
    expect(data.longestStreak).toBe(0);
  });
});

describe("applyReviveCard", () => {
  it("23. 3 天内补卡成功：扣余额、记日期、连续天数接上", async () => {
    await db.tasks.bulkAdd([doneSingle("a", "2026-07-01"), doneSingle("b", "2026-07-03"), doneSingle("c", "2026-07-04")]);
    await saveReviveCards({ balance: 2, usedDates: [] });
    const cards = await applyReviveCard("2026-07-02", "2026-07-04");
    expect(cards.balance).toBe(1);
    expect(cards.usedDates).toEqual(["2026-07-02"]);
    const data = await getStreakData("2026-07-04");
    expect(data.currentStreak).toBe(4);
    expect(data.revivedDates).toEqual(["2026-07-02"]);
  });

  it("24. 超过 3 天时限拒绝，余额不足拒绝", async () => {
    await saveReviveCards({ balance: 1, usedDates: [] });
    await expect(applyReviveCard("2026-06-30", "2026-07-04")).rejects.toThrow("断卡超过 3 天");
    await saveReviveCards({ balance: 0, usedDates: [] });
    await expect(applyReviveCard("2026-07-03", "2026-07-04")).rejects.toThrow("复活卡余额不足");
  });

  it("25. 已打卡 / 休息日 / 重复补卡拒绝，不能补今天或未来", async () => {
    await db.tasks.bulkAdd([doneSingle("a", "2026-07-03")]);
    await saveReviveCards({ balance: 2, usedDates: ["2026-07-01"] });
    await expect(applyReviveCard("2026-07-03", "2026-07-04")).rejects.toThrow("该日已打卡");
    await expect(applyReviveCard("2026-07-01", "2026-07-04")).rejects.toThrow("已用复活卡补过");
    await saveRestDays(["2026-07-02"]);
    await expect(applyReviveCard("2026-07-02", "2026-07-04")).rejects.toThrow("休息日不断卡");
    await expect(applyReviveCard("2026-07-04", "2026-07-04")).rejects.toThrow("只能补今天之前");
  });
});

describe("getWeekCompletionRate（2026-07-13 周一 ~ 07-19 周日）", () => {
  it("26. occurrence 类按排期展开、cancelled 当天剔出分母", async () => {
    await db.tasks.add(makeTask("daily", { timeType: "recurring", schedulePattern: "dailyRecurring", date: undefined, startDate: "2026-07-13", endDate: "2026-07-19", recurrence: { frequency: "daily", startDate: "2026-07-13", endDate: "2026-07-19" } }));
    await db.taskOccurrenceStatuses.bulkAdd([
      occRow("daily", "2026-07-13", "done", noonOf("2026-07-13")),
      occRow("daily", "2026-07-14", "done", noonOf("2026-07-14")),
      occRow("daily", "2026-07-15", "cancelled"),
    ]);
    const rate = await getWeekCompletionRate("2026-07-15");
    expect(rate.weekStart).toBe("2026-07-13");
    expect(rate.total).toBe(6); // 7 天排期 - 1 天 cancelled
    expect(rate.done).toBe(2);
    expect(rate.rate).toBeCloseTo(2 / 6);
  });

  it("27. 非 occurrence 类按日期字段落本周计 1；本体 cancelled 与软删整体剔除", async () => {
    await db.tasks.bulkAdd([
      makeTask("s1", { date: "2026-07-14", status: "done", completedAt: noonOf("2026-07-14") }),
      makeTask("s2", { date: "2026-07-16" }),
      makeTask("range", { timeType: "dateRange", date: undefined, startDate: "2026-07-10", endDate: "2026-07-20", status: "done", completedAt: noonOf("2026-07-15") }),
      makeTask("out", { date: "2026-07-25" }),
      makeTask("cx", { date: "2026-07-15", status: "cancelled" }),
      makeTask("del", { date: "2026-07-15", deletedAt: now }),
    ]);
    const rate = await getWeekCompletionRate("2026-07-15");
    expect(rate.total).toBe(3); // s1 + s2 + range；out 不在本周，cx/del 剔除
    expect(rate.done).toBe(2);
  });

  it("28. 无应做任务时 rate 为 null 而非 0", async () => {
    const rate = await getWeekCompletionRate("2026-07-15");
    expect(rate.total).toBe(0);
    expect(rate.rate).toBeNull();
  });
});

describe("getSubjectComparison", () => {
  it("29. 按一级分类聚合，与完成率同口径", async () => {
    await db.tasks.bulkAdd([
      makeTask("sch1", { date: "2026-07-14", status: "done", completedAt: noonOf("2026-07-14") }),
      makeTask("sch2", { date: "2026-07-15" }),
      makeTask("extra", { mainCategory: "extraHomework", date: "2026-07-16", status: "done", completedAt: noonOf("2026-07-16") }),
    ]);
    const items = await getSubjectComparison("2026-07-15");
    const school = items.find((i) => i.mainCategory === "school");
    const extra = items.find((i) => i.mainCategory === "extraHomework");
    expect(school).toMatchObject({ total: 2, done: 1 });
    expect(extra).toMatchObject({ total: 1, done: 1, rate: 1 });
  });
});

describe("occurrence completedAt 写入路径 + 休息日切换", () => {
  it("30. setOccurrence 转 done 写 completedAt，退出 done 清除（R2 override 仍保留）", async () => {
    const task = await taskRepository.create({
      title: "每日打卡", mainCategory: "school", subCategory: "math", timeType: "recurring",
      schedulePattern: "dailyRecurring", startDate: "2026-07-01", status: "todo",
      rolloverMode: "keepOverdue", allowRollover: false, childVisible: true, enableStreak: true,
    } as never);
    await taskRepository.setOccurrence(task.id, "2026-07-15", "postponed", "2026-07-16", "延一天");
    await taskRepository.setOccurrence(task.id, "2026-07-15", "done");
    let occ = await db.taskOccurrenceStatuses.get(`${task.id}:2026-07-15`);
    expect(occ?.completedAt).toBeTruthy();
    expect(occ?.overrideDate).toBe("2026-07-16");
    await taskRepository.setOccurrence(task.id, "2026-07-15", "todo");
    occ = await db.taskOccurrenceStatuses.get(`${task.id}:2026-07-15`);
    expect(occ?.completedAt).toBeUndefined();
  });

  it("31. toggleRestDay 双向切换并持久化", async () => {
    expect(await toggleRestDay("2026-07-20")).toEqual(["2026-07-20"]);
    expect(await toggleRestDay("2026-07-20")).toEqual([]);
  });
});
