/**
 * 数据安全旧账（PROJECT_GUIDE §13 / ARCHITECTURE_RULES §4 的 2026-07-17 P1/P2，2026-11-14 修复）：
 * 1. 导入备份按 R1/R3 清洗，不把旧备份里的脏数据原样灌回；
 * 2. 导入在云端模式下整体上传，不再被下次拉取覆盖回去；
 * 3. 删除假期/课程时被解绑的任务刷新 updatedAt 并上传云端，不再被拉取改回去；
 * 4. 备份包含课程库（version 8），旧备份没有课程时保留现有课程。
 * Supabase 全程 mock，只断言上传了哪些行。
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ upserts: {} as Record<string, Record<string, unknown>[]>, deletes: [] as string[] }));

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
        delete: () => { captured.deletes.push(table); return thenable({ error: null }); },
      }),
    },
  };
});

import { db } from "../db";
import { taskRepository } from "../taskRepository";
import { cloudRepository } from "../cloudRepository";
import type { Course, PlanPeriod, Task } from "../../types/task";

const OLD = "2026-01-01T00:00:00.000Z";
const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id, title: id, mainCategory: "school", subCategory: "math", timeType: "singleDate", date: "2026-11-10",
  status: "todo", rolloverMode: "keepOverdue", allowRollover: false, childVisible: true, createdAt: OLD, updatedAt: OLD, ...overrides,
} as Task);
const course = (id: string): Course => ({ id, name: id, mainCategory: "extraHomework", subCategory: "english", status: "active", isClass: true, createdAt: OLD, updatedAt: OLD } as Course);
const holiday = (id: string): PlanPeriod => ({ id, name: id, type: "holiday", startDate: "2026-07-01", endDate: "2026-08-31", isActive: true, createdAt: OLD, updatedAt: OLD });

beforeEach(async () => {
  captured.upserts = {}; captured.deletes = [];
  await Promise.all([db.tasks.clear(), db.taskOccurrenceStatuses.clear(), db.planPeriods.clear(), db.courses.clear(), db.activityLogs.clear()]);
  cloudRepository.setFamilyId("");
});

describe("导入备份：清洗旧备份里的脏数据", () => {
  it("1. 重复类任务本体的完成状态清掉（R1）；非重复任务的单日记录丢弃；展示字段不落库（R3）；updatedAt 记为现在", async () => {
    const backup = {
      version: 7, exportedAt: OLD, planPeriods: [], activityLogs: [], readingLogs: [],
      tasks: [
        task("rec", { timeType: "recurring", schedulePattern: "dailyRecurring", date: undefined, recurrence: { frequency: "daily", startDate: "2026-11-01" }, status: "done", completedAt: OLD }),
        { ...task("single"), occurrenceDate: "2026-11-10", rolledFromDate: "2026-11-09" },
      ],
      taskOccurrenceStatuses: [
        { id: "rec:2026-11-10", taskId: "rec", occurrenceDate: "2026-11-10", status: "done", createdAt: OLD, updatedAt: OLD },
        { id: "single:2026-11-10", taskId: "single", occurrenceDate: "2026-11-10", status: "done", createdAt: OLD, updatedAt: OLD },
      ],
    };
    const before = new Date().toISOString();
    const result = await taskRepository.importBackup(backup);
    expect(result).toEqual({ tasks: 2, droppedOccurrences: 1 });
    const rec = (await db.tasks.get("rec"))!;
    expect(rec.status).toBe("todo");
    expect(rec.completedAt).toBeUndefined();
    expect(rec.updatedAt >= before).toBe(true);
    const single = (await db.tasks.get("single"))! as Task & { occurrenceDate?: string; rolledFromDate?: string };
    expect(single.occurrenceDate).toBeUndefined();
    expect(single.rolledFromDate).toBeUndefined();
    expect((await db.taskOccurrenceStatuses.toArray()).map((row) => row.id)).toEqual(["rec:2026-11-10"]);
    expect((await db.taskOccurrenceStatuses.get("rec:2026-11-10"))!.updatedAt >= before).toBe(true);
  });

  it("2. 备份包含课程（version 8）：导出带上、导入恢复；旧备份没有课程时保留现有课程", async () => {
    await db.courses.bulkAdd([course("FCE"), course("游泳")]);
    await db.tasks.add(task("t", { courseId: "FCE" }));
    const backup = await taskRepository.exportBackup();
    expect(backup.version).toBe(8);
    expect(backup.courses.map((c) => c.id).sort()).toEqual(["FCE", "游泳"]);
    await db.courses.clear();
    await taskRepository.importBackup(backup);
    expect((await db.courses.toArray()).map((c) => c.id).sort()).toEqual(["FCE", "游泳"]);
    // 旧版本备份（没有 courses 字段）：不清空现有课程
    await taskRepository.importBackup({ ...backup, version: 7, courses: undefined });
    expect(await db.courses.count()).toBe(2);
  });
});

describe("删除假期/课程：被解绑的任务刷新时间并上传", () => {
  it("3. 删除假期：任务改为全部阶段、updatedAt 刷新、返回被解绑的任务", async () => {
    await db.planPeriods.add(holiday("暑假"));
    await db.tasks.bulkAdd([task("a", { planPeriodId: "暑假", applicablePeriodType: "holiday" }), task("b")]);
    const affected = await taskRepository.removePlanPeriod("暑假");
    expect(affected).toEqual(["a"]);
    const a = (await db.tasks.get("a"))!;
    expect(a.planPeriodId).toBeUndefined();
    expect(a.applicablePeriodType).toBe("all");
    expect(a.updatedAt > OLD).toBe(true);
    expect((await db.tasks.get("b"))!.updatedAt).toBe(OLD);
  });

  it("4. 删除课程：任务解绑课程、updatedAt 刷新", async () => {
    await db.courses.add(course("FCE"));
    await db.tasks.add(task("a", { courseId: "FCE" }));
    expect(await taskRepository.removeCourse("FCE")).toEqual(["a"]);
    const a = (await db.tasks.get("a"))!;
    expect(a.courseId).toBeUndefined();
    expect(a.updatedAt > OLD).toBe(true);
  });

  it("5. 云端模式：删除假期/课程后把被解绑的任务上传（以前只删云端的假期/课程，任务下次拉取会被改回去）", async () => {
    cloudRepository.setFamilyId("fam");
    await db.planPeriods.add(holiday("暑假"));
    await db.courses.add(course("FCE"));
    await db.tasks.bulkAdd([task("a", { planPeriodId: "暑假", applicablePeriodType: "holiday" }), task("b", { courseId: "FCE" }), task("c")]);
    await cloudRepository.removePlanPeriod("暑假");
    await cloudRepository.removeCourse("FCE");
    expect(captured.deletes).toEqual(["plan_periods", "courses"]);
    const uploaded = (captured.upserts.tasks ?? []).map((row) => [row.id, row.plan_period_id ?? null, row.course_id ?? null]);
    expect(uploaded).toEqual([["a", null, null], ["b", null, null]]);
  });
});

describe("云端模式导入备份", () => {
  it("6. 导入后整体上传云端（任务与单日记录），不再只写本机", async () => {
    cloudRepository.setFamilyId("fam");
    const backup = {
      version: 8, exportedAt: OLD, planPeriods: [], courses: [], activityLogs: [], readingLogs: [],
      tasks: [task("x"), task("rec", { timeType: "recurring", schedulePattern: "dailyRecurring", date: undefined, recurrence: { frequency: "daily", startDate: "2026-11-01" } })],
      taskOccurrenceStatuses: [{ id: "rec:2026-11-10", taskId: "rec", occurrenceDate: "2026-11-10", status: "done", createdAt: OLD, updatedAt: OLD }],
    };
    await cloudRepository.importBackup(backup);
    expect((captured.upserts.tasks ?? []).map((row) => row.id).sort()).toEqual(["rec", "x"]);
    expect((captured.upserts.task_occurrence_statuses ?? []).map((row) => row.id)).toEqual(["rec:2026-11-10"]);
  });

  it("7. 本地模式导入不触发任何上传", async () => {
    await cloudRepository.importBackup({ version: 8, exportedAt: OLD, tasks: [task("x")], taskOccurrenceStatuses: [], planPeriods: [], courses: [], activityLogs: [], readingLogs: [] });
    expect(captured.upserts).toEqual({});
  });
});
