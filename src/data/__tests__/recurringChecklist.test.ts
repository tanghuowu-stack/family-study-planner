/**
 * 重复任务的小项按天记录（2026-11-13）：
 * 小项是所有日子共用的一份，以前今天勾过的小项明天打开还是勾着的；现在某天只有"在这一天勾的"才显示已勾。
 * 时间固定 2026-11-12（周四）Asia/Shanghai；只假造 Date，不假造定时器（fake-indexeddb 依赖真实 setTimeout）。
 */
declare const process: { env: Record<string, string | undefined> };
process.env.TZ = "Asia/Shanghai";
import "fake-indexeddb/auto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { taskRepository } from "../taskRepository";
import type { Task, TaskDisplay, TaskDraft } from "../../types/task";

const MON = "2026-11-09", TUE = "2026-11-10", WED = "2026-11-11", THU = "2026-11-12";
const daily = (overrides: Partial<Task> = {}): TaskDraft => ({
  title: "英语听写与跟读", mainCategory: "extraHomework", subCategory: "english", extraContentType: "homework",
  timeType: "recurring", schedulePattern: "dailyRecurring", recurrence: { frequency: "daily", startDate: MON },
  status: "todo", rolloverMode: "skipIfMissed", allowRollover: false, childVisible: true,
  checklistItems: [
    { id: "a", title: "单词听写", done: false, sortOrder: 0 },
    { id: "b", title: "课文跟读", done: false, sortOrder: 1 },
  ],
  ...overrides,
} as TaskDraft);

/** 某天今日页上这条任务的样子："状态|小项勾选"，如 "done|✓✓" */
const view = async (date: string, id: string) => {
  const task = (await taskRepository.getTasksForDate(date)).find((item) => item.id === id);
  if (!task) return "(不在)";
  return `${task.status}|${(task.checklistItems ?? []).map((item) => (item.done ? "✓" : "·")).join("")}`;
};
/** 按今日页真实路径勾小项：用那天展示出来的单日日期，目标状态 = 界面上看到的取反 */
const tick = async (date: string, id: string, itemId: string) => {
  const shown = (await taskRepository.getTasksForDate(date)).find((item) => item.id === id)!;
  const done = !shown.checklistItems!.find((item) => item.id === itemId)!.done;
  await taskRepository.toggleChecklistItem(id, itemId, shown.occurrenceDate, { asOfDate: date, done });
};
const occurrence = async (id: string, date: string) => (await db.taskOccurrenceStatuses.get(`${id}:${date}`))?.status ?? "todo";

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-12T10:00:00+08:00")); });
afterAll(() => { vi.useRealTimers(); });
beforeEach(async () => {
  await Promise.all([db.tasks.clear(), db.taskOccurrenceStatuses.clear(), db.activityLogs.clear(), db.planPeriods.clear()]);
});

describe("重复任务的小项每天从空白开始", () => {
  it("1. 周一勾完两项：周一完成；周二、周三打开都是空白、未完成", async () => {
    const { task } = await taskRepository.create(daily());
    await tick(MON, task.id, "a");
    await tick(MON, task.id, "b");
    expect(await view(MON, task.id)).toBe("done|✓✓");
    expect(await occurrence(task.id, MON)).toBe("done");
    expect(await view(TUE, task.id)).toBe("todo|··");
    expect(await view(THU, task.id)).toBe("todo|··");
  });

  it("2. 某天是否完成只看这一天勾的：周一勾 a、周二勾 b，周二不算完成", async () => {
    const { task } = await taskRepository.create(daily());
    await tick(MON, task.id, "a");
    await tick(TUE, task.id, "b");
    expect(await view(TUE, task.id)).toBe("todo|·✓");
    expect(await occurrence(task.id, TUE)).toBe("todo");
    await tick(TUE, task.id, "a");
    expect(await view(TUE, task.id)).toBe("done|✓✓");
    expect(await occurrence(task.id, TUE)).toBe("done");
  });

  it("3. 取消勾选只清这一天勾的：周二取消 b 不影响周三勾的 a", async () => {
    const { task } = await taskRepository.create(daily());
    await tick(WED, task.id, "a");
    await tick(TUE, task.id, "b");
    await tick(TUE, task.id, "b"); // 周二取消
    expect(await view(TUE, task.id)).toBe("todo|··");
    expect(await view(WED, task.id)).toBe("todo|✓·");
    // 周二页面上 a 显示未勾；不带目标状态的取消调用也不会把周三那一勾清掉
    await taskRepository.toggleChecklistItem(task.id, "a", TUE, { asOfDate: TUE, done: false });
    expect(await view(WED, task.id)).toBe("todo|✓·");
  });

  it("4. 整体勾完成：这一天的小项一起显示已勾（不再出现\"已完成但小项 0/2\"）；取消整体完成清掉这一天的小项", async () => {
    const { task } = await taskRepository.create(daily());
    await tick(MON, task.id, "a");
    const thursday = (await taskRepository.getTasksForDate(THU)).find((item) => item.id === task.id)!;
    await taskRepository.setDisplayStatus(thursday, "done", THU);
    expect(await view(THU, task.id)).toBe("done|✓✓");
    expect(await occurrence(task.id, THU)).toBe("done");
    expect(await view(WED, task.id)).toBe("todo|··");
    await taskRepository.setDisplayStatus({ ...thursday, status: "done" }, "todo", THU);
    expect(await view(THU, task.id)).toBe("todo|··");
    expect(await occurrence(task.id, THU)).toBe("todo");
    // R1：本体状态始终不动
    expect((await db.tasks.get(task.id))!.status).toBe("todo");
  });

  it("5. 已知边界：每个小项只记最后一次勾选日——周一勾完、周二又勾 a，翻回周一 a 显示未勾，但周一仍记为完成", async () => {
    const { task } = await taskRepository.create(daily());
    await tick(MON, task.id, "a");
    await tick(MON, task.id, "b");
    await tick(TUE, task.id, "a");
    expect(await occurrence(task.id, MON)).toBe("done");
    expect(await view(MON, task.id)).toBe("done|·✓");
    expect(await view(TUE, task.id)).toBe("todo|✓·");
  });

  it("6. 非重复任务不受影响：几天内做完的任务小项照旧跨天保留", async () => {
    const { task } = await taskRepository.create(daily({ title: "周末作业", timeType: "dateRange", schedulePattern: "singleDate", recurrence: undefined, startDate: TUE, endDate: THU, rolloverMode: "keepOverdue" }));
    await tick(TUE, task.id, "a");
    expect(await view(THU, task.id)).toBe("todo|✓·");
  });

  it("7. 编辑入口 getTask 读到的是库里的本体，不是某一天的展示快照", async () => {
    const { task } = await taskRepository.create(daily());
    await tick(MON, task.id, "a");
    const shownTue = (await taskRepository.getTasksForDate(TUE)).find((item) => item.id === task.id)!;
    expect(shownTue.checklistItems!.find((item) => item.id === "a")!.done).toBe(false);
    const stored = await taskRepository.getTask(task.id);
    expect(stored!.checklistItems!.find((item) => item.id === "a")).toMatchObject({ done: true, completedDate: MON });
    expect((stored as TaskDisplay).occurrenceDate).toBeUndefined();
  });
});
