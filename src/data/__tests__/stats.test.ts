/**
 * TASK_08 统计数据层回归测试（打卡月历重构后）。
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
import { getHabitCandidates, setHabitEnabled, getHabitCalendars, toggleRestDay } from "../statsRepository";
import { saveRestDays } from "../appSettingsRepository";
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
const occRow = (taskId: string, date: string, status: string, completedAt?: string): TaskOccurrenceStatus => ({
  id: `${taskId}:${date}`,
  taskId,
  occurrenceDate: date,
  status: status as TaskOccurrenceStatus["status"],
  completedAt,
  createdAt: now,
  updatedAt: now,
});
/** 每日重复的打卡任务（含 recurrence，scheduleOccursOn 需要它） */
const dailyHabit = (id: string, streakStartDate: string, overrides: Partial<Task> = {}) =>
  makeTask(id, {
    enableStreak: true, streakStartDate,
    timeType: "recurring", schedulePattern: "dailyRecurring", date: undefined,
    startDate: "2026-06-01", recurrence: { frequency: "daily", startDate: "2026-06-01" },
    ...overrides,
  });
const statusMap = (cal: { days: { date: string; status: string }[] }) =>
  Object.fromEntries(cal.days.map((d) => [d.date, d.status]));
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

beforeEach(async () => {
  memStore.clear();
  await Promise.all([db.tasks.clear(), db.taskOccurrenceStatuses.clear(), db.activityLogs.clear()]);
});

describe("getHabitCandidates", () => {
  it("1. 只返回活跃重复类任务，含已勾选标记，排除单日/软删/取消", async () => {
    await db.tasks.bulkAdd([
      dailyHabit("rec-on", "2026-07-10"),
      makeTask("rec-off", { timeType: "recurring", schedulePattern: "dailyRecurring", date: undefined, startDate: "2026-07-01", recurrence: { frequency: "daily", startDate: "2026-07-01" }, sortOrder: 1 }),
      makeTask("single", { date: "2026-07-10" }),                      // 单日，非候选
      makeTask("rec-del", { timeType: "recurring", schedulePattern: "dailyRecurring", date: undefined, deletedAt: now }),
      makeTask("rec-cancel", { timeType: "recurring", schedulePattern: "dailyRecurring", date: undefined, status: "cancelled" }),
    ]);
    const list = await getHabitCandidates();
    expect(list.map((c) => c.taskId).sort()).toEqual(["rec-off", "rec-on"]);
    expect(list.find((c) => c.taskId === "rec-on")?.enabled).toBe(true);
    expect(list.find((c) => c.taskId === "rec-off")?.enabled).toBe(false);
  });
});

describe("setHabitEnabled", () => {
  it("2. 勾选写起点=今天；取消保留起点；重勾更新为新起点", async () => {
    const { task } = await taskRepository.create({
      title: "背诵", mainCategory: "school", subCategory: "chinese", timeType: "recurring",
      schedulePattern: "dailyRecurring", startDate: "2026-07-01", status: "todo",
      rolloverMode: "keepOverdue", allowRollover: false, childVisible: true,
    } as never);
    expect((await db.tasks.get(task.id))?.enableStreak).toBeUndefined();

    await setHabitEnabled(task.id, true);
    let body = await db.tasks.get(task.id);
    expect(body?.enableStreak).toBe(true);
    expect(body?.streakStartDate).toBe(todayLocal());

    await db.tasks.update(task.id, { streakStartDate: "2026-01-01" }); // 模拟旧起点
    await setHabitEnabled(task.id, false);
    body = await db.tasks.get(task.id);
    expect(body?.enableStreak).toBe(false);
    expect(body?.streakStartDate).toBe("2026-01-01"); // 取消保留，历史月历可回看

    await setHabitEnabled(task.id, true);
    body = await db.tasks.get(task.id);
    expect(body?.streakStartDate).toBe(todayLocal()); // 重勾更新为新起点
  });
});

