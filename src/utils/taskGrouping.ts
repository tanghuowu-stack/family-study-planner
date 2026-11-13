import type { Task } from "../types/task";
import { isCourseTask } from "./taskMeta";

export type TaskSubjectGroup = "chinese" | "math" | "english" | "other";

export const TASK_SUBJECT_GROUPS: { key: TaskSubjectGroup; label: string }[] = [
  { key: "chinese", label: "语文" },
  { key: "math", label: "数学" },
  { key: "english", label: "英语" },
  { key: "other", label: "其他" },
];

export function taskSubjectGroup(task: Pick<Task, "mainCategory" | "subCategory" | "title">): TaskSubjectGroup {
  if (task.mainCategory === "interestClass" || task.mainCategory === "temporary") return "other";
  if (["chinese", "math", "english"].includes(task.subCategory)) return task.subCategory as TaskSubjectGroup;
  if (/语文|大增|作文|阅读理解|古诗|背诵/.test(task.title)) return "chinese";
  if (/数学|奥数|计算|口算|应用题/.test(task.title)) return "math";
  if (/英语|FCE|听写|Part|语法|单词/i.test(task.title)) return "english";
  return "other";
}

// ─── 今日页分组（2026-09-25）──────────────────────────────────────────────────
// 最外层按内容类型分"上课 / 作业"两组：上课不按学科拆，语数英课、游泳/钢琴课统统混在一起；
// 作业组内再按学科分 语文/数学/英语/其他。任务管理页不走这里，维持 mainCategory → subCategory 分组。
//
// "上课"复用 isCourseTask 判定——和任务行上那枚"上课"标签同一口径（课外班内容类型=上课，
// 以及钢琴/游泳/轮滑课）。其余一律进作业组：内容类型为空、历史遗留值（练习/听写/背诵…）、
// 校内任务（本来就没有内容类型字段）、钢琴练习、临时事项都在这里，再按 taskSubjectGroup
// 分学科，它自身有"其他"兜底。每个任务恰好落进一个桶，不存在判断落空而消失的路径。

export type DayGroupable = Pick<Task, "mainCategory" | "subCategory" | "title" | "extraContentType" | "startTime" | "time" | "sortOrder" | "createdAt">;

export interface DayTaskGroups<T> {
  classes: T[];
  homework: { key: TaskSubjectGroup; label: string; tasks: T[] }[];
}

/**
 * 用户拖出来的学科顺序（持久化在 app_settings）规整成完整、无重复的四个学科。
 * 缺一个 key 就等于那一科的任务整组不渲染——这里补齐到末尾，而不是信任存储值一定完整。
 */
export function normalizeSubjectOrder(order: readonly string[]): TaskSubjectGroup[] {
  const known = TASK_SUBJECT_GROUPS.map((group) => group.key);
  const seen = new Set<TaskSubjectGroup>();
  for (const key of order) if (known.includes(key as TaskSubjectGroup)) seen.add(key as TaskSubjectGroup);
  for (const key of known) seen.add(key);
  return [...seen];
}

/**
 * 桶内排序：带具体时间的按时间置顶，其余按 sortOrder（今日页/管理页拖拽写入）→ createdAt。
 * 不能沿用 taskRepository 的 taskSort：它第一级按学科排，而上课组混着各学科，
 * 会把"数学课拖到语文课上面"这种跨学科的拖拽结果悄悄压回学科默认序。
 */
export function dayBucketSort(a: DayGroupable, b: DayGroupable): number {
  const aTime = a.startTime ?? a.time;
  const bTime = b.startTime ?? b.time;
  if (aTime && bTime) return aTime.localeCompare(bTime);
  if (aTime) return -1;
  if (bTime) return 1;
  return (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || a.createdAt.localeCompare(b.createdAt);
}

export function groupDayTasks<T extends DayGroupable>(tasks: T[], subjectOrder: readonly string[]): DayTaskGroups<T> {
  const classes = tasks.filter((task) => isCourseTask(task)).sort(dayBucketSort);
  const homework = normalizeSubjectOrder(subjectOrder)
    .map((key) => ({
      key,
      label: TASK_SUBJECT_GROUPS.find((group) => group.key === key)!.label,
      tasks: tasks.filter((task) => !isCourseTask(task) && taskSubjectGroup(task) === key).sort(dayBucketSort),
    }))
    .filter((group) => group.tasks.length > 0);
  return { classes, homework };
}

// ── 今日页：刚完成的任务原位停留 ─────────────────────────────────────────────

/** 今日页一条任务所在的区：今日清单 / 逾期未完成 / 已完成 */
export type DayTaskPlacement = "pending" | "overdue" | "done";

/** 今日页任务行的稳定标识：同一任务在同一天只出现一次，重复类用它当天的单日日期区分 */
export const dayTaskKey = (task: { id: string; occurrenceDate?: string; date?: string }) => `${task.id}:${task.occurrenceDate ?? task.date ?? ""}`;

const isSettledStatus = (status: string) => status === "done" || status === "cancelled";

/**
 * 对比上一次和这一次读到的清单，找出"刚刚完成"的任务及其原本所在的区，供今日页让它在原位停留片刻。
 * previous 传 null（首次加载、换了日期）时不产生停留——打开页面时已经完成的任务直接在"已完成"里。
 * 只认 待做/逾期 → 已完成 这一个方向；取消完成、别的设备早已完成的任务都不停留。
 */
export function findJustCompleted<T extends { id: string; status: string; occurrenceDate?: string; date?: string }>(
  previous: Map<string, DayTaskPlacement> | null,
  tasks: T[],
  overdue: T[],
): { placement: Map<string, DayTaskPlacement>; justCompleted: Map<string, DayTaskPlacement> } {
  const placement = new Map<string, DayTaskPlacement>();
  for (const task of overdue) placement.set(dayTaskKey(task), "overdue");
  for (const task of tasks) placement.set(dayTaskKey(task), isSettledStatus(task.status) ? "done" : "pending");
  const justCompleted = new Map<string, DayTaskPlacement>();
  if (previous) {
    for (const [key, now] of placement) {
      const before = previous.get(key);
      if (now === "done" && (before === "pending" || before === "overdue")) justCompleted.set(key, before);
    }
  }
  return { placement, justCompleted };
}
