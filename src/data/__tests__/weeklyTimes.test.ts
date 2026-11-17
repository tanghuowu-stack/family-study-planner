/**
 * 每周几次（2026-11-17，每日/每周计划第 2 步）：一周（周一到周日）做够几次就行，不排到哪一天。
 * 记录存 Task.weeklyLog（metadata jsonb）；本体 status 只有 todo / cancelled。
 * 时间固定 2026-11-19（周四）Asia/Shanghai；只假造 Date。Supabase 全程 mock，只断言上传了哪些行。
 */
declare const process: { env: Record<string, string | undefined> };
process.env.TZ = "Asia/Shanghai";
// 打卡读休息日走 app_settings（本地模式只用 localStorage）：内存 shim
const memStore = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => void memStore.set(k, String(v)),
  removeItem: (k: string) => void memStore.delete(k),
  clear: () => memStore.clear(),
};
import "fake-indexeddb/auto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ upserts: {} as Record<string, Record<string, unknown>[]> }));
vi.mock("../../lib/supabase", () => {
  const thenable = (value: unknown) => {
    const chain: Record<string, unknown> = {};
    for (const name of ["eq", "in", "order", "gte", "lte", "limit"]) chain[name] = () => chain;
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(value).then(resolve, reject);
    return chain;
  };
  return {
    supabaseConfigured: true,
    supabase: {
      from: (table: string) => ({
        upsert: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
          (captured.upserts[table] ??= []).push(...(Array.isArray(rows) ? rows : [rows]));
          return Promise.resolve({ error: null });
        },
        select: () => thenable({ data: [], error: null }),
        delete: () => thenable({ error: null }),
      }),
    },
  };
});

import { db } from "../db";
import { taskRepository } from "../taskRepository";
import { cloudRepository } from "../cloudRepository";
import type { Task, TaskDraft } from "../../types/task";
import { applyWeeklyLog, weeklyTimesActiveIn, weeklyTimesProgress } from "../../utils/weeklyTimes";
import { isEndedRecurring } from "../../utils/taskMeta";
import { getWeekReview } from "../weekReview";
import { computeWeeklyStreak, getHabitCalendars, getHabitCandidates } from "../statsRepository";

const TODAY = "2026-11-19"; // 周四；本周 11-16（一）~ 11-22（日）
const piano = (overrides: Partial<Task> = {}): TaskDraft => ({
  title: "钢琴练习", mainCategory: "interestClass", subCategory: "pianoPractice", timeType: "weeklyTimes", startDate: "2026-11-02",
  weeklyQuota: { enabled: true, targetCount: 3, unit: "次", isWeeklyRecurring: true, allowAutoDistribute: false, allowRollover: false },
  status: "todo", rolloverMode: "keepOverdue", allowRollover: false, childVisible: true, ...overrides,
} as TaskDraft);

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-19T10:00:00+08:00")); });
afterAll(() => { vi.useRealTimers(); });
beforeEach(async () => {
  captured.upserts = {};
  await Promise.all([db.tasks.clear(), db.taskOccurrenceStatuses.clear(), db.activityLogs.clear(), db.planPeriods.clear()]);
  cloudRepository.setFamilyId("");
});

describe("纯函数：本周进度", () => {
  it("1. 只算这一周（周一到周日）的记录；上周做的不累计；可以超过目标", () => {
    const task = { weeklyQuota: piano().weeklyQuota, weeklyLog: { "2026-11-15": 3, "2026-11-16": 1, "2026-11-19": 2, "2026-11-23": 1 } };
    const p = weeklyTimesProgress(task, TODAY);
    expect(p.weekStart).toBe("2026-11-16");
    expect(p.done).toBe(3);
    expect(p.dayCount).toBe(2);
    expect(p.reached).toBe(true);
    expect(p.days.map((d) => d.count)).toEqual([1, 0, 0, 2, 0, 0, 0]);
    expect(weeklyTimesProgress(task, "2026-11-23").done).toBe(1); // 下周一从头算
  });

  it("2. 记一次 / 撤销：减到 0 那天不存，全空返回 undefined；一天可以记多次（RAZ 一天 3 本），最多 50", () => {
    expect(applyWeeklyLog(undefined, TODAY, 1)).toEqual({ [TODAY]: 1 });
    expect(applyWeeklyLog({ [TODAY]: 1 }, TODAY, -1)).toBeUndefined();
    expect(applyWeeklyLog({ "2026-11-16": 1 }, TODAY, -1)).toEqual({ "2026-11-16": 1 });
    expect(applyWeeklyLog({ [TODAY]: 2 }, TODAY, 1)).toEqual({ [TODAY]: 3 });
    expect(applyWeeklyLog({ [TODAY]: 20 }, TODAY, 1)).toEqual({ [TODAY]: 21 });
    expect(applyWeeklyLog({ [TODAY]: 50 }, TODAY, 1)).toEqual({ [TODAY]: 50 });
  });

  it("3. 有效期：开始那周起、结束那周止（按整周算）；过了结束日归到已结束", () => {
    const task = { timeType: "weeklyTimes" as const, startDate: "2026-11-18", endDate: "2026-11-24" };
    expect(weeklyTimesActiveIn(task, "2026-11-16")).toBe(true); // 周三开始，这周也算
    expect(weeklyTimesActiveIn(task, "2026-11-09")).toBe(false);
    expect(weeklyTimesActiveIn(task, "2026-11-29")).toBe(true); // 周二结束，那一周也算
    expect(weeklyTimesActiveIn(task, "2026-11-30")).toBe(false);
    expect(isEndedRecurring(task, "2026-11-25")).toBe(true);
    expect(isEndedRecurring({ ...task, endDate: undefined }, "2027-01-01")).toBe(false);
  });
});

