/**
 * 本周回看（2026-11 界面审查第 6 批，月视图顶部"本周"条）。
 *
 * 口径："这一周每天到期的事，到现在完成了几件"——每件事只算一次、只算在它到期的那天：
 * - 单日 / 顺延进来的任务：按任务 id 去重，算在本周第一次出现的那天；
 * - 几天内做完（dateRange）：算在最后一天（截止日），前面几天不算——那几天本来就不要求做完（2026-11-13 用户定）。
 *   截止日在本周之后：本周内已经做完的，算在完成那天；还没做完的本周不计（下周到期再算）。
 *   截止日在本周之前、还没做完被顺延进本周的，同单日任务，算在本周第一次出现的那天；
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
import { getWeekStartKey, todayKey, toDateKey, toLocalDateKey } from "../utils/date";
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
  /** 算在这一天、现在还没完成的事（未来的日子就是还没做的安排），供点开某一天时列出 */
  pending: WeekReviewItem[];
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

  const weekEnd = dates[6];
  /** 这件事算在本周哪一天；返回 null 表示本周不计 */
  const attributeTo = (key: string, firstDate: string, task: TaskDisplay, state: "done" | "todo"): string | null => {
    const stored = taskById.get(key);
    if (isOccurrenceSchedule(task) || stored?.timeType !== "dateRange" || !stored.endDate) return firstDate;
    const deadline = stored.endDate;
    if (deadline < weekStart) return firstDate;            // 早就过了截止日还没做完，顺延进本周
    if (deadline <= weekEnd) return deadline;              // 本周到期：只算在最后一天
    if (state !== "done" || !stored.completedAt) return null; // 下周才到期、还没做完：本周不计
    const finished = toLocalDateKey(stored.completedAt);   // 下周才到期、本周提前做完：算在完成那天
    return finished >= weekStart && finished <= weekEnd ? finished : null;
  };

  const days: WeekReviewDay[] = dates.map((date) => ({ date, total: 0, done: 0, isToday: date === today, isFuture: date > today, pending: [] }));
  const dayIndex = new Map(dates.map((date, index) => [date, index]));
  const unfinished: WeekReviewItem[] = [];
  for (const [key, { date: firstDate, task }] of firstSeen) {
    const state = stateOf(key, task);
    if (state === "cancelled") continue;
    const date = attributeTo(key, firstDate, task, state);
    if (!date) continue;
    const day = days[dayIndex.get(date)!];
    day.total += 1;
    if (state === "done") { day.done += 1; continue; }
    const item: WeekReviewItem = { key, taskId: task.id, title: taskShortName(task), date, subject: taskSubjectGroup(task) };
    day.pending.push(item);
    if (date <= today) unfinished.push(item);
  }
  const byTitle = (a: WeekReviewItem, b: WeekReviewItem) => a.title.localeCompare(b.title, "zh-CN");
  days.forEach((day) => day.pending.sort(byTitle));
  unfinished.sort((a, b) => a.date.localeCompare(b.date) || byTitle(a, b));
  return { weekStart, weekEnd, days, unfinished };
}
