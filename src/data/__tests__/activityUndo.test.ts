/**
 * activityUndo 回归测试（2026-08-12，"最近操作记录"撤回功能）。
 * 只测本地数据层逻辑，不碰真实 Supabase（本地模式下 getRepository() 解析为 taskRepository）。
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { taskRepository } from "../taskRepository";
import { canUndoActivityLog, undoActivityLog } from "../activityUndo";
import type { ActivityLog, Task, TaskDraft } from "../../types/task";

const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayOffset = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return fmt(d); };
const today = dayOffset(0);

const baseDraft = (overrides: Partial<Task> = {}): TaskDraft => ({
  title: "测试任务", mainCategory: "school", subCategory: "math", timeType: "singleDate",
  date: today, status: "todo", rolloverMode: "keepOverdue", allowRollover: false, childVisible: true,
  ...overrides,
} as TaskDraft);
const recurringDraft = (overrides: Partial<Task> = {}): TaskDraft =>
  baseDraft({ timeType: "recurring", schedulePattern: "dailyRecurring", date: undefined, startDate: dayOffset(-3), recurrence: { frequency: "daily", startDate: dayOffset(-3) }, ...overrides });

const lastLog = async (): Promise<ActivityLog> => {
  const logs = await taskRepository.listActivityLogs(1);
  return logs[0];
};

beforeEach(async () => {
  await Promise.all([db.tasks.clear(), db.taskOccurrenceStatuses.clear(), db.activityLogs.clear()]);
});

describe("canUndoActivityLog", () => {
  it("1. 拖拽排序（edit 但无 entityId）不可撤回", async () => {
    const { task: a } = await taskRepository.create(baseDraft({ title: "a" }));
    const { task: b } = await taskRepository.create(baseDraft({ title: "b" }));
    await taskRepository.reorderTasks([b.id, a.id]);
    expect(canUndoActivityLog(await lastLog())).toBe(false);
  });

  it("2. 假期/课程/阅读旧记录/导入导出一律不可撤回", async () => {
    const holidayLog: ActivityLog = { id: "x", actionType: "createHoliday", entityType: "planPeriod", actorName: "", deviceType: "", deviceLabel: "", browser: "", createdAt: today };
    const readingLog: ActivityLog = { id: "y", actionType: "recordReading", entityType: "readingLog", actorName: "", deviceType: "", deviceLabel: "", browser: "", createdAt: today };
    expect(canUndoActivityLog(holidayLog)).toBe(false);
    expect(canUndoActivityLog(readingLog)).toBe(false);
  });
});

describe("task 类撤回", () => {
  it("3. 撤回新建 = 软删该任务", async () => {
    const { task } = await taskRepository.create(baseDraft());
    const log = await lastLog();
    expect(log.actionType).toBe("create");
    expect(canUndoActivityLog(log)).toBe(true);
    await undoActivityLog(log);
    expect((await db.tasks.get(task.id))?.deletedAt).toBeTruthy();
  });

  it("4. 撤回删除 = 恢复；撤回恢复 = 重新软删", async () => {
    const { task } = await taskRepository.create(baseDraft());
    await taskRepository.remove(task.id);
    const deleteLog = await lastLog();
    expect(deleteLog.actionType).toBe("delete");
    await undoActivityLog(deleteLog);
    expect((await db.tasks.get(task.id))?.deletedAt).toBeUndefined();

    await taskRepository.remove(task.id);
    await taskRepository.restore(task.id);
    const restoreLog = await lastLog();
    expect(restoreLog.actionType).toBe("restore");
    await undoActivityLog(restoreLog);
    expect((await db.tasks.get(task.id))?.deletedAt).toBeTruthy();
  });

  it("5. 撤回编辑：字段精确复原到编辑前", async () => {
    const { task } = await taskRepository.create(baseDraft({ title: "原标题", note: "原备注" }));
    await taskRepository.update(task.id, { title: "改过的标题", note: "改过的备注" });
    const log = await lastLog();
    expect(log.actionType).toBe("edit");
    await undoActivityLog(log);
    const after = await db.tasks.get(task.id);
    expect(after?.title).toBe("原标题");
    expect(after?.note).toBe("原备注");
  });

  it("6. 撤回完成：不仅状态退回 todo，且不残留 completedAt（不是 update() 的智能联动，是精确复原）", async () => {
    const { task } = await taskRepository.create(baseDraft());
    await taskRepository.setDisplayStatus(task as never, "done");
    const log = await lastLog();
    expect(log.actionType).toBe("complete");
    await undoActivityLog(log);
    const after = await db.tasks.get(task.id);
    expect(after?.status).toBe("todo");
    expect(after?.completedAt).toBeUndefined();
  });

  it("7. 撤回取消完成：恢复到 done 且原始 completedAt 原样复原（不是 update() 联动出的 now）", async () => {
    const { task } = await taskRepository.create(baseDraft());
    await taskRepository.setDisplayStatus(task as never, "done");
    const originalCompletedAt = (await db.tasks.get(task.id))?.completedAt;
    expect(originalCompletedAt).toBeTruthy();
    await new Promise((r) => setTimeout(r, 5)); // 确保"现在"的时间戳与原始 completedAt 不同，能证伪"被联动逻辑覆盖成 now"
    await taskRepository.setDisplayStatus(task as never, "todo");
    const log = await lastLog();
    expect(log.actionType).toBe("uncomplete");
    await undoActivityLog(log);
    const after = await db.tasks.get(task.id);
    expect(after?.status).toBe("done");
    expect(after?.completedAt).toBe(originalCompletedAt); // 精确等于原值，不是重新生成的 now
  });
});

describe("taskOccurrence 类撤回", () => {
  it("8. 撤回单日完成：occurrence 退回未完成前的状态（含保留 override 字段）", async () => {
    const { task } = await taskRepository.create(recurringDraft());
    await taskRepository.setOccurrence(task.id, today, "postponed", dayOffset(3), "备注");
    await taskRepository.setOccurrence(task.id, today, "done");
    const log = await lastLog();
    expect(log.actionType).toBe("complete");
    expect(log.entityType).toBe("taskOccurrence");
    await undoActivityLog(log);
    const occ = await db.taskOccurrenceStatuses.get(`${task.id}:${today}`);
    expect(occ?.status).toBe("postponed");
    expect(occ?.overrideDate).toBe(dayOffset(3)); // R2：撤回后 override 字段仍保留
  });

  it("9. 撤回取消本次：恢复成取消前的状态", async () => {
    const { task } = await taskRepository.create(recurringDraft());
    await taskRepository.setOccurrence(task.id, today, "done");
    await taskRepository.setOccurrence(task.id, today, "cancelled");
    const log = await lastLog();
    expect(log.actionType).toBe("cancelOccurrence");
    await undoActivityLog(log);
    expect((await db.taskOccurrenceStatuses.get(`${task.id}:${today}`))?.status).toBe("done");
  });
});

describe("批量删除撤回", () => {
  it("10. 撤回批量删除 = 全部恢复", async () => {
    const { task: a } = await taskRepository.create(baseDraft({ title: "a" }));
    const { task: b } = await taskRepository.create(baseDraft({ title: "b" }));
    await taskRepository.batchRemove([a.id, b.id]);
    const log = await lastLog();
    expect(log.actionType).toBe("batchDelete");
    expect(canUndoActivityLog(log)).toBe(true);
    await undoActivityLog(log);
    expect((await db.tasks.get(a.id))?.deletedAt).toBeUndefined();
    expect((await db.tasks.get(b.id))?.deletedAt).toBeUndefined();
  });
});
