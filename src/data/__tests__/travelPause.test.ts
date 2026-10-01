import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { taskRepository } from "../taskRepository";
import { getHabitCalendars } from "../statsRepository";
import { createTravelPauseCheck, isTravelPauseEnabled } from "../../utils/travelPause";
import type { Task, TaskOccurrenceStatus } from "../../types/task";

const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
  removeItem: (key: string) => store.delete(key),
} });
const stamp = "2026-10-01T04:00:00.000Z";
const task = (id: string, changes: Partial<Task> = {}): Task => ({
  id, title: id, mainCategory: "interestClass", subCategory: "pianoPractice",
  timeType: "recurring", schedulePattern: "dailyRecurring",
  recurrence: { frequency: "daily", startDate: "2026-10-01" },
  status: "todo", rolloverMode: "autoNextDay", allowRollover: true, childVisible: true,
  enableStreak: true, streakStartDate: "2026-10-01", createdAt: stamp, updatedAt: stamp, ...changes,
});
const trip = (changes: Partial<Task> = {}) => task("trip", {
  mainCategory: "temporary", subCategory: "travel", timeType: "dateRange", schedulePattern: "singleDate",
  startDate: "2026-10-02", endDate: "2026-10-04", recurrence: undefined, enableStreak: false, ...changes,
});
const done = (date: string): TaskOccurrenceStatus => ({
  id: `habit:${date}`, taskId: "habit", occurrenceDate: date, status: "done",
  completedAt: `${date}T04:00:00.000Z`, createdAt: stamp, updatedAt: stamp,
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T04:00:00.000Z"));
  store.clear();
  await Promise.all([db.tasks.clear(), db.taskOccurrenceStatuses.clear(), db.activityLogs.clear()]);
});
afterEach(() => vi.useRealTimers());

describe("travel suspension", () => {
  it("defaults only recurring interest activities and extra courses to paused", () => {
    expect(isTravelPauseEnabled(task("piano"))).toBe(true);
    expect(isTravelPauseEnabled(task("class", { mainCategory: "extraHomework", subCategory: "math", extraContentType: "class" }))).toBe(true);
    expect(isTravelPauseEnabled(task("homework", { mainCategory: "extraHomework", extraContentType: "homework" }))).toBe(false);
    expect(isTravelPauseEnabled(task("school", { mainCategory: "school" }))).toBe(false);
    expect(isTravelPauseEnabled(task("single", { timeType: "singleDate" }))).toBe(false);
    expect(isTravelPauseEnabled(task("optout", { pauseDuringTravel: false }))).toBe(false);
    expect(isTravelPauseEnabled(task("optin", { mainCategory: "school", pauseDuringTravel: true }))).toBe(true);
  });

  it("uses inclusive trip dates, including completed travel but excluding deleted or cancelled trips", () => {
    const check = createTravelPauseCheck([trip({ status: "done" })], []);
    expect(["2026-10-01", "2026-10-02", "2026-10-04", "2026-10-05"].map((d) => check(task("habit"), d))).toEqual([false, true, true, false]);
    expect(createTravelPauseCheck([trip({ deletedAt: stamp })], [])(task("habit"), "2026-10-03")).toBe(false);
    expect(createTravelPauseCheck([trip({ status: "cancelled" })], [])(task("habit"), "2026-10-03")).toBe(false);
  });

  it("supports one-day, overlapping and postponed travel schedules", () => {
    const recurringTrip = trip({ timeType: "recurring", schedulePattern: "specificDates", specificDates: ["2026-10-02"] });
    const row: TaskOccurrenceStatus = { ...done("2026-10-02"), taskId: "trip", status: "postponed", overrideDate: "2026-10-05" };
    const check = createTravelPauseCheck([recurringTrip], [row]);
    expect(check(task("habit"), "2026-10-02")).toBe(false);
    expect(check(task("habit"), "2026-10-05")).toBe(true);
    const single = trip({ timeType: "singleDate", date: "2026-10-06" });
    expect(createTravelPauseCheck([trip(), single], [])(task("habit"), "2026-10-06")).toBe(true);
  });

  it("hides suspended tasks from day/month views without changing rows, then resumes without travel debt", async () => {
    await db.tasks.bulkAdd([task("habit"), trip(), task("school", { mainCategory: "school", rolloverMode: "keepOverdue", allowRollover: false })]);
    await db.taskOccurrenceStatuses.bulkAdd([done("2026-10-01")]);
    const before = await db.tasks.toArray();
    expect((await taskRepository.getTasksForDate("2026-10-03")).map((t) => t.id)).toContain("school");
    expect((await taskRepository.getTasksForDate("2026-10-03")).map((t) => t.id)).not.toContain("habit");
    expect((await taskRepository.getTasksForDate("2026-10-03", { forCalendar: true })).map((t) => t.id)).not.toContain("habit");
    const resumed = (await taskRepository.getTasksForDate("2026-10-05")).find((t) => t.id === "habit");
    expect(resumed?.occurrenceDate).toBe("2026-10-05");
    expect(resumed?.rolledFromDate).toBeUndefined();
    expect(await db.tasks.toArray()).toEqual(before);
    expect(await db.taskOccurrenceStatuses.count()).toBe(1);
  });

  it("explicit opt-out and trip removal restore natural schedules", async () => {
    await db.tasks.bulkAdd([task("habit", { pauseDuringTravel: false, allowRollover: false }), trip()]);
    expect((await taskRepository.getTasksForDate("2026-10-03")).some((t) => t.id === "habit")).toBe(true);
    await db.tasks.update("habit", { pauseDuringTravel: true });
    await db.tasks.update("trip", { deletedAt: stamp });
    expect((await taskRepository.getTasksForDate("2026-10-03")).some((t) => t.id === "habit")).toBe(true);
  });

  it("preserves completed history while travel days are off and don't break streaks", async () => {
    await db.tasks.bulkAdd([task("habit"), trip()]);
    await db.taskOccurrenceStatuses.bulkAdd([done("2026-10-01"), done("2026-10-03"), done("2026-10-05"), done("2026-10-06")]);
    const [cal] = await getHabitCalendars("2026-10", "2026-10-06");
    const days = Object.fromEntries(cal.days.map((d) => [d.date, d.status]));
    expect(days["2026-10-02"]).toBe("off");
    expect(days["2026-10-03"]).toBe("done");
    expect(days["2026-10-04"]).toBe("off");
    expect(cal.monthCompletedDays).toBe(4);
    expect(cal.currentStreak).toBe(4);
    expect((await taskRepository.getTasksForDate("2026-10-03")).find((t) => t.id === "habit")?.status).toBe("done");
  });
});
