import { getDate, getDay, isAfter, isBefore, parseISO } from "date-fns";
import type { Task } from "../types/task";
import { isDateInRange } from "./date";

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

export const scheduleOccursOn = (task: Task, date: string) => {
  if (task.timeType === "singleDate") return task.date === date;
  if (task.timeType === "dateRange") return !!task.startDate && !!task.endDate && isDateInRange(date, task.startDate, task.endDate);
  if (task.timeType !== "recurring") return false;
  if (task.schedulePattern === "specificDates") return task.specificDates?.includes(date) ?? false;
  if (task.schedulePattern === "dateRangeDaily") return !!task.startDate && !!task.endDate && isDateInRange(date, task.startDate, task.endDate);
  if (task.schedulePattern === "dateRangeWeekdays") return !!task.startDate && !!task.endDate && isDateInRange(date, task.startDate, task.endDate) && (task.rangeWeekdays?.includes(getDay(parseISO(date))) ?? false);
  return taskOccursOn(task, date);
};
