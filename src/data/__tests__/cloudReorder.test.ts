/**
 * cloudRepository.reorderTasks 云端同步回归测试。
 * Supabase 全程 mock（同 cloudUpload.test 模式），只断言 upsert 的行集合，不碰真实云端。
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ upserts: {} as Record<string, Record<string, unknown>[]> }));

vi.mock("../../lib/supabase", () => ({
  supabaseConfigured: true,
  supabase: {
    from: (table: string) => ({
      upsert: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
        (captured.upserts[table] ??= []).push(...(Array.isArray(rows) ? rows : [rows]));
        return Promise.resolve({ error: null });
      },
      select: () => ({
        eq: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
      }),
    }),
  },
}));

import { db } from "../db";
import { taskRepository } from "../taskRepository";
import { cloudRepository } from "../cloudRepository";

beforeEach(async () => {
  captured.upserts = {};
  await Promise.all([db.tasks.clear(), db.activityLogs.clear()]);
  cloudRepository.setFamilyId("fam-test");
});

describe("cloudRepository.reorderTasks", () => {
  it("本地写 sortOrder 后把受影响任务逐条 upsert 上云（含新 sort_order 与刷新的 updated_at）", async () => {
    const { task: a } = await taskRepository.create({ title: "A", mainCategory: "school", subCategory: "math", timeType: "singleDate", date: "2026-07-19", status: "todo", rolloverMode: "keepOverdue", allowRollover: false, childVisible: true });
    const { task: b } = await taskRepository.create({ title: "B", mainCategory: "school", subCategory: "math", timeType: "singleDate", date: "2026-07-19", status: "todo", rolloverMode: "keepOverdue", allowRollover: false, childVisible: true });
    captured.upserts = {}; // 只看 reorder 产生的上传
    await cloudRepository.reorderTasks([b.id, a.id]);
    const rows = captured.upserts["tasks"] ?? [];
    expect(rows.map((r) => [r.id, r.sort_order])).toEqual([[b.id, 0], [a.id, 1]]);
    const local = await db.tasks.get(a.id);
    expect(rows.find((r) => r.id === a.id)?.updated_at).toBe(local!.updatedAt);
  });

  it("未登录（无 familyId）时只写本地，不产生云端上传", async () => {
    cloudRepository.setFamilyId("");
    const { task } = await taskRepository.create({ title: "C", mainCategory: "school", subCategory: "math", timeType: "singleDate", date: "2026-07-19", status: "todo", rolloverMode: "keepOverdue", allowRollover: false, childVisible: true });
    captured.upserts = {};
    await cloudRepository.reorderTasks([task.id]);
    expect(captured.upserts["tasks"] ?? []).toEqual([]);
    expect((await db.tasks.get(task.id))?.sortOrder).toBe(0);
  });
});