describe("本地读写", () => {
  it("4. 今日页取本周的每周几次：不进当天清单、不进逾期；取消的、不显示的、不在有效期的不取", async () => {
    const { task } = await taskRepository.create(piano());
    await taskRepository.create(piano({ title: "已取消", status: "cancelled" }));
    await taskRepository.create(piano({ title: "不显示", childVisible: false }));
    await taskRepository.create(piano({ title: "下周才开始", startDate: "2026-11-23" }));
    expect((await taskRepository.getWeeklyTimes(TODAY)).map((t) => t.id)).toEqual([task.id]);
    expect((await taskRepository.getTasksForDate(TODAY)).map((t) => t.id)).not.toContain(task.id);
    expect((await taskRepository.getOverdueTasks(TODAY)).map((t) => t.id)).not.toContain(task.id);
  });

  it("5. 记一次、再一次、撤销一次；不能记到今天以后", async () => {
    const { task } = await taskRepository.create(piano());
    const onLocalWrite = vi.fn();
    expect(await taskRepository.logWeeklyTime(task.id, TODAY, 1, onLocalWrite)).toBe(true);
    expect(onLocalWrite).toHaveBeenCalledTimes(1);
    await taskRepository.logWeeklyTime(task.id, TODAY, 1);
    await taskRepository.logWeeklyTime(task.id, "2026-11-17", 1);
    await taskRepository.logWeeklyTime(task.id, TODAY, -1);
    await taskRepository.logWeeklyTime(task.id, "2026-11-20", 1);
    const saved = (await db.tasks.get(task.id))!;
    expect(saved.weeklyLog).toEqual({ [TODAY]: 1, "2026-11-17": 1 });
    expect(saved.status).toBe("todo");
  });

  it("5b. 补记 / 取消某天；填数量（差值写入）；连续快速写入不丢（2026-11-17 用户反馈）", async () => {
    const { task } = await taskRepository.create(piano({ weeklyLog: { "2026-11-16": 3 } }));
    // 填 0 = 减去那天的数量，那天整个清掉
    await taskRepository.logWeeklyTime(task.id, "2026-11-16", -3);
    expect((await db.tasks.get(task.id))!.weeklyLog).toBeUndefined();
    // 任务今天才开始也能给本周一补记（每周几次按整周算）
    const { task: fresh } = await taskRepository.create(piano({ startDate: TODAY }));
    await taskRepository.logWeeklyTime(fresh.id, "2026-11-16", 2);
    expect((await db.tasks.get(fresh.id))!.weeklyLog).toEqual({ "2026-11-16": 2 });
    // 连续快速写入 4 次（不等前一次写完），4 份都记上
    await Promise.all([1, 2, 3, 4].map(() => taskRepository.logWeeklyTime(task.id, "2026-11-18", 1)));
    expect((await db.tasks.get(task.id))!.weeklyLog).toEqual({ "2026-11-18": 4 });
  });

  it("6. 本体不记整体完成：误设 done 写回 todo；编辑表单保存不丢记录；复制到日期的副本不带记录", async () => {
    const { task } = await taskRepository.create(piano({ weeklyLog: { [TODAY]: 2 } }));
    await taskRepository.update(task.id, { status: "done", title: "钢琴" });
    const saved = (await db.tasks.get(task.id))!;
    expect(saved.status).toBe("todo");
    expect(saved.completedAt).toBeUndefined();
    expect(saved.weeklyLog).toEqual({ [TODAY]: 2 });
    const copy = await taskRepository.copyToDate(task.id, "2026-11-25");
    expect(copy.weeklyLog).toBeUndefined();
    expect(copy.weeklyQuota).toBeUndefined();
  });
});

