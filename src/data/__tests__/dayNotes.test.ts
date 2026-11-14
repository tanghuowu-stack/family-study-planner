/**
 * 每日记录（2026-11-14）：今日页标题后的小本子，按查看日写"这次具体做了什么"。
 * 存 Task.dayNotes（metadata jsonb），不加列。Supabase 全程 mock，只断言上传了哪些行。
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import type { Task } from "../../types/task";

const OLD = "2026-01-01T00:00:00.000Z";
const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id, title: "FCE听力/语用/阅读", mainCategory: "extraHomework", subCategory: "english", extraContentType: "homework",
  timeType: "recurring", schedulePattern: "dailyRecurring", recurrence: { frequency: "daily", startDate: "2026-11-01" },
  status: "todo", rolloverMode: "keepOverdue", allowRollover: false, childVisible: true, createdAt: OLD, updatedAt: OLD, ...overrides,
} as Task);

beforeEach(async () => {
  captured.upserts = {};
  await Promise.all([db.tasks.clear(), db.taskOccurrenceStatuses.clear(), db.activityLogs.clear()]);
  cloudRepository.setFamilyId("");
});

describe("本地：按天写记录", () => {
  it("1. 写入、修改、清空即删除那一天；最后一天删完字段变回 undefined；每次写都刷新 updatedAt", async () => {
    await db.tasks.add(task("t"));
    const onLocalWrite = vi.fn();
    expect(await taskRepository.setDayNote("t", "2026-11-13", "  听力 Part 1 ", onLocalWrite)).toBe(true);
    expect(onLocalWrite).toHaveBeenCalledTimes(1);
    await taskRepository.setDayNote("t", "2026-11-14", "语用2篇");
    let saved = (await db.tasks.get("t"))!;
    expect(saved.dayNotes).toEqual({ "2026-11-13": "听力 Part 1", "2026-11-14": "语用2篇" });
    expect(saved.updatedAt > OLD).toBe(true);

    await taskRepository.setDayNote("t", "2026-11-14", "语用2篇 + 阅读1篇");
    await taskRepository.setDayNote("t", "2026-11-13", "   ");
    saved = (await db.tasks.get("t"))!;
    expect(saved.dayNotes).toEqual({ "2026-11-14": "语用2篇 + 阅读1篇" });

    await taskRepository.setDayNote("t", "2026-11-14", "");
    expect((await db.tasks.get("t"))!.dayNotes).toBeUndefined();
  });

  it("2. 内容没变不写库（updatedAt 不动）；超长截到 200 字", async () => {
    await db.tasks.add(task("t", { dayNotes: { "2026-11-14": "语用2篇" } }));
    await taskRepository.setDayNote("t", "2026-11-14", "语用2篇 ");
    expect((await db.tasks.get("t"))!.updatedAt).toBe(OLD);
    await taskRepository.setDayNote("t", "2026-11-15", "字".repeat(260));
    expect((await db.tasks.get("t"))!.dayNotes!["2026-11-15"]).toHaveLength(200);
  });

  it("3. 编辑表单保存其它字段不丢记录；复制到别的日期的副本不带记录", async () => {
    await db.tasks.add(task("t", { dayNotes: { "2026-11-14": "语用2篇" } }));
    await taskRepository.update("t", { title: "FCE 综合" });
    expect((await db.tasks.get("t"))!.dayNotes).toEqual({ "2026-11-14": "语用2篇" });
    const copy = await taskRepository.copyToDate("t", "2026-11-20");
    expect(copy.dayNotes).toBeUndefined();
  });

  it("4. 今日页读到的任务带着记录", async () => {
    await db.tasks.add(task("t", { dayNotes: { "2026-11-14": "语用2篇" } }));
    const [shown] = await taskRepository.getTasksForDate("2026-11-14");
    expect(shown.dayNotes?.["2026-11-14"]).toBe("语用2篇");
  });
});

describe("云端模式", () => {
  it("5. 先写本机再上传，上传的行 metadata 里带记录；内容没变不上传", async () => {
    cloudRepository.setFamilyId("fam");
    await db.tasks.add(task("t"));
    const onLocalWrite = vi.fn();
    expect(await cloudRepository.setDayNote("t", "2026-11-14", "语用2篇", onLocalWrite)).toBe(true);
    expect(onLocalWrite).toHaveBeenCalledTimes(1);
    expect(captured.upserts.tasks).toHaveLength(1);
    expect(captured.upserts.tasks[0].metadata).toEqual({ dayNotes: { "2026-11-14": "语用2篇" } });

    await cloudRepository.setDayNote("t", "2026-11-14", "语用2篇");
    expect(captured.upserts.tasks).toHaveLength(1);
  });

  it("6. 本地模式下不上传", async () => {
    await db.tasks.add(task("t"));
    await cloudRepository.setDayNote("t", "2026-11-14", "语用2篇");
    expect(captured.upserts).toEqual({});
  });
});
