/**
 * 本周回看（getWeekReview）回归测试。
 * 时间固定为 2026-11-12（周四）Asia/Shanghai，本周 = 11-09（周一）~ 11-15（周日）。
 * 只假造 Date，不假造定时器（fake-indexeddb 依赖真实的 setTimeout）。
 */
declare const process: { env: Record<string, string | undefined> };
process.env.TZ = "Asia/Shanghai";
import "fake-indexeddb/auto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { taskRepository } from "../taskRepository";
import { getWeekReview } from "../weekReview";
import type { Task, TaskDisplay, TaskDraft } from "../../types/task";

const TODAY = "2026-11-12";
const draft = (overrides: Partial<Task> = {}): TaskDraft => ({
  title: "测试任务", mainCategory: "school", subCategory: "math", timeType: "singleDate", date: TODAY,
  status: "todo", rolloverMode: "keepOverdue", allowRollover: false, childVisible: true, ...overrides,
} as TaskDraft);
const counts = (review: Awaited<ReturnType<typeof getWeekReview>>) =>
  Object.fromEntries(review.days.map((day) => [day.date.slice(5), `${day.done}/${day.total}`]));

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-12T10:00:00+08:00")); });
afterAll(() => { vi.useRealTimers(); });
beforeEach(async () => {
  await Promise.all([db.tasks.clear(), db.taskOccurrenceStatuses.clear(), db.activityLogs.clear(), db.planPeriods.clear()]);
});

describe("getWeekReview 本周回看", () => {
  it("1. 周一到周日 7 天；单日任务按自己那天计数，未来的日子只计总数、不进未完成清单", async () => {
    const { task: mon } = await taskRepository.create(draft({ title: "周一作业", date: "2026-11-09" }));
    await taskRepository.create(draft({ title: "周二作业", date: "2026-11-10" }));
    await taskRepository.create(draft({ title: "周五作业", date: "2026-11-13" }));
    await taskRepository.setDisplayStatus({ ...mon } as TaskDisplay, "done", "2026-11-09");

    const review = await getWeekReview(TODAY, TODAY);
    expect(review.weekStart).toBe("2026-11-09");
    expect(review.weekEnd).toBe("2026-11-15");
    expect(counts(review)).toMatchObject({ "11-09": "1/1", "11-10": "0/1", "11-13": "0/1" });
    expect(review.days.find((day) => day.date === "2026-11-13")?.isFuture).toBe(true);
    expect(review.days.find((day) => day.date === TODAY)?.isToday).toBe(true);
    expect(review.unfinished.map((item) => item.title)).toEqual(["周二作业"]);
  });

  it("2. 顺延任务每天都出现，但只算一次、算在它本周第一次出现的那天", async () => {
    await taskRepository.create(draft({ title: "顺延作业", date: "2026-11-10", rolloverMode: "autoNextDay", allowRollover: true }));
    const review = await getWeekReview(TODAY, TODAY);
    expect(review.days.reduce((sum, day) => sum + day.total, 0)).toBe(1);
    expect(counts(review)["11-10"]).toBe("0/1");
    expect(review.unfinished).toEqual([expect.objectContaining({ title: "顺延作业", date: "2026-11-10" })]);
  });

  it("3. 晚几天补完的，按现在的状态算完成（今日页翻回原定那天仍显示当时未完成，这里不同）", async () => {
    const { task } = await taskRepository.create(draft({ title: "周一作业", date: "2026-11-09", rolloverMode: "autoNextDay", allowRollover: true }));
    await taskRepository.setDisplayStatus({ ...task } as TaskDisplay, "done", "2026-11-11");
    const review = await getWeekReview(TODAY, TODAY);
    expect(counts(review)["11-09"]).toBe("1/1");
    expect(review.unfinished).toEqual([]);
  });

  it("4. 上周没做完、顺延进本周的，算在本周一", async () => {
    await taskRepository.create(draft({ title: "上周五作业", date: "2026-11-06", rolloverMode: "autoNextDay", allowRollover: true }));
    const review = await getWeekReview(TODAY, TODAY);
    expect(counts(review)["11-09"]).toBe("0/1");
    expect(review.unfinished).toEqual([expect.objectContaining({ title: "上周五作业", date: "2026-11-09" })]);
  });

  it("5. 重复任务每一次单独计数；这一次跳过的不计入；完成看当天的单日状态", async () => {
    const { task } = await taskRepository.create(draft({
      title: "钢琴练习", mainCategory: "interestClass", subCategory: "pianoPractice", timeType: "recurring", schedulePattern: "dailyRecurring",
      date: undefined, rolloverMode: "skipIfMissed", recurrence: { frequency: "daily", startDate: "2026-11-09" },
    }));
    await taskRepository.setOccurrence(task.id, "2026-11-09", "done");
    await taskRepository.setOccurrence(task.id, "2026-11-10", "cancelled");
    const review = await getWeekReview(TODAY, TODAY);
    expect(counts(review)).toMatchObject({ "11-09": "1/1", "11-10": "0/0", "11-11": "0/1", "11-12": "0/1", "11-15": "0/1" });
    expect(review.unfinished.map((item) => item.date)).toEqual(["2026-11-11", "2026-11-12"]);
    expect(review.unfinished.every((item) => item.taskId === task.id)).toBe(true);
  });

  it("6. 整体取消的、不在今日清单显示的任务都不计入", async () => {
    await taskRepository.create(draft({ title: "已取消", date: "2026-11-10", status: "cancelled" }));
    await taskRepository.create(draft({ title: "家长自己看的", date: "2026-11-10", childVisible: false }));
    const review = await getWeekReview(TODAY, TODAY);
    expect(review.days.reduce((sum, day) => sum + day.total, 0)).toBe(0);
    expect(review.unfinished).toEqual([]);
  });

  it("7. 传入周内任意一天都回到同一周；只读，不写任何数据", async () => {
    await taskRepository.create(draft({ title: "周三作业", date: "2026-11-11" }));
    const before = JSON.stringify(await db.tasks.toArray());
    const fromSunday = await getWeekReview("2026-11-15", TODAY);
    expect(fromSunday.weekStart).toBe("2026-11-09");
    expect(counts(fromSunday)["11-11"]).toBe("0/1");
    expect(JSON.stringify(await db.tasks.toArray())).toBe(before);
    expect(await db.taskOccurrenceStatuses.count()).toBe(0);
  });
});