describe("云端模式", () => {
  it("7. 记一次后上传，metadata 带记录；没变化（撤销到 0 以下、记到以后）不上传", async () => {
    cloudRepository.setFamilyId("fam");
    const { task } = await taskRepository.create(piano());
    expect(await cloudRepository.logWeeklyTime(task.id, TODAY, 1)).toBe(true);
    expect(captured.upserts.tasks).toHaveLength(1);
    expect(captured.upserts.tasks[0].time_type).toBe("weeklyTimes");
    expect((captured.upserts.tasks[0].metadata as Record<string, unknown>).weeklyLog).toEqual({ [TODAY]: 1 });
    await cloudRepository.logWeeklyTime(task.id, "2026-11-17", -1);
    await cloudRepository.logWeeklyTime(task.id, "2026-11-21", 1);
    expect(captured.upserts.tasks).toHaveLength(1);
  });
});

describe("第 3 步：本周条与打卡", () => {
  it("8. 月视图本周条：每周几次不进 7 天件数，单独给出这一周做了几次；过去的周按那一周的记录算", async () => {
    const { task } = await taskRepository.create(piano({ weeklyLog: { "2026-11-10": 3, "2026-11-17": 1, "2026-11-19": 1 } }));
    const review = await getWeekReview(TODAY, TODAY);
    expect(review.days.reduce((sum, day) => sum + day.total, 0)).toBe(0);
    expect(review.weeklyTimes).toEqual([{ taskId: task.id, title: "钢琴练习", done: 2, target: 3, unit: "次", reached: false, subject: "other" }]);
    const lastWeek = await getWeekReview("2026-11-10", TODAY);
    expect(lastWeek.weeklyTimes[0]).toMatchObject({ done: 3, reached: true });
    // 开始之前的周不列
    expect((await getWeekReview("2026-10-20", TODAY)).weeklyTimes).toEqual([]);
  });

  it("9. 连续周数：本周没做够不算断；过去哪周没做够就断；停 2 周以内接着算，再长从头算", () => {
    const t = (log: Record<string, number>, extra: Partial<Task> = {}) => ({ ...piano(), id: "p", createdAt: "", updatedAt: "", weeklyLog: log, ...extra } as Task);
    // 11-02、11-09 两周都做够 3 次，本周（11-16）只做 1 次
    const log = { "2026-11-03": 3, "2026-11-10": 2, "2026-11-12": 1, "2026-11-17": 1 };
    expect(computeWeeklyStreak([t(log)], TODAY)).toBe(2);
    expect(computeWeeklyStreak([t({ ...log, "2026-11-18": 2 })], TODAY)).toBe(3);
    expect(computeWeeklyStreak([t({ ...log, "2026-11-10": 1 })], TODAY)).toBe(0); // 上周没做够
    // 打卡起点之前的周不算
    expect(computeWeeklyStreak([t(log)], TODAY, "2026-11-09")).toBe(1);
    // 接上的两段：中间停了 2 周接着算，停 3 周从头算
    const old = t({ "2026-10-20": 3 }, { id: "old", startDate: "2026-10-01", endDate: "2026-10-25" });
    const now2 = t({ "2026-11-10": 3 }, { id: "new", startDate: "2026-11-09" });
    expect(computeWeeklyStreak([old, now2], TODAY)).toBe(2);
    const now3 = t({ "2026-11-17": 3 }, { id: "new", startDate: "2026-11-16" });
    expect(computeWeeklyStreak([old, now3], TODAY)).toBe(1);
  });

  it("10. 打卡页：每周几次可以勾进打卡；记了的那天算完成，没记的日子不算漏卡；连续按周", async () => {
    const { task } = await taskRepository.create(piano({ title: "课外读书", mainCategory: "extraHomework", subCategory: "chinese", weeklyQuota: { enabled: true, targetCount: 2, unit: "本", isWeeklyRecurring: true, allowAutoDistribute: false, allowRollover: false }, weeklyLog: { "2026-11-11": 2, "2026-11-17": 1 } }));
    expect((await getHabitCandidates()).map((c) => [c.taskId, c.scheduleText])).toEqual([[task.id, "每周 2 本"]]);
    await db.tasks.update(task.id, { enableStreak: true, streakStartDate: "2026-11-02" });
    const [cal] = await getHabitCalendars("2026-11", TODAY);
    expect(cal.streakUnit).toBe("周");
    expect(cal.currentStreak).toBe(1);
    expect(cal.monthCompletedDays).toBe(2);
    expect(cal.days.filter((d) => d.status === "missed")).toEqual([]);
    expect(cal.days.find((d) => d.date === "2026-11-17")!.status).toBe("done");
    expect(cal.hasScheduleInMonth).toBe(true);
  });

  it("11. 钢琴固定分组：改成每周几次后，记了的那天也算进“钢琴”这一行（和以前的钢琴任务合在一起）", async () => {
    const OLD = "2026-01-01T00:00:00.000Z";
    await db.tasks.add({ id: "old-piano", title: "钢琴练习", mainCategory: "interestClass", subCategory: "pianoPractice", timeType: "recurring", schedulePattern: "dailyRecurring",
      recurrence: { frequency: "daily", startDate: "2026-11-01", endDate: "2026-11-08" }, status: "todo", rolloverMode: "skipIfMissed", allowRollover: false, childVisible: true,
      enableStreak: true, streakStartDate: "2026-11-01", createdAt: OLD, updatedAt: OLD } as Task);
    await taskRepository.create(piano({ startDate: "2026-11-09", weeklyLog: { "2026-11-18": 1 } }));
    const cals = await getHabitCalendars("2026-11", TODAY);
    expect(cals).toHaveLength(1);
    expect(cals[0].title).toBe("钢琴");
    expect(cals[0].streakUnit).toBe("天");
    expect(cals[0].days.find((d) => d.date === "2026-11-18")!.status).toBe("done");
    expect(cals[0].days.find((d) => d.date === "2026-11-17")!.status).toBe("off");
  });
});

