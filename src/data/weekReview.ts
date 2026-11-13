/**
 * 本周回看（2026-11 界面审查第 6 批，月视图顶部"本周"条）。
 *
 * 口径："这一周安排的事，到现在完成了几件"——每件事只算一次、只算在它本周第一次出现的那天：
 * - 单日 / 几天内做完 / 顺延进来的任务：按任务 id 去重；
 * - 重复类任务：按"任务 id + 单日日期"去重（每一次是独立的一件事）；
 * - 上周没做完、顺延进本周的任务，算在它本周第一次出现的那天。
 * 完成判定看"现在"的状态，而不是那天当时的状态：周一的作业周三补完，周一记为完成。
 *   - 非重复类：任务本体 status（R1 权威源）；
 *   - 重复类：该次单日状态行（R1 权威源）。
 * 被取消的（整体取消或这一次跳过）不计入。
 * 只读：不写任何数据；与今日页共用 getTasksForDate 的可见性规则（不含阅读计划、不在今日清单显示的任务）。
 */
import { addDays, parseISO } from "date-fns";
import { db } from "./db";
import { taskRepository } from "./taskRepository";
import type { TaskDisplay } from "../types/task";
import { getWeekStartKey, todayKey, toDateKey } from "../utils/date";
import { isOccurrenceSchedule, taskShortName } from "../utils/taskMeta";
import { taskSubjectGroup, type TaskSubjectGroup } from "../utils/taskGrouping";

export interface WeekReviewDay {
  date: string;
  /** 算在这一天的事情件数（不含已取消） */
  total: number;
  /** 其中现在已经完成的 */
  done: number;
  isToday: boolean;
  isFuture: boolean;
}

export interface WeekReviewItem {
  key: string;
  taskId: string;
  title: string;
  /** 算在哪一天（本周第一次出现的那天） */
  date: string;
  subject: TaskSubjectGroup;
}

export interface WeekReview {
  weekStart: string;
  weekEnd: string;
  days: WeekReviewDay[];
  /** 到今天为止（含今天）还没完成的事，按日期排序；未来的日子不列 */
  unfinished: WeekReviewItem[];
}

const itemKey = (task: TaskDisplay) =>
  isOccurrenceSchedule(task) ? `${task.id}:${task.occurrenceDate ?? ""}` : task.id;

export async function getWeekReview(anyDateInWeek: string, today: string = todayKey()): Promise<WeekReview> {
  const weekStart = getWeekStartKey(anyDateInWeek);
  const dates = Array.from({ length: 7 }, (_, index) => toDateKey(addDays(parseISO(weekStart), index)));
  const perDay = await Promise.all(dates.map((date) => taskRepository.getTasksForDate(date)));
  const [tasks, occurrences] = await Promise.all([db.tasks.toArray(), db.taskOccurrenceStatuses.toArray()]);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const occurrenceById = new Map(occurrences.map((row) => [row.id, row]));

  // 每件事只记一次，记在本周第一次出现的那天
  const firstSeen = new Map<string, { date: string; task: TaskDisplay }>();
  dates.forEach((date, index) => {
    for (const task of perDay[index]) {
      const key = itemKey(task);
      if (!firstSeen.has(key)) firstSeen.set(key, { date, task });
    }
  });

  const stateOf = (key: string, task: TaskDisplay): "done" | "cancelled" | "todo" => {
    if (isOccurrenceSchedule(task)) {
      const status = task.occurrenceDate ? occurrenceById.get(`${task.id}:${task.occurrenceDate}`)?.status : undefined;
      if (status === "done") return "done";
      if (status === "cancelled" || taskById.get(task.id)?.status === "cancelled") return "cancelled";
      return "todo";
    }
    const status = taskById.get(key)?.status ?? task.status;
    return status === "done" ? "done" : status === "cancelled" ? "cancelled" : "todo";
  };

  const days: WeekReviewDay[] = dates.map((date) => ({ date, total: 0, done: 0, isToday: date === today, isFuture: date > today }));
  const dayIndex = new Map(dates.map((date, index) => [date, index]));
  const unfinished: WeekReviewItem[] = [];
  for (const [key, { date, task }] of firstSeen) {
    const state = stateOf(key, task);
    if (state === "cancelled") continue;
    const day = days[dayIndex.get(date)!];
    day.total += 1;
    if (state === "done") day.done += 1;
    else if (date <= today) unfinished.push({ key, taskId: task.id, title: taskShortName(task), date, subject: taskSubjectGroup(task) });
  }
  unfinished.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, "zh-CN"));
  return { weekStart, weekEnd: dates[6], days, unfinished };
}
