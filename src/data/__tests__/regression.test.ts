/**
 * 数据层回归测试（PROJECT_GUIDE 6.5 铁律 R1-R6）。
 * 只测本地数据层逻辑，IndexedDB 用 fake-indexeddb 模拟，不碰真实 Supabase。
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { taskRepository } from "../taskRepository";
import { lwwMerge } from "../cloudRepository";
import type { Task, TaskDraft, TaskDisplay } from "../../types/task";

const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayOffset = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return fmt(d);
};
const today = dayOffset(0);
const yesterday = dayOffset(-1);

const baseDraft = (overrides: Partial<Task> = {}): TaskDraft => ({
  title: "测试任务",
  mainCategory: "school",
  subCategory: "math",
  timeType: "singleDate",
  date: today,
  status: "todo",
  rolloverMode: "keepOverdue",
  allowRollover: false,
  childVisible: true,
  ...overrides,
} as TaskDraft);

const recurringDraft = (overrides: Partial<Task> = {}): TaskDraft =>
  baseDraft({ timeType: "recurring", schedulePattern: "dailyRecurring", date: undefined, startDate: dayOffset(-3), ...overrides });

beforeEach(async () => {
  await Promise.all([
    db.tasks.clear(),
    db.taskOccurrenceStatuses.clear(),
    db.activityLogs.clear(),
    db.planPeriods.clear(),
    db.readingLogs.clear(),
    db.courses.clear(),
  ]);
});

describe("R1 唯一权威源", () => {
  it("1. occurrence 类任务完成：写 occurrence 表，本体保持 todo、completedAt 为空", async () => {
    const { task } = await taskRepository.create(recurringDraft());
    await taskRepository.setDisplayStatus({ ...task, occurrenceDate: today } as TaskDisplay, "done");
    const occ = await db.taskOccurrenceStatuses.get(`${task.id}:${today}`);
    expect(occ?.status).toBe("done");
    const body = await db.tasks.get(task.id);
    expect(body?.status).toBe("todo");
    expect(body?.completedAt).toBeUndefined();
  });

  it("2. 非 occurrence 类任务完成：写本体 status+completedAt，不产生 occurrence 行", async () => {
    const { task } = await taskRepository.create(baseDraft());
    await taskRepository.setDisplayStatus(task as TaskDisplay, "done");
    const body = await db.tasks.get(task.id);
    expect(body?.status).toBe("done");
    expect(body?.completedAt).toBeTruthy();
    expect(await db.taskOccurrenceStatuses.count()).toBe(0);
  });

  it("3. 写入端防线：update 试图把 occurrence 类任务本体置 done 会被清洗回 todo", async () => {
    const { task } = await taskRepository.create(recurringDraft());
    await taskRepository.update(task.id, { status: "done" });
    const body = await db.tasks.get(task.id);
    expect(body?.status).toBe("todo");
    expect(body?.completedAt).toBeUndefined();
  });
});

describe("R2 occurrence 行是 patch 不是 put", () => {
  it("4. 完成一个已延期的 occurrence，overrideDate/overrideNote 保留", async () => {
    const { task } = await taskRepository.create(recurringDraft());
    await taskRepository.setOccurrence(task.id, today, "postponed", dayOffset(3), "延到周末");
    await taskRepository.setOccurrence(task.id, today, "done");
    const occ = await db.taskOccurrenceStatuses.get(`${task.id}:${today}`);
    expect(occ?.status).toBe("done");
    expect(occ?.overrideDate).toBe(dayOffset(3));
    expect(occ?.overrideNote).toBe("延到周末");
  });
});

describe("R3 展示字段永不落库", () => {
  it("5. create/update 带展示字段时，落库后字段被白名单清洗掉", async () => {
    const dirty = { ...baseDraft(), occurrenceDate: today, occurrenceStatus: "done", overrideDate: today, overrideNote: "x", rolledFromDate: yesterday };
    const { task } = await taskRepository.create(dirty as unknown as TaskDraft);
    let body = (await db.tasks.get(task.id)) as unknown as Record<string, unknown>;
    for (const key of ["occurrenceDate", "occurrenceStatus", "overrideDate", "overrideNote", "rolledFromDate"]) {
      expect(body[key], `create 后 ${key} 不应落库`).toBeUndefined();
    }
    await taskRepository.update(task.id, { note: "改一下", occurrenceDate: today } as unknown as Partial<TaskDraft>);
    body = (await db.tasks.get(task.id)) as unknown as Record<string, unknown>;
    expect(body.occurrenceDate).toBeUndefined();
    expect(body.note).toBe("改一下");
  });
});

describe("R4 overdue 是派生态", () => {
  it("6. 昨日未完成任务在读取时派生 overdue，数据库中仍是 todo", async () => {
    const { task } = await taskRepository.create(baseDraft({ date: yesterday }));
    const overdue = await taskRepository.getOverdueTasks(today);
    expect(overdue.map((t) => t.id)).toContain(task.id);
    expect(overdue.find((t) => t.id === task.id)?.status).toBe("overdue");
    expect((await db.tasks.get(task.id))?.status).toBe("todo");
  });
});

describe("R5 云同步不回滚新数据（LWW）", () => {
  const row = (id: string, updatedAt: string, status = "todo") =>
    ({ id, taskId: id.split(":")[0], occurrenceDate: today, status, createdAt: updatedAt, updatedAt }) as never;

  it("7. 云端 updatedAt 更旧：本地不被覆盖", async () => {
    await db.taskOccurrenceStatuses.put(row("t1:d", "2026-07-17T10:00:00.000Z", "done"));
    await lwwMerge(db.taskOccurrenceStatuses, [row("t1:d", "2026-07-17T09:00:00.000Z", "todo")]);
    expect((await db.taskOccurrenceStatuses.get("t1:d"))?.status).toBe("done");
  });

  it("8. 云端不更旧则覆盖，本地不存在则新增", async () => {
    await db.taskOccurrenceStatuses.put(row("t1:d", "2026-07-17T10:00:00.000Z", "todo"));
    await lwwMerge(db.taskOccurrenceStatuses, [
      row("t1:d", "2026-07-17T11:00:00.000Z", "done"),
      row("t2:d", "2026-07-17T08:00:00.000Z", "done"),
    ]);
    expect((await db.taskOccurrenceStatuses.get("t1:d"))?.status).toBe("done");
    expect((await db.taskOccurrenceStatuses.get("t2:d"))?.status).toBe("done");
  });

  it("9. remove 是软删除：写 deletedAt + 刷新 updatedAt，级联子任务，行不物理消失", async () => {
    const { task: parent } = await taskRepository.create(baseDraft({ title: "父任务" }));
    const { task: child } = await taskRepository.create(baseDraft({ title: "子任务", parentTaskId: parent.id }));
    const beforeUpdatedAt = (await db.tasks.get(parent.id))!.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    await taskRepository.remove(parent.id);
    const p = await db.tasks.get(parent.id);
    const c = await db.tasks.get(child.id);
    expect(p?.deletedAt).toBeTruthy();
    expect(c?.deletedAt).toBeTruthy();
    expect(p!.updatedAt > beforeUpdatedAt).toBe(true);
    expect(await db.tasks.count()).toBe(2);
  });
});

describe("R5 allocateTask 重排", () => {
  it("10. 旧的未完成子任务软删不硬删，已完成子任务保留", async () => {
    const { task: parent } = await taskRepository.create(baseDraft({
      title: "作业周期",
      timeType: "assignmentWindow",
      date: undefined,
      assignmentWindow: { startDate: today, endDate: dayOffset(6) },
      totalAmount: 2,
      splitCount: 2,
    }));
    await taskRepository.allocateTask(parent.id);
    const firstChildren = (await db.tasks.where("parentTaskId").equals(parent.id).toArray());
    expect(firstChildren).toHaveLength(2);
    await db.tasks.update(firstChildren[0].id, { status: "done", completedAt: new Date().toISOString() });

    await taskRepository.allocateTask(parent.id);
    const doneChild = await db.tasks.get(firstChildren[0].id);
    const staleChild = await db.tasks.get(firstChildren[1].id);
    expect(doneChild?.deletedAt).toBeUndefined();
    expect(staleChild?.deletedAt).toBeTruthy();
    const all = await db.tasks.where("parentTaskId").equals(parent.id).toArray();
    expect(all).toHaveLength(3);
    expect(all.filter((t) => !t.deletedAt)).toHaveLength(2);
  });
});

describe("R6 dateRange 整体任务语义", () => {
  it("11. dateRange 任务整体完成走本体，不产生 occurrence", async () => {
    const { task } = await taskRepository.create(baseDraft({
      timeType: "dateRange",
      date: undefined,
      startDate: dayOffset(-2),
      endDate: dayOffset(4),
    }));
    await taskRepository.setDisplayStatus(task as TaskDisplay, "done");
    const body = await db.tasks.get(task.id);
    expect(body?.status).toBe("done");
    expect(body?.completedAt).toBeTruthy();
    expect(await db.taskOccurrenceStatuses.count()).toBe(0);
  });
});

describe("checklist 联动", () => {
  const items = [
    { id: "i1", title: "小项1", done: false, sortOrder: 0 },
    { id: "i2", title: "小项2", done: false, sortOrder: 1 },
  ];

  it("12. 非 occurrence 任务：小项全勾本体自动 done，取消一项退回 todo", async () => {
    const { task } = await taskRepository.create(baseDraft({ checklistItems: items }));
    await taskRepository.toggleChecklistItem(task.id, "i1");
    expect((await db.tasks.get(task.id))?.status).toBe("todo");
    await taskRepository.toggleChecklistItem(task.id, "i2");
    let body = await db.tasks.get(task.id);
    expect(body?.status).toBe("done");
    expect(body?.completedAt).toBeTruthy();
    await taskRepository.toggleChecklistItem(task.id, "i2");
    body = await db.tasks.get(task.id);
    expect(body?.status).toBe("todo");
    expect(body?.completedAt).toBeUndefined();
  });

  it("13. occurrence 类任务：小项全勾写当日 occurrence，本体不动", async () => {
    const { task } = await taskRepository.create(recurringDraft({ checklistItems: items }));
    await taskRepository.toggleChecklistItem(task.id, "i1", today);
    await taskRepository.toggleChecklistItem(task.id, "i2", today);
    const occ = await db.taskOccurrenceStatuses.get(`${task.id}:${today}`);
    expect(occ?.status).toBe("done");
    const body = await db.tasks.get(task.id);
    expect(body?.status).toBe("todo");
    expect(body?.completedAt).toBeUndefined();
  });
});

describe("completedAt 一致性（2026-07-17 审查修复）", () => {
  it("16. update 状态改 done 补 completedAt，从 done 改回 todo 清除 completedAt", async () => {
    const { task } = await taskRepository.create(baseDraft());
    await taskRepository.update(task.id, { status: "done" });
    let body = await db.tasks.get(task.id);
    expect(body?.status).toBe("done");
    expect(body?.completedAt).toBeTruthy();
    await taskRepository.update(task.id, { status: "todo" });
    body = await db.tasks.get(task.id);
    expect(body?.status).toBe("todo");
    expect(body?.completedAt).toBeUndefined();
  });

  it("17b. create 直接以 done 状态新建时补齐 completedAt", async () => {
    const { task } = await taskRepository.create(baseDraft({ status: "done" }));
    const body = await db.tasks.get(task.id);
    expect(body?.status).toBe("done");
    expect(body?.completedAt).toBeTruthy();
  });

  it("17. copyToDate 复制已完成任务：副本无 completedAt/actualMinutes（含小项级）", async () => {
    const { task } = await taskRepository.create(baseDraft({
      checklistItems: [{ id: "i1", title: "小项", done: true, sortOrder: 0, actualMinutes: 15 }],
    }));
    await taskRepository.setDisplayStatus(task as TaskDisplay, "done");
    await db.tasks.update(task.id, { actualMinutes: 30 });
    const copy = await taskRepository.copyToDate(task.id, dayOffset(1));
    const body = await db.tasks.get(copy.id);
    expect(body?.status).toBe("todo");
    expect(body?.completedAt).toBeUndefined();
    expect(body?.actualMinutes).toBeUndefined();
    expect(body?.checklistItems?.[0].done).toBe(false);
    expect(body?.checklistItems?.[0].actualMinutes).toBeUndefined();
  });
});

describe("endDate 镜像 recurrence.endDate（2026-07-19 收口）", () => {
  it("18. dailyRecurring 创建/更新时本体 endDate 强制跟随 recurrence.endDate（含清空）", async () => {
    const end = dayOffset(30);
    const { task } = await taskRepository.create(recurringDraft({
      endDate: yesterday,
      recurrence: { frequency: "daily", startDate: dayOffset(-3), endDate: end },
    }));
    expect((await db.tasks.get(task.id))?.endDate).toBe(end);
    // recurrence.endDate 清空（长期）时本体 endDate 一并清空
    await taskRepository.update(task.id, { recurrence: { frequency: "daily", startDate: dayOffset(-3) } });
    expect((await db.tasks.get(task.id))?.endDate).toBeUndefined();
  });

  it("19. dateRangeDaily 不受镜像影响：本体 startDate/endDate 是权威源", async () => {
    const end = dayOffset(10);
    const { task } = await taskRepository.create(baseDraft({
      timeType: "recurring", schedulePattern: "dateRangeDaily", date: undefined,
      startDate: dayOffset(-2), endDate: end,
    }));
    expect((await db.tasks.get(task.id))?.endDate).toBe(end);
  });
});

describe("父子任务联动", () => {
  it("14. 子任务全部完成父任务自动 done，一个退回父任务回 todo", async () => {
    const { task: parent } = await taskRepository.create(baseDraft({ title: "父任务" }));
    const { task: c1 } = await taskRepository.create(baseDraft({ title: "子1", parentTaskId: parent.id }));
    const { task: c2 } = await taskRepository.create(baseDraft({ title: "子2", parentTaskId: parent.id }));
    await taskRepository.setDisplayStatus(c1 as TaskDisplay, "done");
    expect((await db.tasks.get(parent.id))?.status).toBe("todo");
    await taskRepository.setDisplayStatus(c2 as TaskDisplay, "done");
    expect((await db.tasks.get(parent.id))?.status).toBe("done");
    await taskRepository.setDisplayStatus({ ...c2, status: "done" } as TaskDisplay, "todo");
    const p = await db.tasks.get(parent.id);
    expect(p?.status).toBe("todo");
    expect(p?.completedAt).toBeUndefined();
  });
});