describe("把已有的重复任务改成每周几次", () => {
  const OLD = "2026-01-01T00:00:00.000Z";
  const daily = (overrides: Partial<Task> = {}) => ({
    id: "daily-read", title: "课外读书", mainCategory: "extraHomework", subCategory: "chinese", extraContentType: "homework", timeType: "recurring", schedulePattern: "dailyRecurring",
    recurrence: { frequency: "daily", startDate: "2026-11-01" }, status: "todo", rolloverMode: "skipIfMissed", allowRollover: false, childVisible: true,
    enableStreak: true, streakStartDate: "2026-11-01", createdAt: OLD, updatedAt: OLD, ...overrides,
  } as Task);
  const asWeekly = (task: Task): TaskDraft => ({ ...task, id: undefined, createdAt: undefined, updatedAt: undefined, timeType: "weeklyTimes", schedulePattern: "singleDate", recurrence: undefined, startDate: "2026-11-01",
    weeklyQuota: { enabled: true, targetCount: 2, unit: "本", isWeeklyRecurring: true, allowAutoDistribute: false, allowRollover: false } } as unknown as TaskDraft);
  const occ = (date: string) => ({ id: `daily-read:${date}`, taskId: "daily-read", occurrenceDate: date, status: "done" as const, completedAt: `${date}T12:00:00.000Z`, createdAt: OLD, updatedAt: OLD });

  it("12. 有历史的：原任务排期截到昨天、历史照旧；另建每周几次从今天开始，接上打卡；今天勾过的算今天一次", async () => {
    await db.tasks.add(daily());
    await db.taskOccurrenceStatuses.bulkAdd([occ("2026-11-17"), occ(TODAY)]);
    const before = await getHabitCalendars("2026-11", TODAY);
    expect(before[0].days.find((d) => d.date === "2026-11-17")!.status).toBe("done");

    const { task, ended } = await taskRepository.convertToWeeklyTimes("daily-read", asWeekly(daily()), TODAY);
    expect(ended!.id).toBe("daily-read");
    expect(ended!.recurrence!.endDate).toBe("2026-11-18");
    expect(ended!.timeType).toBe("recurring");
    expect(task.id).not.toBe("daily-read");
    expect(task).toMatchObject({ timeType: "weeklyTimes", startDate: TODAY, weeklyLog: { [TODAY]: 1 }, habitKey: "daily-read", enableStreak: true, streakStartDate: TODAY });
    // 今日页往回翻：17 号原任务照旧在、显示已完成；今天原任务不再出现，新任务在本周计划
    const on17 = (await taskRepository.getTasksForDate("2026-11-17")).find((t) => t.id === "daily-read");
    expect(on17?.status).toBe("done");
    expect((await taskRepository.getTasksForDate(TODAY)).map((t) => t.id)).not.toContain("daily-read");
    expect((await taskRepository.getWeeklyTimes(TODAY)).map((t) => t.id)).toEqual([task.id]);
    // 打卡：还是一行，17 号、今天都算完成
    const after = await getHabitCalendars("2026-11", TODAY);
    expect(after).toHaveLength(1);
    expect(after[0].days.find((d) => d.date === "2026-11-17")!.status).toBe("done");
    expect(after[0].days.find((d) => d.date === TODAY)!.status).toBe("done");
  });

  it("13. 还没开始过的（起点在今天以后、没有记录）：直接原地改，不另建", async () => {
    await db.tasks.add(daily({ recurrence: { frequency: "daily", startDate: "2026-11-20" }, enableStreak: undefined, streakStartDate: undefined }));
    const { task, ended } = await taskRepository.convertToWeeklyTimes("daily-read", asWeekly(daily()), TODAY);
    expect(ended).toBeUndefined();
    expect(task.id).toBe("daily-read");
    expect(task.timeType).toBe("weeklyTimes");
    expect(await db.tasks.count()).toBe(1);
  });

  it("14. 云端模式：停掉的原任务和新任务都上传", async () => {
    cloudRepository.setFamilyId("fam");
    await db.tasks.add(daily());
    await db.taskOccurrenceStatuses.add(occ("2026-11-17"));
    const { task, synced } = await cloudRepository.convertToWeeklyTimes("daily-read", asWeekly(daily()), TODAY);
    expect(synced).toBe(true);
    expect((captured.upserts.tasks ?? []).map((row) => [row.id, row.time_type])).toEqual([["daily-read", "recurring"], [task.id, "weeklyTimes"]]);
  });
});

