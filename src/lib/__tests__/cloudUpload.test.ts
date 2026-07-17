/**
 * cloudUpload occurrence 上传过滤回归测试（2026-07-17 建立的防线）。
 * Supabase 全程 mock，只断言上传的行集合，不碰真实云端。
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ upserts: {} as Record<string, Record<string, unknown>[]> }));

vi.mock("../supabase", () => ({
  supabaseConfigured: true,
  supabase: {
    from: (table: string) => ({
      upsert: (rows: Record<string, unknown>[]) => {
        (captured.upserts[table] ??= []).push(...rows);
        return Promise.resolve({ error: null });
      },
    }),
  },
}));

import { db } from "../../data/db";
import { uploadLocalDataToCloud } from "../cloudUpload";
import type { Task, TaskOccurrenceStatus } from "../../types/task";

const now = new Date().toISOString();
const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id,
  title: id,
  mainCategory: "school",
  subCategory: "math",
  timeType: "singleDate",
  date: "2026-07-17",
  status: "todo",
  rolloverMode: "keepOverdue",
  allowRollover: false,
  childVisible: true,
  createdAt: now,
  updatedAt: now,
  ...overrides,
} as Task);
const occ = (taskId: string, date: string): TaskOccurrenceStatus => ({
  id: `${taskId}:${date}`,
  taskId,
  occurrenceDate: date,
  status: "done",
  createdAt: now,
  updatedAt: now,
});

beforeEach(async () => {
  captured.upserts = {};
  await Promise.all([db.tasks.clear(), db.taskOccurrenceStatuses.clear(), db.planPeriods.clear(), db.courses.clear()]);
});

describe("cloudUpload occurrence 过滤（A 类违规行不上传）", () => {
  it("15. 跳过非 occurrence 类任务和已软删任务名下的行，正常行照常上传", async () => {
    await db.tasks.bulkAdd([
      task("rec-ok", { timeType: "recurring", schedulePattern: "dailyRecurring", date: undefined, startDate: "2026-07-01" }),
      task("range-bad", { timeType: "dateRange", date: undefined, startDate: "2026-07-01", endDate: "2026-07-10" }),
      task("rec-deleted", { timeType: "recurring", schedulePattern: "dailyRecurring", date: undefined, startDate: "2026-07-01", deletedAt: now }),
    ]);
    await db.taskOccurrenceStatuses.bulkAdd([
      occ("rec-ok", "2026-07-16"),
      occ("range-bad", "2026-07-05"),
      occ("rec-deleted", "2026-07-08"),
    ]);

    const result = await uploadLocalDataToCloud("fam-test");

    const uploadedIds = (captured.upserts["task_occurrence_statuses"] ?? []).map((r) => r.id);
    expect(uploadedIds).toEqual(["rec-ok:2026-07-16"]);
    expect(result.occurrenceStatuses).toBe(1);
    expect(result.skippedDirtyOccurrences).toBe(2);
    expect((captured.upserts["tasks"] ?? []).length).toBe(3);
  });
});
