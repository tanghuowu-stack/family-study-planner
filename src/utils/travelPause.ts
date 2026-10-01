import type { Task, TaskOccurrenceStatus } from "../types/task";
import { scheduleOccursOn } from "./recurrence";
import { isCourseTask, isOccurrenceSchedule } from "./taskMeta";

type PauseTask = Pick<Task, "timeType" | "schedulePattern" | "mainCategory" | "subCategory" | "extraContentType" | "pauseDuringTravel">;

export function isTravelPauseEnabled(task: PauseTask): boolean {
  if (!isOccurrenceSchedule(task)) return false;
  return task.pauseDuringTravel ?? (task.mainCategory === "interestClass" || isCourseTask(task));
}

/** Read-time suspension only: no tombstones or cancellation rows are written. */
export function createTravelPauseCheck(tasks: Task[], occurrences: TaskOccurrenceStatus[]) {
  const trips = tasks.filter((task) => !task.deletedAt && task.status !== "cancelled"
    && task.mainCategory === "temporary" && task.subCategory === "travel");
  const byKey = new Map(occurrences.map((row) => [`${row.taskId}:${row.occurrenceDate}`, row]));
  const overrides = new Map<string, Set<string>>();
  for (const row of occurrences) {
    if (!row.overrideDate || row.status === "cancelled") continue;
    const dates = overrides.get(row.taskId) ?? new Set<string>();
    dates.add(row.overrideDate);
    overrides.set(row.taskId, dates);
  }
  const cache = new Map<string, boolean>();
  return (task: PauseTask, date: string): boolean => {
    if (!isTravelPauseEnabled(task)) return false;
    if (!cache.has(date)) cache.set(date, trips.some((trip) => {
      if (!isOccurrenceSchedule(trip)) return scheduleOccursOn(trip, date);
      if (overrides.get(trip.id)?.has(date)) return true;
      if (!scheduleOccursOn(trip, date)) return false;
      const row = byKey.get(`${trip.id}:${date}`);
      return row?.status !== "cancelled" && row?.status !== "postponed" && !row?.overrideDate;
    }));
    return cache.get(date)!;
  };
}