describe("把每周几次改成别的类型", () => {
  const toDaily = (task: Task): TaskDraft => ({ ...task, id: undefined, createdAt: undefined, updatedAt: undefined, timeType: "recurring", schedulePattern: "dailyRecurring",
    recurrence: { frequency: "daily", startDate: "2026-11-02" }, weeklyQuota: undefined, startDate: undefined } as unknown as TaskDraft);

  it("15. 有记录的：原任务结束日记到昨天、记录保留（本周条和打卡照算）；另建重复任务从今天开始，接上打卡；今天之后的今日页不再出现原任务", async () => {
    const { task: old } = await taskRepository.create(piano({ title: "课外读书", mainCategory: "extraHomework", subCategory: "chinese", weeklyLog: { "2026-11-10": 2, "2026-11-17": 1 }, enableStreak: true, streakStartDate: "2026-11-02" }));
    const { task, ended } = await taskRepository.convertFromWeeklyTimes(old.id, toDaily(old), TODAY);
    expect(ended).toMatchObject({ id: old.id, timeType: "weeklyTimes", endDate: "2026-11-18", weeklyLog: { "2026-11-10": 2, "2026-11-17": 1 } });
    expect(task).toMatchObject({ timeType: "recurring", recurrence: { startDate: TODAY }, habitKey: old.id, enableStreak: true, streakStartDate: TODAY });
    expect(task.weeklyQuota).toBeUndefined();
    expect(task.weeklyLog).toBeUndefined();
    // 今天的本周计划不再有它；周二那天还在；本周条（按周一取）照算它这周的 1 次
    expect(await taskRepository.getWeeklyTimes(TODAY)).toEqual([]);
    expect((await taskRepository.getWeeklyTimes("2026-11-17")).map((t) => t.id)).toEqual([old.id]);
    expect((await getWeekReview(TODAY, TODAY)).weeklyTimes).toMatchObject([{ taskId: old.id, done: 1 }]);
    // 新任务今天出现在当天清单
    expect((await taskRepository.getTasksForDate(TODAY)).map((t) => t.id)).toContain(task.id);
    // 打卡还是一行，以前记的那天照样算完成
    const cals = await getHabitCalendars("2026-11", TODAY);
    expect(cals).toHaveLength(1);
    expect(cals[0].days.find((d) => d.date === "2026-11-10")!.status).toBe("done");
  });

  it("16. 一次都没记过的：直接原地改，不另建", async () => {
    const { task: old } = await taskRepository.create(piano());
    const { task, ended } = await taskRepository.convertFromWeeklyTimes(old.id, toDaily(old), TODAY);
    expect(ended).toBeUndefined();
    expect(task.id).toBe(old.id);
    expect(task.timeType).toBe("recurring");
    expect(await db.tasks.count()).toBe(1);
  });
});