describe("getHabitCalendars", () => {
  it("3. 月历口径：起点前 off、漏卡 missed、完成 done、未来 off", async () => {
    await db.tasks.add(dailyHabit("h", "2026-07-10"));
    for (const d of ["2026-07-10", "2026-07-11", "2026-07-13"]) {
      await db.taskOccurrenceStatuses.add(occRow("h", d, "done", noonOf(d)));
    } // 07-12 未完成
    const cals = await getHabitCalendars("2026-07", "2026-07-13");
    expect(cals).toHaveLength(1);
    const m = statusMap(cals[0]);
    expect(m["2026-07-05"]).toBe("off");   // 起点前
    expect(m["2026-07-10"]).toBe("done");
    expect(m["2026-07-11"]).toBe("done");
    expect(m["2026-07-12"]).toBe("missed"); // 应做未完成
    expect(m["2026-07-13"]).toBe("done");
    expect(m["2026-07-20"]).toBe("off");   // 未来
    expect(cals[0].currentStreak).toBe(1); // 07-13 done，07-12 漏卡截断
  });

  it("4. 休息日未完成 = off 且连续免罚穿过", async () => {
    await db.tasks.add(dailyHabit("h", "2026-07-10"));
    for (const d of ["2026-07-10", "2026-07-11", "2026-07-13"]) {
      await db.taskOccurrenceStatuses.add(occRow("h", d, "done", noonOf(d)));
    }
    await saveRestDays(["2026-07-12"]); // 把漏卡的 07-12 标为休息日
    const cals = await getHabitCalendars("2026-07", "2026-07-13");
    const m = statusMap(cals[0]);
    expect(m["2026-07-12"]).toBe("off");
    expect(cals[0].currentStreak).toBe(3); // 07-13、07-11、07-10，休息日穿过
  });

  it("4b. 休息日实际完成 = done 且计入连续（免罚而非不计）", async () => {
    await db.tasks.add(dailyHabit("h", "2026-07-10"));
    for (const d of ["2026-07-10", "2026-07-11", "2026-07-12", "2026-07-13"]) {
      await db.taskOccurrenceStatuses.add(occRow("h", d, "done", noonOf(d)));
    }
    await saveRestDays(["2026-07-12"]); // 休息日但当天做完了
    const cals = await getHabitCalendars("2026-07", "2026-07-13");
    const m = statusMap(cals[0]);
    expect(m["2026-07-12"]).toBe("done"); // 完成优先于休息日
    expect(cals[0].currentStreak).toBe(4); // 4 天全计入
  });

  it("5. 跨月切换：同一项目不同 month 参数返回对应月，currentStreak 恒从今天算", async () => {
    await db.tasks.add(dailyHabit("h", "2026-06-28"));
    for (const d of ["2026-06-28", "2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02"]) {
      await db.taskOccurrenceStatuses.add(occRow("h", d, "done", noonOf(d)));
    }
    const june = await getHabitCalendars("2026-06", "2026-07-02");
    const juneM = statusMap(june[0]);
    expect(june[0].days).toHaveLength(30);
    expect(juneM["2026-06-27"]).toBe("off"); // 起点前
    expect(juneM["2026-06-28"]).toBe("done");
    expect(juneM["2026-06-30"]).toBe("done");

    const july = await getHabitCalendars("2026-07", "2026-07-02");
    const julyM = statusMap(july[0]);
    expect(july[0].days).toHaveLength(31);
    expect(julyM["2026-07-01"]).toBe("done");
    expect(julyM["2026-07-02"]).toBe("done");
    expect(julyM["2026-07-03"]).toBe("off"); // 未来
    expect(june[0].currentStreak).toBe(5);   // 跨月连续
    expect(july[0].currentStreak).toBe(5);   // 与展示月份无关
  });

  it("6. 单项连续：隔日排期非应做日穿过；今天未完成不算断", async () => {
    await db.tasks.add(makeTask("sp", {
      enableStreak: true, streakStartDate: "2026-07-01",
      timeType: "recurring", schedulePattern: "specificDates", date: undefined,
      specificDates: ["2026-07-01", "2026-07-03", "2026-07-05", "2026-07-07"],
    }));
    for (const d of ["2026-07-01", "2026-07-03", "2026-07-05"]) {
      await db.taskOccurrenceStatuses.add(occRow("sp", d, "done", noonOf(d)));
    } // 07-07 是今天且未完成
    const cals = await getHabitCalendars("2026-07", "2026-07-07");
    const m = statusMap(cals[0]);
    expect(m["2026-07-02"]).toBe("off");   // 非应做日
    expect(m["2026-07-04"]).toBe("off");
    expect(m["2026-07-05"]).toBe("done");
    expect(m["2026-07-07"]).toBe("missed"); // 今天应做未完成，显示 missed
    expect(cals[0].currentStreak).toBe(3);  // 今天未完成不算断，07-05/03/01 连续 3
  });

  it("7. 只包含已勾选项目，未勾选任务不出现在月历", async () => {
    await db.tasks.bulkAdd([
      dailyHabit("on", "2026-07-10"),
      makeTask("off", { timeType: "recurring", schedulePattern: "dailyRecurring", date: undefined, startDate: "2026-07-01", recurrence: { frequency: "daily", startDate: "2026-07-01" } }),
    ]);
    const cals = await getHabitCalendars("2026-07", "2026-07-13");
    expect(cals.map((c) => c.taskId)).toEqual(["on"]);
  });
});

describe("occurrence completedAt 写入路径 + 休息日切换", () => {
  it("8. setOccurrence 转 done 写 completedAt，退出 done 清除（R2 override 仍保留）", async () => {
    const { task } = await taskRepository.create({
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

  it("9. toggleRestDay 双向切换并持久化", async () => {
    expect(await toggleRestDay("2026-07-20")).toEqual(["2026-07-20"]);
    expect(await toggleRestDay("2026-07-20")).toEqual([]);
  });
});
