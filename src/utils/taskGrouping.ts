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
  /** 其他安排·其他：单独一组，显示为"其他 · 提醒"（2026-11-18） */
  reminders: T[];
}

/**
 * "提醒"：其他安排里的"其他"（如"整理明天上课资料和水杯"）。只在显示层按分类 + 二级类型判断，
 * 不新增字段、不迁移数据。今日页从"其他 · 作业"里拆出来单独成组。
 */
export const isReminderTask = (task: Pick<Task, "mainCategory" | "subCategory">) => task.mainCategory === "temporary" && task.subCategory === "other";

/**
 * 不计入今日页"还剩 N 项"和进度条的任务：其他安排里的"其他"（提醒）、"休闲"、"旅游"。照常显示、可以打勾。
 * 考试或比赛照常计入。（以后做积分时这几类默认不计分）
 */
export const isUncountedTask = (task: Pick<Task, "mainCategory" | "subCategory">) =>
  task.mainCategory === "temporary" && ["other", "leisure", "travel"].includes(task.subCategory);

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
  // 提醒从作业组里拆出来；上课的判定（isCourseTask）不受影响，提醒本来就不会是上课
  const reminders = tasks.filter((task) => !isCourseTask(task) && isReminderTask(task)).sort(dayBucketSort);
  const homework = normalizeSubjectOrder(subjectOrder)
    .map((key) => ({
      key,
      label: TASK_SUBJECT_GROUPS.find((group) => group.key === key)!.label,
      tasks: tasks.filter((task) => !isCourseTask(task) && !isReminderTask(task) && taskSubjectGroup(task) === key).sort(dayBucketSort),
    }))
    .filter((group) => group.tasks.length > 0);
  return { classes, homework, reminders };
}

// ── 今日页：每日计划 / 本周计划（2026-11-17）──────────────────────────────

/**
 * 某一天里，这条任务放在今日页“本周课外作业”里，还是“学校家庭作业”里——**按添加时选的分类分**（2026-11-28 用户）：
 * - 在“课外班”里添加的作业（单日、时段、重复都算）→ 本周课外作业；课外班的“上课”除外，它在上课组里；
 * - 在“学校作业”里添加的（单日家庭作业、周末家庭作业等时段作业）→ 学校家庭作业，不进本周课外作业、不加提前完成分；
 * - 兴趣班的时段作业维持原样：到截止日当天都在本周课外作业；
 * - “其他安排”（旅游、休闲、考试比赛等）留在当天清单。
 * 时段作业截止日当天标红色“今天截止”；过了截止日还没做完的由逾期区负责（不在当天清单里）。
 * 只决定显示位置，不改任何数据。
 */
export function isWeekPlanTask(task: Pick<Task, "timeType" | "mainCategory" | "subCategory" | "extraContentType" | "endDate">, date: string): boolean {
  if (task.mainCategory === "extraHomework" && !isCourseTask(task)) return true;
  return task.timeType === "dateRange" && task.mainCategory !== "temporary" && task.mainCategory !== "school" && !!task.endDate && task.endDate >= date;
}

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];

/** 截止标签的醒目程度：今天截止 / 明天截止 / 更晚 */
export function weekPlanDueTone(endDate: string, date: string): "today" | "soon" | "normal" {
  if (endDate <= date) return "today";
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + 1);
  const tomorrow = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
  return endDate === tomorrow ? "soon" : "normal";
}

/** 本周计划里的截止说明：明天截止 / 周五截止（同一周内）/ 11月24日截止 */
export function weekPlanDueLabel(endDate: string, date: string): string {
  const day = (key: string) => new Date(`${key}T00:00:00`);
  const diff = Math.round((day(endDate).getTime() - day(date).getTime()) / 86400000);
  if (diff <= 0) return "今天截止";
  if (diff === 1) return "明天截止";
  const weekdayOf = (key: string) => (day(key).getDay() + 6) % 7; // 周一=0
  if (diff < 7 && weekdayOf(endDate) > weekdayOf(date)) return `周${WEEKDAY[day(endDate).getDay()]}截止`;
  const [, month, dd] = endDate.split("-");
  return `${Number(month)}月${Number(dd)}日截止`;
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
