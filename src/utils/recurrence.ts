import { getDate, getDay, isAfter, isBefore, parseISO } from "date-fns";
import type { Task } from "../types/task";

export const taskOccursOn = (task: Task, dateKey: string) => {
  if (task.timeType !== "recurring" || !task.recurrence) return false;
  const date = parseISO(dateKey);
  const start = parseISO(task.recurrence.startDate);
  const end = task.recurrence.endDate ? parseISO(task.recurrence.endDate) : undefined;
  if (isBefore(date, start) || (end && isAfter(date, end))) return false;
  if (task.recurrence.frequency === "daily") return true;
  if (task.recurrence.frequency === "weekly") return task.recurrence.weekdays?.includes(getDay(date)) ?? false;
  return task.recurrence.monthDay === getDate(date);
};
