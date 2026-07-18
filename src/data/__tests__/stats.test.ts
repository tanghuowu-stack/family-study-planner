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
import { getStreakData, getWeekCompletionRate, getSubjectComparison, applyReviveCard, toggleRestDay, getDailyCheckItems, setDailyCheckOverride, getPerItemStreaks } from "../statsRepository";
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

  // 语义调整（2026-07-18）：打卡日从"完成归因日集合"改为"当天应做项全清"。
  // 用例改为把排期日与完成归因对齐：若 completedAt 被按 UTC 截断，会归到 07-16，
  // 07-17 的应做项就判未完成 → 漏卡，断言即失败，UTC+8 边界保护不变。
  it("21. UTC+8 午夜边界：排期 07-17 的任务在本地 0:30（UTC 前一日 16:30）完成，07-17 算打卡", async () => {
    await db.tasks.bulkAdd([
      makeTask("m1", { enableStreak: true, date: "2026-07-17", status: "done", completedAt: "2026-07-16T16:30:00.000Z" }),
      makeTask("rec", { enableStreak: true, timeType: "recurring", schedulePattern: "dailyRecurring", date: undefined, startDate: "2026-07-18", recurrence: { frequency: "daily", startDate: "2026-07-18" } }),
    ]);
    await db.taskOccurrenceStatuses.add(occRow("rec", "2026-07-18", "done", "2026-07-17T16:30:00.000Z"));
    const data = await getStreakData("2026-07-18");
    expect(data.checkinDates).toContain("2026-07-17"); // UTC 截断会把完成日算成 07-16 → 此断言失败
    expect(data.checkinDates).toContain("2026-07-18");
    expect(data.missedDays).toEqual([]);
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
  // 语义调整（2026-07-18）：无排期日现在是"无需打卡"（不可补也不会断卡），
  // 补卡对象必须是真实漏卡日 → 给 07-02 加一个未完成的应做项使其成为漏卡日。
  it("23. 3 天内补卡成功：扣余额、记日期、连续天数接上", async () => {
    await db.tasks.bulkAdd([doneSingle("a", "2026-07-01"), doneSingle("b", "2026-07-03"), doneSingle("c", "2026-07-04"), makeTask("gap", { enableStreak: true, date: "2026-07-02" })]);
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

describe("复活卡自动发卡（连续满 7 天 +1，上限 2）", () => {
  const seedDays = (n: number, from = "2026-07-01") => {
    const dates: string[] = [];
    let d = from;
    for (let i = 0; i < n; i++) { dates.push(d); d = `2026-07-${String(Number(d.slice(8)) + 1).padStart(2, "0")}`; }
    return db.tasks.bulkAdd(dates.map((day) => doneSingle(`seed-${day}`, day)));
  };

  it("32. 连续 7 天发 1 张，14 天发 2 张，21 天封顶 2 张", async () => {
    await seedDays(7);
    let data = await getStreakData("2026-07-07");
    expect(data.reviveBalance).toBe(1);
    await seedDays(7, "2026-07-08");
    data = await getStreakData("2026-07-14");
    expect(data.reviveBalance).toBe(2);
    await seedDays(7, "2026-07-15");
    data = await getStreakData("2026-07-21");
    expect(data.reviveBalance).toBe(2); // 持有上限
  });

  it("33. 发卡幂等：重复计算不重复发", async () => {
    await seedDays(7);
    await getStreakData("2026-07-07");
    const data = await getStreakData("2026-07-07");
    expect(data.reviveBalance).toBe(1);
  });

  // 语义调整（2026-07-18）：同用例 23——07-07 需要有未完成应做项才是可补的漏卡日。
  it("34. 复活卡补的日期参与凑满 7 天", async () => {
    await seedDays(6); // 07-01 ~ 07-06
    await db.tasks.add(doneSingle("d8", "2026-07-08"));
    await db.tasks.add(makeTask("gap7", { enableStreak: true, date: "2026-07-07" }));
    await saveReviveCards({ balance: 1, usedDates: [] });
    await applyReviveCard("2026-07-07", "2026-07-08"); // 补 07-07，连成 8 天
    const data = await getStreakData("2026-07-08");
    expect(data.currentStreak).toBe(8);
    expect(data.reviveBalance).toBe(1); // 用掉 1 张后，满 7 天又发 1 张
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

describe("三态打卡判定（2026-07-18 新规则）", () => {
  it("35. 当天 3 个应做项完成 2 个 → 未打卡；全完成 → 打卡", async () => {
    await db.tasks.bulkAdd([
      doneSingle("d1", "2026-07-01"),
      doneSingle("a", "2026-07-02"),
      doneSingle("b", "2026-07-02"),
      makeTask("c", { enableStreak: true, date: "2026-07-02" }),
    ]);
    let data = await getStreakData("2026-07-02");
    expect(data.missedDays).toContain("2026-07-02");
    expect(data.checkinDates).toEqual(["2026-07-01"]);
    expect(data.currentStreak).toBe(1); // 今天未清不算断，从昨天起算
    await db.tasks.update("c", { status: "done", completedAt: noonOf("2026-07-02") });
    data = await getStreakData("2026-07-02");
    expect(data.checkinDates).toEqual(["2026-07-01", "2026-07-02"]);
    expect(data.currentStreak).toBe(2);
  });

  it("36. 打卡-空日-打卡：无应做项的日子既不打卡也不断卡，连续性穿过", async () => {
    await db.tasks.bulkAdd([doneSingle("a", "2026-07-01"), doneSingle("b", "2026-07-03")]);
    const data = await getStreakData("2026-07-03");
    expect(data.checkinDates).toEqual(["2026-07-01", "2026-07-03"]);
    expect(data.missedDays).toEqual([]); // 07-02 是"无需打卡"，不算漏卡
    expect(data.currentStreak).toBe(2);
    expect(data.longestStreak).toBe(2);
  });

  it("37. 手动覆盖：removed 去掉未完成默认项后当天转打卡；added 加入未完成项后转未打卡", async () => {
    await db.tasks.bulkAdd([
      doneSingle("t1", "2026-07-05"),
      makeTask("t2", { enableStreak: true, date: "2026-07-05" }),
      makeTask("t3", { date: "2026-07-05" }), // 非 enableStreak，靠 added 引入
    ]);
    let items = await getDailyCheckItems("2026-07-05");
    expect(items.map((i) => [i.task.id, i.source, i.done])).toEqual([["t1", "default", true], ["t2", "default", false]]);
    expect((await getStreakData("2026-07-05")).missedDays).toContain("2026-07-05");

    await setDailyCheckOverride("2026-07-05", { removed: ["t2"] });
    expect((await getDailyCheckItems("2026-07-05")).map((i) => i.task.id)).toEqual(["t1"]);
    expect((await getStreakData("2026-07-05")).currentStreak).toBe(1); // 剩余全完成 → 打卡

    await setDailyCheckOverride("2026-07-05", { removed: ["t2"], added: ["t3"] });
    items = await getDailyCheckItems("2026-07-05");
    expect(items.find((i) => i.task.id === "t3")?.source).toBe("added");
    expect((await getStreakData("2026-07-05")).currentStreak).toBe(0); // added 未完成 → 未打卡（今天不断，昨日无卡可数）
    await db.tasks.update("t3", { status: "done", completedAt: noonOf("2026-07-05") });
    expect((await getStreakData("2026-07-05")).currentStreak).toBe(1);
  });

  it("38. 空日与休息日混合：均被连续性跳过；休息日优先于漏卡判定", async () => {
    await db.tasks.bulkAdd([
      doneSingle("a", "2026-07-01"),
      makeTask("r", { enableStreak: true, date: "2026-07-03" }), // 07-03 有未完成应做项
      doneSingle("b", "2026-07-04"),
    ]);
    await saveRestDays(["2026-07-03"]); // 但 07-03 标了休息日 → 跳过不断卡
    const data = await getStreakData("2026-07-04");
    // 07-01 打卡、07-02 空日跳过、07-03 休息日跳过（虽有未完成项）、07-04 打卡 → 连续 2
    expect(data.currentStreak).toBe(2);
    expect(data.longestStreak).toBe(2);
    expect(data.missedDays).toEqual([]); // 休息日不进漏卡列表
  });
});

describe("getPerItemStreaks 单项连续", () => {
  const dailyTask = (id: string, startDate: string, overrides: Partial<Task> = {}) =>
    makeTask(id, { enableStreak: true, timeType: "recurring", schedulePattern: "dailyRecurring", date: undefined, startDate, recurrence: { frequency: "daily", startDate }, ...overrides });

  it("42. 单项连续正确：每日任务连做 3 天，recentDays 状态齐全", async () => {
    await db.tasks.add(dailyTask("p1", "2026-07-01"));
    for (const d of ["2026-07-02", "2026-07-03", "2026-07-04"]) {
      await db.taskOccurrenceStatuses.add(occRow("p1", d, "done", noonOf(d)));
    }
    const items = await getPerItemStreaks("2026-07-04");
    expect(items).toHaveLength(1);
    expect(items[0].taskId).toBe("p1");
    expect(items[0].currentStreak).toBe(3); // 07-01 漏卡在前，02-04 连续 3 天
    const statusByDate = Object.fromEntries(items[0].recentDays.map((r) => [r.date, r.status]));
    expect(statusByDate["2026-07-01"]).toBe("missed");
    expect(statusByDate["2026-07-04"]).toBe("done");
    expect(statusByDate["2026-06-28"]).toBe("off"); // 排期开始前是非应做日
  });

  it("43. 某项断卡不影响另一项", async () => {
    await db.tasks.bulkAdd([dailyTask("a", "2026-07-01"), dailyTask("b", "2026-07-01")]);
    for (const d of ["2026-07-01", "2026-07-02", "2026-07-03"]) {
      await db.taskOccurrenceStatuses.add(occRow("a", d, "done", noonOf(d)));
    }
    await db.taskOccurrenceStatuses.bulkAdd([
      occRow("b", "2026-07-01", "done", noonOf("2026-07-01")),
      occRow("b", "2026-07-03", "done", noonOf("2026-07-03")), // b 在 07-02 断了
    ]);
    const items = await getPerItemStreaks("2026-07-03");
    const a = items.find((i) => i.taskId === "a");
    const b = items.find((i) => i.taskId === "b");
    expect(a?.currentStreak).toBe(3);
    expect(b?.currentStreak).toBe(1); // 07-02 漏卡截断，只剩 07-03
  });

  it("44. 非应做日穿过不断：隔日排期的任务连续按应做日计", async () => {
    // specificDates 隔日排期：1、3、5 号；2、4 号非应做日
    await db.tasks.add(makeTask("sp", { enableStreak: true, timeType: "recurring", schedulePattern: "specificDates", date: undefined, specificDates: ["2026-07-01", "2026-07-03", "2026-07-05"] }));
    for (const d of ["2026-07-01", "2026-07-03", "2026-07-05"]) {
      await db.taskOccurrenceStatuses.add(occRow("sp", d, "done", noonOf(d)));
    }
    const items = await getPerItemStreaks("2026-07-05");
    expect(items[0].currentStreak).toBe(3); // 三个应做日全完成，中间空日穿过
    const statusByDate = Object.fromEntries(items[0].recentDays.map((r) => [r.date, r.status]));
    expect(statusByDate["2026-07-02"]).toBe("off");
    expect(statusByDate["2026-07-04"]).toBe("off");
    expect(statusByDate["2026-07-05"]).toBe("done");
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
