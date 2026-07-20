/**
 * 数据层回归测试（PROJECT_GUIDE 6.5 铁律 R1-R6）。
 * 只测本地数据层逻辑，IndexedDB 用 fake-indexeddb 模拟，不碰真实 Supabase。
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { taskRepository, scheduleOccursOn } from "../taskRepository";
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

describe("拖拽排序 reorderTasks（2026-07-19）", () => {
  it("20. 按数组顺序写 sortOrder=0..n-1 并刷新 updatedAt（R5 防 LWW 回滚）", async () => {
    const { task: a } = await taskRepository.create(baseDraft({ title: "A" }));
    const { task: b } = await taskRepository.create(baseDraft({ title: "B" }));
    const before = (await db.tasks.get(a.id))!.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    await taskRepository.reorderTasks([b.id, a.id]);
    const [ra, rb] = await Promise.all([db.tasks.get(a.id), db.tasks.get(b.id)]);
    expect(rb?.sortOrder).toBe(0);
    expect(ra?.sortOrder).toBe(1);
    expect(ra!.updatedAt > before).toBe(true);
  });

  it("21. 今日页顺序跟随：reorder 后 getTasksForDate 同分组内按新顺序返回", async () => {
    const { task: a } = await taskRepository.create(baseDraft({ title: "先建" }));
    const { task: b } = await taskRepository.create(baseDraft({ title: "后建" }));
    const { task: c } = await taskRepository.create(baseDraft({ title: "最后建" }));
    await taskRepository.reorderTasks([c.id, a.id, b.id]);
    const titles = (await taskRepository.getTasksForDate(today)).map((t) => t.title);
    expect(titles).toEqual(["最后建", "先建", "后建"]);
  });

  it("22. 拖拽作用域是今日页的学科合并分组（非管理页更细的 mainCategory:subCategory）：课外数学可拖到学校数学之前", async () => {
    const { task: extra } = await taskRepository.create(baseDraft({ title: "课外数学", mainCategory: "extraHomework", extraContentType: "homework" }));
    const { task: school } = await taskRepository.create(baseDraft({ title: "学校数学" }));
    await taskRepository.reorderTasks([extra.id, school.id]);
    const titles = (await taskRepository.getTasksForDate(today)).map((t) => t.title);
    expect(titles).toEqual(["课外数学", "学校数学"]);
  });

  it("23. 学科分组之间互不干扰：math 分组内拖拽不影响 chinese 分组任务的相对顺序", async () => {
    const { task: chineseA } = await taskRepository.create(baseDraft({ title: "语文A", subCategory: "chinese" }));
    const { task: chineseB } = await taskRepository.create(baseDraft({ title: "语文B", subCategory: "chinese" }));
    const { task: mathA } = await taskRepository.create(baseDraft({ title: "数学A" }));
    const { task: mathB } = await taskRepository.create(baseDraft({ title: "数学B" }));
    // 先显式确定 chinese 组内顺序（否则同分组同 defaultSortOrder + 同毫秒 createdAt，排序非确定，测试会 flaky）
    await taskRepository.reorderTasks([chineseA.id, chineseB.id]);
    // 再在 math 组内拖拽，验证不影响已确定的 chinese 顺序
    await taskRepository.reorderTasks([mathB.id, mathA.id]);
    const titles = (await taskRepository.getTasksForDate(today)).map((t) => t.title);
    expect(titles).toEqual(["语文A", "语文B", "数学B", "数学A"]);
  });
});

describe("计时/手填实际用时不被完成动作覆盖（2026-07-19 回归修复）", () => {
  it("24. 小项计时/手填实际用时落库后，用旧快照调 setDisplayStatus 整体标记完成，actualMinutes 不丢失", async () => {
    const { task } = await taskRepository.create(baseDraft({
      title: "带小项", checklistItems: [{ id: "i1", title: "小项", done: false, sortOrder: 0 }],
    }));
    // 模拟 UI 侧持有的旧快照（调用方在 actualMinutes 落库前拿到的 task 对象）
    const staleSnapshot = { ...task } as TaskDisplay;
    // 计时器 stop() 落库：只有小项级 actualMinutes 变化，task 本体这份旧快照并不知情
    await taskRepository.saveActualMinutes(task.id, "i1", 12);
    // 紧接着（不刷新 UI）用旧快照调用整体"标记为完成"——过去的 bug 会用旧快照的 checklistItems 覆盖掉刚保存的 actualMinutes
    await taskRepository.setDisplayStatus(staleSnapshot, "done");
    const after = await db.tasks.get(task.id);
    expect(after?.status).toBe("done");
    expect(after?.checklistItems?.[0].done).toBe(true);
    expect(after?.checklistItems?.[0].actualMinutes).toBe(12);
  });

  it("25. 手动输入实际用时（不触发完成动作）：任务级与小项级都能正确保存并读出", async () => {
    const { task: plain } = await taskRepository.create(baseDraft({ title: "无小项任务" }));
    await taskRepository.update(plain.id, { actualMinutes: 30 });
    expect((await db.tasks.get(plain.id))?.actualMinutes).toBe(30);

    const { task: withItem } = await taskRepository.create(baseDraft({
      title: "有小项任务", checklistItems: [{ id: "i2", title: "小项", done: false, sortOrder: 0 }],
    }));
    const current = await db.tasks.get(withItem.id);
    const items = current!.checklistItems!.map((item) => item.id === "i2" ? { ...item, actualMinutes: 8 } : item);
    await taskRepository.update(withItem.id, { checklistItems: items });
    expect((await db.tasks.get(withItem.id))?.checklistItems?.[0].actualMinutes).toBe(8);
  });
});

describe("结束长期重复任务 endRecurring（2026-07-20）", () => {
  it("26. 把 recurrence.endDate 设为昨天，当天起不再排期，本体与历史 occurrence 保留", async () => {
    const { task } = await taskRepository.create(recurringDraft({
      recurrence: { frequency: "daily", startDate: dayOffset(-5) },
    }));
    // 造一条历史完成 occurrence，验证结束后不被动
    await db.taskOccurrenceStatuses.put({ id: `${task.id}:${yesterday}`, taskId: task.id, occurrenceDate: yesterday, status: "done", createdAt: today, updatedAt: today } as never);

    await taskRepository.endRecurring(task.id, today);
    const after = await db.tasks.get(task.id);
    expect(after?.recurrence?.endDate).toBe(yesterday);
    expect(after?.endDate).toBe(yesterday);       // §3.2 镜像：本体 endDate 同步
    expect(after?.deletedAt).toBeUndefined();      // 本体不删
    expect(scheduleOccursOn(after!, today)).toBe(false);     // 今天起不再排期
    expect(scheduleOccursOn(after!, yesterday)).toBe(true);  // 昨天仍在排期
    // 历史 occurrence 完整保留
    expect((await db.taskOccurrenceStatuses.get(`${task.id}:${yesterday}`))?.status).toBe("done");
  });

  it("27. 非重复任务调用 endRecurring 抛错，不误伤", async () => {
    const { task } = await taskRepository.create(baseDraft());
    await expect(taskRepository.endRecurring(task.id, today)).rejects.toThrow();
  });
});

describe("时间字段 time/startTime 镜像（2026-07-20 修复：清空时间保存后旧值复活）", () => {
  it("28. update 清空 startTime 时，遗留的旧 time 字段一并清除，不再通过 ?? 兜底复活", async () => {
    const { task } = await taskRepository.create(baseDraft({ startTime: "14:25" }));
    // 模拟迁移前遗留的脏数据：time 独立残留旧值（真实场景是这次修复前的代码从未把它同步清掉）
    await db.tasks.update(task.id, { time: "14:25" } as never);
    await taskRepository.update(task.id, { startTime: undefined });
    const after = await db.tasks.get(task.id);
    expect(after?.startTime).toBeUndefined();
    expect(after?.time).toBeUndefined(); // 关键断言：不再独立残留，否则展示层 startTime ?? time 会把旧时间复活
  });

  it("29. create/update 始终让 time 镜像 startTime，不会再渐行渐远", async () => {
    const { task } = await taskRepository.create(baseDraft({ startTime: "09:00" }));
    expect(task.time).toBe("09:00");
    const { task: updated } = await taskRepository.update(task.id, { startTime: "10:30" });
    expect(updated.time).toBe("10:30");
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
