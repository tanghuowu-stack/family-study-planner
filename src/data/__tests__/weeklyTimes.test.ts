/**
 * 每周几次（2026-11-17，每日/每周计划第 2 步）：一周（周一到周日）做够几次就行，不排到哪一天。
 * 记录存 Task.weeklyLog（metadata jsonb）；本体 status 只有 todo / cancelled。
 * 时间固定 2026-11-19（周四）Asia/Shanghai；只假造 Date。Supabase 全程 mock，只断言上传了哪些行。
 */
declare const process: { env: Record<string, string | undefined> };
process.env.TZ = "Asia/Shanghai";
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

  it("2. 记一次 / 撤销：减到 0 那天不存，全空返回 undefined；一天最多 20 次", () => {
    expect(applyWeeklyLog(undefined, TODAY, 1)).toEqual({ [TODAY]: 1 });
    expect(applyWeeklyLog({ [TODAY]: 1 }, TODAY, -1)).toBeUndefined();
    expect(applyWeeklyLog({ "2026-11-16": 1 }, TODAY, -1)).toEqual({ "2026-11-16": 1 });
    expect(applyWeeklyLog({ [TODAY]: 20 }, TODAY, 1)).toEqual({ [TODAY]: 20 });
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
