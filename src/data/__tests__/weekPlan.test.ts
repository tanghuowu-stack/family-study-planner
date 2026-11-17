/**
 * 今日页拆成"今日任务"（原名"今天必须完成"）和"本周计划"（2026-11-17，第 1 步：只改显示，不动数据）。
 * 几天内做完（dateRange）的作业，截止日之前放本周计划；截止日当天回到今日任务；其他安排留在当天清单。
 * 时间固定 2026-11-17（周二）Asia/Shanghai；只假造 Date，不假造定时器（fake-indexeddb 依赖真实 setTimeout）。
 */
declare const process: { env: Record<string, string | undefined> };
process.env.TZ = "Asia/Shanghai";
import "fake-indexeddb/auto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { taskRepository } from "../taskRepository";
import type { Task, TaskDraft } from "../../types/task";
import { isWeekPlanTask, weekPlanDueLabel, weekPlanDueTone } from "../../utils/taskGrouping";

const TODAY = "2026-11-17";
const draft = (overrides: Partial<Task> = {}): TaskDraft => ({
  title: "大增语文课后作业", mainCategory: "extraHomework", subCategory: "chinese", extraContentType: "homework", timeType: "dateRange",
  startDate: "2026-11-15", endDate: "2026-11-21", status: "todo", rolloverMode: "keepOverdue", allowRollover: false, childVisible: true, ...overrides,
} as TaskDraft);

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-17T10:00:00+08:00")); });
afterAll(() => { vi.useRealTimers(); });
beforeEach(async () => {
  await Promise.all([db.tasks.clear(), db.taskOccurrenceStatuses.clear(), db.activityLogs.clear(), db.planPeriods.clear()]);
});

describe("哪些任务放本周计划", () => {
  it("1. 几天内做完：截止日之前放本周计划，截止日当天回到今日任务", () => {
    const task = { timeType: "dateRange" as const, mainCategory: "extraHomework" as const, endDate: "2026-11-21" };
    expect(isWeekPlanTask(task, "2026-11-17")).toBe(true);
    expect(isWeekPlanTask(task, "2026-11-20")).toBe(true);
    expect(isWeekPlanTask(task, "2026-11-21")).toBe(false);
  });

  it("2. 单日任务、重复任务、其他安排（旅游等）都不放本周计划", () => {
    expect(isWeekPlanTask({ timeType: "singleDate", mainCategory: "school", endDate: undefined }, TODAY)).toBe(false);
    expect(isWeekPlanTask({ timeType: "recurring", mainCategory: "extraHomework", endDate: "2026-12-31" }, TODAY)).toBe(false);
    expect(isWeekPlanTask({ timeType: "dateRange", mainCategory: "temporary", endDate: "2026-11-21" }, TODAY)).toBe(false);
  });

  it("3. 截止说明：今天 / 明天 / 同一周内说星期几 / 跨周说日期", () => {
    expect(weekPlanDueLabel("2026-11-17", TODAY)).toBe("今天截止");
    expect(weekPlanDueLabel("2026-11-18", TODAY)).toBe("明天截止");
    expect(weekPlanDueLabel("2026-11-21", TODAY)).toBe("周六截止");
    expect(weekPlanDueLabel("2026-11-22", TODAY)).toBe("周日截止");
    expect(weekPlanDueLabel("2026-11-24", TODAY)).toBe("11月24日截止");
    // 周六看下周一截止：只差 2 天但已经跨周，说日期免得误会成本周一
    expect(weekPlanDueLabel("2026-11-23", "2026-11-21")).toBe("11月23日截止");
  });

  it("3b. 截止标签颜色：今天截止红、明天截止琥珀、更晚主色（跨月也认得明天）", () => {
    expect(weekPlanDueTone("2026-11-17", TODAY)).toBe("today");
    expect(weekPlanDueTone("2026-11-18", TODAY)).toBe("soon");
    expect(weekPlanDueTone("2026-11-21", TODAY)).toBe("normal");
    expect(weekPlanDueTone("2026-12-01", "2026-11-30")).toBe("soon");
  });
});

describe("本周计划里早些天就做完的", () => {
  it("4. 前几天做完、还在日期范围内：后面每天都能在本周计划的已完成里看到；完成当天不重复给出", async () => {
    const { task } = await taskRepository.create(draft());
    await db.tasks.update(task.id, { status: "done", completedAt: "2026-11-16T20:00:00+08:00" });
    expect(await taskRepository.getWeekPlanDone("2026-11-16")).toEqual([]);
    expect((await taskRepository.getWeekPlanDone(TODAY)).map((t) => t.id)).toEqual([task.id]);
    expect((await taskRepository.getWeekPlanDone("2026-11-21")).map((t) => t.id)).toEqual([task.id]);
    expect(await taskRepository.getWeekPlanDone("2026-11-22")).toEqual([]);
    // 当天清单里不再出现（getTasksForDate 只在完成那天显示），不会两边都有
    expect((await taskRepository.getTasksForDate(TODAY)).map((t) => t.id)).not.toContain(task.id);
  });

  it("5. 没做完的、其他安排、不在今日清单显示的都不算", async () => {
    await taskRepository.create(draft({ title: "还没做" }));
    const { task: trip } = await taskRepository.create(draft({ title: "旅游", mainCategory: "temporary", subCategory: "travel", extraContentType: undefined }));
    const { task: hidden } = await taskRepository.create(draft({ title: "隐藏", childVisible: false }));
    for (const id of [trip.id, hidden.id]) await db.tasks.update(id, { status: "done", completedAt: "2026-11-16T20:00:00+08:00" });
    expect(await taskRepository.getWeekPlanDone(TODAY)).toEqual([]);
  });

  it("6. 今天看：没做完的本周作业仍由 getTasksForDate 给出（显示位置交给今日页按 isWeekPlanTask 分区）", async () => {
    const { task } = await taskRepository.create(draft());
    const shown = (await taskRepository.getTasksForDate(TODAY)).find((t) => t.id === task.id)!;
    expect(isWeekPlanTask(shown, TODAY)).toBe(true);
    const lastDay = (await taskRepository.getTasksForDate("2026-11-21")).find((t) => t.id === task.id)!;
    expect(isWeekPlanTask(lastDay, "2026-11-21")).toBe(false);
  });
});
