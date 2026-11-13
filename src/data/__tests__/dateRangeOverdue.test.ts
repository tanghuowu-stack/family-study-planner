/**
 * 几天内做完（dateRange）过了截止日还没做完 → 进逾期区（2026-11-13 用户定）。
 * 以前它既不顺延也不进逾期，过了截止日就从今日页消失。
 * 时间固定 2026-11-16（周一）Asia/Shanghai；只假造 Date，不假造定时器（fake-indexeddb 依赖真实 setTimeout）。
 */
declare const process: { env: Record<string, string | undefined> };
process.env.TZ = "Asia/Shanghai";
import "fake-indexeddb/auto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { taskRepository } from "../taskRepository";
import type { Task, TaskDisplay, TaskDraft } from "../../types/task";

const TODAY = "2026-11-16";
const weekend = (overrides: Partial<Task> = {}): TaskDraft => ({
  title: "周末作业", mainCategory: "school", subCategory: "chinese", timeType: "dateRange", startDate: "2026-11-13", endDate: "2026-11-15",
  status: "todo", rolloverMode: "keepOverdue", allowRollover: false, childVisible: true, ...overrides,
} as TaskDraft);
const titles = (tasks: TaskDisplay[]) => tasks.map((task) => task.title);

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-16T10:00:00+08:00")); });
afterAll(() => { vi.useRealTimers(); });
beforeEach(async () => {
  await Promise.all([db.tasks.clear(), db.taskOccurrenceStatuses.clear(), db.activityLogs.clear(), db.planPeriods.clear()]);
});

describe("几天内做完的任务过了截止日", () => {
  it("1. 截止日之后还没做完：进逾期区，状态 overdue，原定日期记为截止日", async () => {
    await taskRepository.create(weekend());
    const overdue = await taskRepository.getOverdueTasks(TODAY);
    expect(titles(overdue)).toEqual(["周末作业"]);
    expect(overdue[0].status).toBe("overdue");
    expect(overdue[0].rolledFromDate).toBe("2026-11-15");
    // 主清单里不出现（不在日期范围内），只在逾期区提醒，不会重复
    expect(titles(await taskRepository.getTasksForDate(TODAY))).toEqual([]);
  });

  it("2. 截止日当天及以前不算逾期", async () => {
    await taskRepository.create(weekend());
    expect(await taskRepository.getOverdueTasks("2026-11-15")).toEqual([]);
    expect(titles(await taskRepository.getTasksForDate("2026-11-15"))).toEqual(["周末作业"]);
  });

  it("3. 选了\"挪到第二天\"的同样进逾期区；选了\"当天没做就算了\"的不提醒；已完成、已取消、其他安排（旅游等）不进", async () => {
    await taskRepository.create(weekend({ title: "挪到第二天", rolloverMode: "autoNextDay", allowRollover: true }));
    await taskRepository.create(weekend({ title: "没做就算了", rolloverMode: "skipIfMissed" }));
    await taskRepository.create(weekend({ title: "已取消", status: "cancelled" }));
    await taskRepository.create(weekend({ title: "周末旅游", mainCategory: "temporary", subCategory: "travel" })); // 其他安排：一段时间的安排，不是作业
    const { task: done } = await taskRepository.create(weekend({ title: "按时做完" }));
    await taskRepository.setDisplayStatus({ ...done } as TaskDisplay, "done", "2026-11-14");
    expect(titles(await taskRepository.getOverdueTasks(TODAY))).toEqual(["挪到第二天"]);
  });

  it("4. 在逾期区补完：离开逾期区，补完那天出现在当天的已完成里，第二天不再出现", async () => {
    const { task } = await taskRepository.create(weekend({ rolloverMode: "autoNextDay", allowRollover: true }));
    const [row] = await taskRepository.getOverdueTasks(TODAY);
    await taskRepository.setDisplayStatus(row, "done", TODAY);
    expect(await taskRepository.getOverdueTasks(TODAY)).toEqual([]);
    const todayList = await taskRepository.getTasksForDate(TODAY);
    expect(todayList.map((item) => [item.id, item.status])).toEqual([[task.id, "done"]]);
    expect(await taskRepository.getTasksForDate("2026-11-17")).toEqual([]);
    // 截止前那几天翻回去仍显示当时没做完（完成日在那之后）
    expect((await taskRepository.getTasksForDate("2026-11-14"))[0].status).toBe("todo");
  });

  it("5. 单日任务的逾期与顺延规则不变", async () => {
    await taskRepository.create(weekend({ title: "单日逾期", timeType: "singleDate", date: "2026-11-14", startDate: undefined, endDate: undefined }));
    await taskRepository.create(weekend({ title: "单日顺延", timeType: "singleDate", date: "2026-11-14", startDate: undefined, endDate: undefined, rolloverMode: "autoNextDay", allowRollover: true }));
    expect(titles(await taskRepository.getOverdueTasks(TODAY))).toEqual(["单日逾期"]);
    expect(titles(await taskRepository.getTasksForDate(TODAY))).toEqual(["单日顺延"]);
  });
});
