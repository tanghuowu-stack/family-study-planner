import { addDays, eachDayOfInterval, getDay, parseISO } from "date-fns";
import { db } from "./db";
import type {
  ActivityActionType, ActivityLog, BackupData, Course, MainCategory, OccurrenceStatus, PlanOverviewItem, PlanPeriod, PlanPeriodType, ReadingLog, RolloverMode, SyncResult, Task, TaskDisplay,
  TaskDraft, TaskOccurrenceStatus, TaskStatus,
} from "../types/task";
import { getMonthBounds, getMonthKey, getWeekEndKey, getWeekStartKey, isDateInRange, todayKey, toDateKey } from "../utils/date";
import { taskOccursOn } from "../utils/recurrence";
import { defaultSortOrder, isCourseTask, isOccurrenceSchedule, subCategoryLabel } from "../utils/taskMeta";
import { taskSubjectGroup } from "../utils/taskGrouping";

const makeId = () => crypto.randomUUID();
const isActiveTask = (task: Task) => !task.deletedAt;
const unfinished = (status: TaskStatus | OccurrenceStatus) => !["done", "cancelled"].includes(status);
const taskSort = (a: Task, b: Task) => {
  const aTime = a.startTime ?? a.time;
  const bTime = b.startTime ?? b.time;
  if (aTime && bTime) return aTime.localeCompare(bTime);
  if (aTime) return -1;
  if (bTime) return 1;
  return (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || a.createdAt.localeCompare(b.createdAt);
};
const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart <= bEnd && aEnd >= bStart;

const deviceInfo = () => {
  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : /Firefox\//.test(userAgent) ? "Firefox" : "未知浏览器";
  const deviceType = /iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1) ? "iPad" : /iPhone/.test(userAgent) ? "iPhone" : /Android/.test(userAgent) ? "Android" : /Windows/.test(userAgent) ? "Windows" : /Macintosh|Mac OS X/.test(userAgent) ? "Mac" : "Unknown";
  const savedLabel = typeof localStorage === "undefined" ? "" : localStorage.getItem("familyPlanner.deviceLabel")?.trim() || "";
  const deviceLabel = savedLabel || `${deviceType} ${browser}`;
  return { browser, deviceType, deviceLabel, actorName: "本地用户" };
};

async function writeLog(actionType: ActivityActionType, entityType: ActivityLog["entityType"], details: Partial<ActivityLog> = {}) {
  await db.activityLogs.add({ id: makeId(), actionType, entityType, createdAt: new Date().toISOString(), ...deviceInfo(), ...details });
}

function defaultRollover(main: MainCategory, sub: string): { rolloverMode: RolloverMode; allowRollover: boolean } {
  const auto = main === "extraHomework" || (main === "interestClass" && sub === "pianoPractice") || main === "readingPlan";
  return { rolloverMode: auto ? "autoNextDay" : "keepOverdue", allowRollover: auto };
}

function normalizeDraft(draft: TaskDraft): TaskDraft {
  const fallback = defaultRollover(draft.mainCategory, draft.subCategory);
  const calendarVisibility = draft.calendarVisibility ?? inferCalendarVisibility(draft);
  const schedulePattern = draft.timeType === "recurring"
    ? (draft.schedulePattern === "singleDate" ? "weeklyRecurring" : draft.schedulePattern ?? "weeklyRecurring")
    : "singleDate";
  return {
    ...draft,
    schedulePattern,
    calendarVisibility,
    rolloverMode: calendarVisibility === "hide" ? "skipIfMissed" : draft.rolloverMode ?? fallback.rolloverMode,
    allowRollover: calendarVisibility === "hide" ? false : draft.allowRollover ?? fallback.allowRollover,
    sortOrder: draft.sortOrder ?? defaultSortOrder(draft.mainCategory, draft.subCategory),
  };
}

const mappedReadingSub = (raw: Record<string, unknown>) => {
  const text = `${String(raw.title ?? "")} ${String(raw.subCategory ?? raw.subType ?? "")}`.toLowerCase();
  return text.includes("中文") || text.includes("chinese") ? "chineseReading" : "englishReading";
};

function normalizeImported(raw: Record<string, unknown>): Task {
  const oldCategory = String(raw.category ?? "");
  let normalizedTitle = String(raw.title ?? "");
  let mainCategory = raw.mainCategory as MainCategory | undefined;
  let subCategory = String(raw.subCategory ?? raw.subType ?? "other");
  const visibleMain = String(raw.mainCategory ?? "");
  if (["校内", "校内作业", "学校作业"].includes(visibleMain)) mainCategory = "school";
  if (["校外", "校外作业", "课外作业", "课外"].includes(visibleMain)) mainCategory = "extraHomework";
  if (["临时事项", "事项"].includes(visibleMain)) mainCategory = "temporary";
  if (mainCategory === ("schoolHomework" as MainCategory)) mainCategory = "school";
  if (mainCategory === "interestClass") {
    subCategory = ({ jumpRopeClass: "other", aoshuClass: "aoshu", chineseClass: "dazeng", englishClass: "cambridge", pianoClass: "piano", swimmingClass: "swimming", rollerSkatingClass: "rollerSkating" } as Record<string, string>)[subCategory] ?? subCategory;
  }
  if (mainCategory === "readingPlan") subCategory = mappedReadingSub(raw);
  if (!mainCategory) {
    if (oldCategory === "schoolHomework") mainCategory = "school";
    else if (oldCategory === "reading") {
      mainCategory = "readingPlan";
      subCategory = mappedReadingSub(raw);
    } else if (["examPractice", "extraClass"].includes(oldCategory)) {
      mainCategory = "extraHomework";
      subCategory = raw.courseType === "aoshu" ? "math" : raw.courseType === "chinese" ? "chinese" : "english";
    } else if (oldCategory === "sportsArt") {
      mainCategory = "interestClass";
      subCategory = raw.courseType === "swimming" ? "swimmingClass" : raw.courseType === "piano" ? "pianoPractice" : "other";
    } else {
      mainCategory = "temporary";
      subCategory = oldCategory === "specialDate" ? "examCompetition" : oldCategory === "familyActivity" ? "leisure" : "other";
    }
  }
  let extraContentType = raw.extraContentType as Task["extraContentType"];
  if (mainCategory === "interestClass") {
    subCategory = ({ pianoClass: "piano", swimmingClass: "swimming", rollerSkatingClass: "rollerSkating" } as Record<string, string>)[subCategory] ?? subCategory;
  }
  if (mainCategory === "interestClass" && ["aoshu", "dazeng", "cambridge"].includes(subCategory)) {
    const map: Record<string, string> = { aoshu: "math", dazeng: "chinese", cambridge: "english" };
    const titleMap: Record<string, string> = { aoshu: "奥数课", dazeng: "语文课", cambridge: "FCE 课" };
    if (!normalizedTitle.trim()) normalizedTitle = titleMap[subCategory];
    mainCategory = "extraHomework"; subCategory = map[subCategory]; extraContentType = "class";
  } else if (mainCategory === "interestClass" && subCategory === "other") {
    mainCategory = "extraHomework"; subCategory = "other"; extraContentType = "other";
  }
  if (mainCategory === "extraHomework") {
    if (subCategory === "chineseRecitation") { subCategory = "chinese"; extraContentType = "recitation"; if (!normalizedTitle.trim()) normalizedTitle = "语文背诵"; }
    if (subCategory === "englishDictation") { subCategory = "english"; extraContentType = "dictation"; if (!normalizedTitle.trim()) normalizedTitle = "英语听写"; }
    extraContentType ??= inferExtraContent(normalizedTitle);
  }
  const fallback = defaultRollover(mainCategory, subCategory);
  const readingTarget = Number(raw.readingTargetCount ?? raw.totalAmount ?? 1);
  return {
    ...(raw as unknown as Task), title: normalizedTitle, mainCategory, subCategory, extraContentType,
    timeType: mainCategory === "readingPlan" ? "weekGoal" : raw.timeType as Task["timeType"],
    rolloverMode: raw.rolloverMode as RolloverMode ?? fallback.rolloverMode,
    allowRollover: typeof raw.allowRollover === "boolean" ? raw.allowRollover : fallback.allowRollover,
    sortOrder: typeof raw.sortOrder === "number" ? raw.sortOrder : defaultSortOrder(mainCategory, subCategory),
    schedulePattern: raw.timeType === "recurring" ? (raw.schedulePattern as Task["schedulePattern"] ?? "weeklyRecurring") : "singleDate",
    startTime: String(raw.startTime ?? raw.time ?? "") || undefined,
    weeklyQuota: mainCategory === "readingPlan" ? (raw.weeklyQuota as Task["weeklyQuota"] ?? { enabled: true, targetCount: readingTarget, unit: (raw.readingTargetUnit ?? raw.amountUnit ?? "本") as "本", isWeeklyRecurring: true, allowAutoDistribute: true, allowRollover: true }) : raw.weeklyQuota as Task["weeklyQuota"],
    calendarVisibility: (raw.calendarVisibility as Task["calendarVisibility"]) ?? inferCalendarVisibility({ ...raw, mainCategory, subCategory, extraContentType }),
  };
}

const inferExtraContent = (title: string): NonNullable<Task["extraContentType"]> => /听写/.test(title) ? "dictation" : /背诵/.test(title) ? "recitation" : /课$|上课|课程/.test(title) ? "class" : /练习|计算|口算/.test(title) ? "practice" : /作业/.test(title) ? "homework" : "other";
const inferCalendarVisibility = (task: Partial<Task>) => {
  const daily = task.schedulePattern === "dailyRecurring" || task.recurrence?.frequency === "daily";
  const title = task.title ?? "";
  return task.mainCategory === "extraHomework" && (task.extraContentType === "dictation" || (task.extraContentType === "practice" && /每日|计算|口算/.test(title)) || (task.extraContentType === "recitation" && daily)) ? "hide" : "show";
};

const isCalendarPlanTask = (task: Task) =>
  (task.mainCategory === "extraHomework" && task.extraContentType === "class")
  || (task.mainCategory === "interestClass" && task.subCategory !== "pianoPractice")
  || task.mainCategory === "temporary";

const scheduleOccursOn = (task: Task, date: string) => {
  if (task.timeType === "singleDate") return task.date === date;
  if (task.timeType === "dateRange") return !!task.startDate && !!task.endDate && isDateInRange(date, task.startDate, task.endDate);
  if (task.timeType !== "recurring") return false;
  if (task.schedulePattern === "specificDates") return task.specificDates?.includes(date) ?? false;
  if (task.schedulePattern === "dateRangeDaily") return !!task.startDate && !!task.endDate && isDateInRange(date, task.startDate, task.endDate);
  if (task.schedulePattern === "dateRangeWeekdays") return !!task.startDate && !!task.endDate && isDateInRange(date, task.startDate, task.endDate) && (task.rangeWeekdays?.includes(getDay(parseISO(date))) ?? false);
  if (task.schedulePattern === "dailyRecurring") return taskOccursOn(task, date);
  if (task.schedulePattern === "weeklyRecurring") return taskOccursOn(task, date);
  return taskOccursOn(task, date);
};

const isRangeSchedule = (task: Task) => task.timeType === "dateRange" || (task.timeType === "recurring" && ["dateRangeDaily", "dateRangeWeekdays"].includes(task.schedulePattern ?? ""));

// R1/R3 写入口防线（PROJECT_GUIDE 6.5）：剔除 TaskDisplay 的运行时展示字段；
// occurrence 类任务本体 status 只允许 todo/cancelled，completedAt 恒为空。
function sanitizeTaskWrite(task: Task, previousStatus?: TaskStatus): Task {
  const clean = { ...task } as Task & Partial<TaskDisplay>;
  delete clean.occurrenceDate; delete clean.occurrenceStatus; delete clean.overrideDate; delete clean.overrideNote; delete clean.rolledFromDate;
  if (isOccurrenceSchedule(clean)) {
    if (!["todo", "cancelled"].includes(clean.status)) clean.status = previousStatus && ["todo", "cancelled"].includes(previousStatus) ? previousStatus : "todo";
    clean.completedAt = undefined;
  }
  return clean;
}

// carryOver（autoNextDay）的重复类任务：往前找最早一个已排期但未完成/未取消/未延期的日子，
// 当作"欠着"的那一天顶替今天的名额展示；不欠账时才回落到今天本身的正常排期。
function findPendingOccurrenceDate(task: Task, date: string, byTaskAndDate: Map<string, TaskOccurrenceStatus>): string | undefined {
  if (!task.allowRollover || task.rolloverMode !== "autoNextDay" || date > todayKey()) return undefined;
  const start = task.recurrence?.startDate ?? task.startDate ?? (task.specificDates?.length ? [...task.specificDates].sort()[0] : undefined);
  if (!start) return undefined;
  let cursor = parseISO(start);
  let key = toDateKey(cursor);
  while (key < date) {
    if (scheduleOccursOn(task, key)) {
      const status = byTaskAndDate.get(`${task.id}:${key}`)?.status ?? "todo";
      if (status !== "done" && status !== "cancelled" && status !== "postponed") return key;
    }
    cursor = addDays(cursor, 1);
    key = toDateKey(cursor);
  }
  return undefined;
}

async function dateLimitFor(task: Task, allTasks: Task[]) {
  if (!task.parentTaskId) return undefined;
  const parent = allTasks.find((item) => item.id === task.parentTaskId);
  if (!parent) return undefined;
  if (parent.assignmentWindow) return parent.assignmentWindow.endDate;
  if (task.allocationWeekStart) return getWeekEndKey(task.allocationWeekStart);
  if (parent.weekStart) return getWeekEndKey(parent.weekStart);
  return undefined;
}

// 子任务全部完成即父任务完成，与父任务自身的时间窗口（周目标/作业周期）是否到期无关；
// 子任务只要有一个被取消勾选，父任务也跟着退回未完成，避免"显示已完成但子任务其实没做完"的假象。
async function syncParentCompletion(childTaskId: string): Promise<string | undefined> {
  const child = await db.tasks.get(childTaskId);
  if (!child?.parentTaskId) return undefined;
  const parent = await db.tasks.get(child.parentTaskId);
  if (!parent || parent.deletedAt) return undefined;
  const siblings = (await db.tasks.where("parentTaskId").equals(parent.id).toArray()).filter(isActiveTask);
  if (!siblings.length) return undefined;
  const allDone = siblings.every((sibling) => sibling.status === "done");
  if (allDone === (parent.status === "done")) return undefined;
  const now = new Date().toISOString();
  await db.tasks.update(parent.id, { status: allDone ? "done" : "todo", completedAt: allDone ? now : undefined, updatedAt: now });
  return parent.id;
}

async function recomputeStatusFromChecklist(taskId: string, beforeSnapshot?: Task): Promise<{ task?: Task; parentId?: string }> {
  const task = await db.tasks.get(taskId);
  if (!task || task.deletedAt || isOccurrenceSchedule(task)) return { task };
  const items = task.checklistItems ?? [];
  if (!items.length) return { task, parentId: await syncParentCompletion(taskId) };
  const allDone = items.every((item) => item.done);
  const status: TaskStatus = allDone ? "done" : task.status === "done" ? "todo" : task.status;
  if (status !== task.status) {
    const now = new Date().toISOString();
    await db.tasks.update(taskId, { status, completedAt: status === "done" ? now : undefined, updatedAt: now });
    await writeLog(status === "done" ? "complete" : "uncomplete", "task", { entityId: task.id, entityTitle: task.title, beforeSnapshot: beforeSnapshot ?? task, afterSnapshot: { status, checklistItems: items } });
  }
  const parentId = await syncParentCompletion(taskId);
  return { task: await db.tasks.get(taskId), parentId };
}

export const taskRepository = {
  async listAll() { return (await db.tasks.toArray()).filter((task) => isActiveTask(task) && task.mainCategory !== "readingPlan").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); },

  async getTasksForDate(date: string, options?: { forCalendar?: boolean }): Promise<TaskDisplay[]> {
    const [allTasks, occurrences] = await Promise.all([db.tasks.toArray(), db.taskOccurrenceStatuses.toArray()]);
    const tasks = allTasks.filter(isActiveTask);
    const byTaskAndDate = new Map(occurrences.map((item) => [`${item.taskId}:${item.occurrenceDate}`, item]));
    const result: TaskDisplay[] = [];

    for (const task of tasks) {
      if (task.mainCategory === "readingPlan" || !task.childVisible || (options?.forCalendar && (task.calendarVisibility === "hide" || task.status === "cancelled" || !isCalendarPlanTask(task))) || task.timeType === "weekGoal" || task.timeType === "monthGoal" || task.timeType === "assignmentWindow") continue;
      if (task.status === "done" && task.timeType === "dateRange" && task.completedAt && date > task.completedAt.slice(0, 10)) continue;
      if (isOccurrenceSchedule(task)) {
        const pendingDate = findPendingOccurrenceDate(task, date, byTaskAndDate);
        if (pendingDate) {
          const occurrence = byTaskAndDate.get(`${task.id}:${pendingDate}`);
          result.push({ ...task, status: occurrence?.status as TaskStatus ?? "todo", occurrenceDate: pendingDate, occurrenceStatus: occurrence?.status ?? "todo", overrideDate: occurrence?.overrideDate, overrideNote: occurrence?.overrideNote, rolledFromDate: pendingDate });
        } else if (scheduleOccursOn(task, date)) {
          const occurrence = byTaskAndDate.get(`${task.id}:${date}`);
          if (occurrence?.status !== "cancelled" && occurrence?.status !== "postponed") {
            result.push({ ...task, status: occurrence?.status as TaskStatus ?? "todo", occurrenceDate: date, occurrenceStatus: occurrence?.status ?? "todo", overrideDate: occurrence?.overrideDate, overrideNote: occurrence?.overrideNote });
          }
        }
      } else if (scheduleOccursOn(task, date)) {
        result.push(task);
      }

      if (task.timeType === "singleDate" && task.date && task.date < date && date <= todayKey() && unfinished(task.status) && task.allowRollover && task.rolloverMode === "autoNextDay") {
        const limit = await dateLimitFor(task, tasks);
        if (!limit || date <= limit) result.push({ ...task, rolledFromDate: task.date });
      }
    }

    for (const occurrence of occurrences.filter((item) => item.status === "postponed" && item.overrideDate === date)) {
      const task = tasks.find((item) => item.id === occurrence.taskId);
      if (task && task.mainCategory !== "readingPlan" && isActiveTask(task) && task.childVisible && (!options?.forCalendar || (task.calendarVisibility !== "hide" && isCalendarPlanTask(task)))) result.push({ ...task, status: "todo", occurrenceDate: occurrence.occurrenceDate, occurrenceStatus: "postponed", overrideDate: date, overrideNote: occurrence.overrideNote });
    }

    const unique = new Map<string, TaskDisplay>();
    result.forEach((task) => unique.set(`${task.id}:${task.occurrenceDate ?? task.date ?? date}`, task));
    return [...unique.values()].sort(taskSort);
  },

  async getOverdueTasks(date: string): Promise<TaskDisplay[]> {
    const allTasks = await db.tasks.toArray();
    const tasks = allTasks.filter(isActiveTask);
    const parents = new Map(tasks.map((task) => [task.id, task]));
    return tasks.filter((task) => {
      if (task.mainCategory === "readingPlan" || !task.childVisible || task.timeType !== "singleDate" || !task.date || task.date >= date || !unfinished(task.status)) return false;
      if (task.rolloverMode === "keepOverdue") return true;
      const parent = task.parentTaskId ? parents.get(task.parentTaskId) : undefined;
      return task.rolloverMode === "autoNextDay" && !!parent?.assignmentWindow && parent.assignmentWindow.endDate < date;
    })
      .map((task) => ({ ...task, status: "overdue" as const, rolledFromDate: task.date }))
      .sort(taskSort);
  },

  async getWeekPools(date: string): Promise<Task[]> {
    const start = getWeekStartKey(date);
    const end = getWeekEndKey(date);
    const allTasks = await db.tasks.toArray();
    const tasks = allTasks.filter(isActiveTask);
    return tasks.filter((task) => {
      if (task.mainCategory === "readingPlan" || !task.childVisible) return false;
      if (task.timeType === "weekGoal") return task.weeklyQuota?.isWeeklyRecurring ? (!task.weekStart || task.weekStart <= end) : task.weekStart === start;
      return task.timeType === "assignmentWindow" && !!task.assignmentWindow && overlaps(task.assignmentWindow.startDate, task.assignmentWindow.endDate, start, end);
    }).sort(taskSort);
  },

  async getChildren(parentId: string, weekStart?: string) {
    const children = (await db.tasks.where("parentTaskId").equals(parentId).toArray()).filter(isActiveTask);
    return weekStart ? children.filter((task) => task.allocationWeekStart === weekStart || (!task.allocationWeekStart && task.date && getWeekStartKey(task.date) === weekStart)) : children;
  },

  async getPlanSummary(date: string, period: "week" | "month") {
    const [allTasks, readingLogs] = await Promise.all([db.tasks.toArray(), db.readingLogs.toArray()]);
    const tasks = allTasks.filter(isActiveTask);
    const plans = period === "week"
      ? tasks.filter((task) => task.mainCategory !== "readingPlan" && task.childVisible && task.timeType === "weekGoal" && (task.weeklyQuota?.isWeeklyRecurring ? (!task.weekStart || task.weekStart <= getWeekEndKey(date)) : task.weekStart === getWeekStartKey(date)))
      : tasks.filter((task) => task.childVisible && task.timeType === "monthGoal" && task.month === getMonthKey(date));
    return plans.map((plan) => {
      const children = tasks.filter((task) => task.parentTaskId === plan.id && (period !== "week" || task.allocationWeekStart === getWeekStartKey(date)));
      const completed = children.filter((task) => task.status === "done").length;
      const unit = plan.weeklyQuota?.unit ?? plan.readingTargetUnit ?? plan.amountUnit ?? "次";
      const target = plan.weeklyQuota?.targetCount ?? plan.readingTargetCount ?? plan.totalAmount ?? plan.splitCount ?? 1;
      const completedAmount = children.filter((task) => task.status === "done").reduce((sum, task) => sum + (task.amountPerSession ?? 1), 0);
      const readingDone = readingLogs.filter((log) => log.taskId === plan.id && log.weekStart === getWeekStartKey(date)).reduce((sum, log) => sum + log.amount, 0);
      const done = plan.mainCategory === "readingPlan" ? readingDone : children.length ? Math.min(target, completedAmount) : plan.status === "done" ? target : 0;
      const label = plan.mainCategory === "readingPlan" ? subCategoryLabel("readingPlan", plan.subCategory) : plan.subCategory === "pianoPractice" ? "钢琴练习" : plan.title;
      return { id: plan.id, label, done, target, unit, isReading: false, group: taskSubjectGroup(plan), isCourse: isCourseTask(plan) };
    });
  },

  async getWeekOverview(date: string) {
    const start = getWeekStartKey(date);
    const end = getWeekEndKey(date);
    const quotaLines = await this.getPlanSummary(date, "week");
    const days = eachDayOfInterval({ start: parseISO(start), end: parseISO(end) }).map(toDateKey);
    const daily = await Promise.all(days.map((day) => this.getTasksForDate(day)));
    const grouped = new Map<string, PlanOverviewItem>();
    const travelDays = new Set<string>();
    const completedTravelDays = new Set<string>();
    // 判断任务是否应出现在本周汇总：阅读类 OR 上课类 OR 事项 OR 多日/日期范围大作业（排除钢琴练习、单日普通作业）
    const shouldIncludeInWeekSummary = (task: TaskDisplay) => {
      if (task.extraContentType === "reading") return true;   // 课外·其他｜阅读显示
      if (isCourseTask(task)) return true;
      if (task.mainCategory === "temporary") return true;     // 事项类（旅游已在调用处单独处理）
      if (task.mainCategory === "interestClass") return false; // 钢琴练习等非上课兴趣班不显示
      // 只保留日期范围或重复类型的作业（多日大作业）
      return isRangeSchedule(task) || task.timeType === "recurring";
    };
    daily.forEach((tasks, index) => tasks.filter((task) => !task.parentTaskId).forEach((task) => {
      if (task.mainCategory === "temporary" && task.subCategory === "travel") {
        travelDays.add(days[index]);
        if (task.status === "done") completedTravelDays.add(days[index]);
        return;
      }
      if (!shouldIncludeInWeekSummary(task)) return;
      const isReading = task.mainCategory === "extraHomework" && task.extraContentType === "reading";
      const current = grouped.get(task.id) ?? {
        id: task.id,
        label: task.title || (isReading ? "阅读" : subCategoryLabel(task.mainCategory, task.subCategory)),
        done: 0,
        total: 0,
        unit: "次",
        group: isReading ? "other" : taskSubjectGroup(task),
        isCourse: isCourseTask(task)
      };
      if (isRangeSchedule(task) && !isCourseTask(task)) {
        current.total = 1;
        if (task.status === "done") current.done = 1;
      } else {
        current.total += 1;
        if (task.status === "done") current.done += 1;
      }
      grouped.set(task.id, current);
    }));
    if (travelDays.size) grouped.set("temporary:travel", { id: "temporary:travel", label: "旅游", done: completedTravelDays.size, total: travelDays.size, unit: "天", group: "other", isCourse: false });
    return [
      ...quotaLines.map((item): PlanOverviewItem => ({ id: item.id, label: item.label, done: item.done, total: item.target, unit: item.unit, isReading: false, group: item.group, isCourse: item.isCourse })),
      ...grouped.values(),
    ];
  },

  async getMonthOverview(date: string) {
    const bounds = getMonthBounds(date);
    const start = bounds.start;
    const end = bounds.end;
    const [allTasks, occurrences] = await Promise.all([db.tasks.toArray(), db.taskOccurrenceStatuses.toArray()]);
    const tasks = allTasks.filter((task) => isActiveTask(task) && task.childVisible);
    const monthDays = eachDayOfInterval({ start: parseISO(start), end: parseISO(end) }).map(toDateKey);
    const overview: PlanOverviewItem[] = [];
    // 课程类任务（extraHomework class / interestClass）在下面的 interestGroups 里按自然月逐日统计，不再走 weeklyQuota 路径
    const otherQuotas = tasks.filter((task) => task.mainCategory !== "readingPlan" && task.calendarVisibility !== "hide" && task.weeklyQuota?.enabled && !isCourseTask(task));
    // 本月有多少个不同的周起始日（用于 isWeeklyRecurring 计划目标计算）
    const monthWeekCount = new Set(monthDays.map(getWeekStartKey)).size;
    otherQuotas.forEach((plan) => {
      const target = plan.weeklyQuota!.targetCount * (plan.weeklyQuota!.isWeeklyRecurring ? monthWeekCount : 1);
      const done = tasks.filter((task) => task.parentTaskId === plan.id && task.date && task.date >= start && task.date <= end && task.status === "done").reduce((sum, task) => sum + (task.amountPerSession ?? 1), 0);
      overview.push({ id: plan.id, label: plan.subCategory === "pianoPractice" ? "钢琴练习" : plan.title, done, total: target, unit: plan.weeklyQuota!.unit, group: taskSubjectGroup(plan), isCourse: isCourseTask(plan) });
    });
    tasks.filter((task) => task.timeType === "monthGoal" && task.calendarVisibility !== "hide" && task.month === getMonthKey(date)).forEach((plan) => {
      const target = plan.totalAmount ?? 1;
      overview.push({ id: plan.id, label: plan.title, done: plan.status === "done" ? target : 0, total: target, unit: plan.amountUnit ?? "次", group: taskSubjectGroup(plan), isCourse: isCourseTask(plan) });
    });
    tasks.filter((task) => task.mainCategory !== "readingPlan" && task.mainCategory !== "interestClass" && task.mainCategory !== "temporary" && !isCourseTask(task) && isRangeSchedule(task) && !!task.startDate && !!task.endDate && overlaps(task.startDate, task.endDate, start, end)).forEach((task) => {
      if (!overview.some((item) => item.id === task.id)) overview.push({ id: task.id, label: task.title || subCategoryLabel(task.mainCategory, task.subCategory), done: task.status === "done" ? 1 : 0, total: 1, unit: "次", group: taskSubjectGroup(task), isCourse: false });
    });
    const interestGroups = new Map<string, { done: number; total: number; group: PlanOverviewItem["group"]; isCourse: boolean }>();
    const countTasks = tasks.filter((item) => {
      if (item.mainCategory === "interestClass") return item.calendarVisibility !== "hide";
      if (item.mainCategory === "extraHomework") {
        if (item.extraContentType === "class") return item.calendarVisibility !== "hide";
        if (item.extraContentType === "reading") return true;
        if (item.extraContentType === "dictation") return true;
      }
      return false;
    });
    for (const task of countTasks) {
      for (const day of monthDays) {
        if (!scheduleOccursOn(task, day)) continue;
        const status = isOccurrenceSchedule(task) ? occurrences.find((item) => item.taskId === task.id && item.occurrenceDate === day)?.status ?? "todo" : task.status;
        if (status === "cancelled" || status === "postponed") continue;
        const isReading = task.mainCategory === "extraHomework" && task.extraContentType === "reading";
        const key = task.title
          ? (isReading ? `阅读 - ${task.title}` : task.title)
          : (isReading ? "阅读" : subCategoryLabel(task.mainCategory, task.subCategory));
        const group = interestGroups.get(key) ?? {
          done: 0,
          total: 0,
          group: isReading ? "other" : taskSubjectGroup(task),
          isCourse: isCourseTask(task)
        };
        group.total += 1; if (status === "done") group.done += 1;
        interestGroups.set(key, group);
      }
    }
    interestGroups.forEach((value, key) => overview.push({ id: `interest:${key}`, label: key, done: value.done, total: value.total, unit: "次", group: value.group, isCourse: value.isCourse }));
    tasks.filter((task) => task.mainCategory === "temporary" && task.subCategory !== "travel").forEach((task) => {
      const matched: { day: string; status: TaskStatus | OccurrenceStatus }[] = [];
      monthDays.forEach((day) => {
        if (!scheduleOccursOn(task, day)) return;
        const status = isOccurrenceSchedule(task) ? occurrences.find((item) => item.taskId === task.id && item.occurrenceDate === day)?.status ?? "todo" : task.status;
        if (status === "cancelled" || status === "postponed") return;
        matched.push({ day, status });
      });
      if (!matched.length) return;
      const countByDay = task.subCategory === "leisure" && isRangeSchedule(task);
      const total = countByDay ? new Set(matched.map((item) => item.day)).size : isRangeSchedule(task) ? 1 : matched.length;
      const done = countByDay ? new Set(matched.filter((item) => item.status === "done").map((item) => item.day)).size : isRangeSchedule(task) ? (task.status === "done" ? 1 : 0) : matched.filter((item) => item.status === "done").length;
      overview.push({ id: `temporary:${task.id}`, label: task.title || subCategoryLabel(task.mainCategory, task.subCategory), done, total, unit: countByDay ? "天" : "次", group: "other", isCourse: false });
    });
    const travelDays = new Set<string>();
    const completedTravelDays = new Set<string>();
    tasks.filter((task) => task.mainCategory === "temporary" && task.subCategory === "travel").forEach((task) => monthDays.forEach((day) => {
      if (!scheduleOccursOn(task, day)) return;
      const status = isOccurrenceSchedule(task) ? occurrences.find((item) => item.taskId === task.id && item.occurrenceDate === day)?.status ?? "todo" : task.status;
      if (status === "cancelled" || status === "postponed") return;
      travelDays.add(day);
      if (status === "done") completedTravelDays.add(day);
    }));
    if (travelDays.size) overview.push({ id: "temporary:travel", label: "旅游", done: completedTravelDays.size, total: travelDays.size, unit: "天", group: "other", isCourse: false });
    return overview;
  },

  async getCourseStatistics(startDate: string, endDate: string) {
    const [allTasks, occurrences] = await Promise.all([db.tasks.toArray(), db.taskOccurrenceStatuses.toArray()]);
    const tasks = allTasks.filter((task) => isActiveTask(task) && isCourseTask(task) && task.status !== "cancelled");
    const days = eachDayOfInterval({ start: parseISO(startDate), end: parseISO(endDate) }).map(toDateKey);
    const occurrenceMap = new Map(occurrences.map((item) => [`${item.taskId}:${item.occurrenceDate}`, item]));
    const counts = new Map<string, { group: string; label: string; count: number }>();
    const addCourse = (task: Task) => {
      const group = task.mainCategory === "interestClass" ? "兴趣班" : task.subCategory === "chinese" ? "语文" : task.subCategory === "math" ? "数学" : task.subCategory === "english" ? "英语" : "其他";
      const label = task.title.trim() || subCategoryLabel(task.mainCategory, task.subCategory);
      const key = `${group}:${label}`;
      const current = counts.get(key) ?? { group, label, count: 0 };
      current.count += 1;
      counts.set(key, current);
    };
    tasks.forEach((task) => days.forEach((day) => {
      if (!scheduleOccursOn(task, day)) return;
      const occurrence = isOccurrenceSchedule(task) ? occurrenceMap.get(`${task.id}:${day}`) : undefined;
      if (occurrence?.status === "cancelled" || occurrence?.status === "postponed") return;
      addCourse(task);
    }));
    occurrences.filter((item) => item.status === "postponed" && !!item.overrideDate && item.overrideDate >= startDate && item.overrideDate <= endDate).forEach((item) => {
      const task = tasks.find((value) => value.id === item.taskId);
      if (task) addCourse(task);
    });
    const groupOrder = ["语文", "数学", "英语", "兴趣班", "其他"];
    const items = [...counts.values()].sort((a, b) => groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group) || a.label.localeCompare(b.label, "zh-CN"));
    return { startDate, endDate, items, total: items.reduce((sum, item) => sum + item.count, 0) };
  },

  async allocateTask(parentId: string, weekDate?: string): Promise<number> {
    const parent = await db.tasks.get(parentId);
    if (!parent || parent.deletedAt || !["weekGoal", "assignmentWindow"].includes(parent.timeType)) throw new Error("这项任务不能自动分配");
    const recurringQuota = !!parent.weeklyQuota?.isWeeklyRecurring;
    const allocationWeekStart = recurringQuota ? getWeekStartKey(weekDate ?? todayKey()) : parent.weekStart;
    const start = parent.assignmentWindow?.startDate ?? allocationWeekStart;
    const end = parent.assignmentWindow?.endDate ?? (start ? getWeekEndKey(start) : undefined);
    if (!start || !end) throw new Error("请先设置任务周期");
    const targetAmount = parent.weeklyQuota?.targetCount ?? parent.totalAmount ?? 1;
    const desired = Math.max(1, parent.splitCount ?? (parent.weeklyQuota ? Math.min(targetAmount, 7) : parent.totalAmount ?? 1));
    const allExisting = (await db.tasks.where("parentTaskId").equals(parentId).toArray()).filter(isActiveTask);
    const existing = recurringQuota ? allExisting.filter((task) => task.allocationWeekStart === allocationWeekStart) : allExisting;
    const completed = existing.filter((task) => task.status === "done");
    const remaining = Math.max(0, desired - completed.length);
    const usedDates = new Set(completed.map((task) => task.date));
    const allowed = parent.allowedWeekdays?.length ? parent.allowedWeekdays : [0, 1, 2, 3, 4, 5, 6];
    const effectiveStart = start < todayKey() && todayKey() <= end ? todayKey() : start;
    const candidates = eachDayOfInterval({ start: parseISO(effectiveStart), end: parseISO(end) })
      .map(toDateKey).filter((key) => allowed.includes(getDay(parseISO(key))) && !usedDates.has(key));
    if (candidates.length < remaining) throw new Error("可安排日期不足，请增加可选星期或减少完成次数");
    const chosen = Array.from({ length: remaining }, (_, index) => candidates[Math.min(Math.floor(index * candidates.length / remaining), candidates.length - 1)]);
    const now = new Date().toISOString();
    const perSession = parent.amountPerSession ?? (parent.weeklyQuota ? Math.ceil(targetAmount / desired) : undefined);
    const amount = perSession ? `${perSession}${parent.weeklyQuota?.unit ?? parent.amountUnit ?? ""}` : "";

    await db.transaction("rw", db.tasks, async () => {
      // R5：软删除而非物理删除，否则云端不知道这些子任务已作废，
      // 下次全量拉取会把它们从云端 bulkPut 回本地（"重排后旧子任务复活"）。
      const staleNow = new Date().toISOString();
      const staleInfo = deviceInfo();
      await Promise.all(existing.filter((task) => task.status !== "done").map((task) =>
        db.tasks.update(task.id, { deletedAt: staleNow, deletedByDevice: staleInfo.deviceLabel, deletedByActor: staleInfo.actorName, updatedAt: staleNow })
      ));
      await db.tasks.bulkAdd(chosen.map((date, index): Task => ({
        id: makeId(), title: amount ? `${parent.title}（${amount}）` : parent.title,
        mainCategory: parent.mainCategory, subCategory: parent.subCategory, timeType: "singleDate",
        date, status: "todo", rolloverMode: parent.rolloverMode, allowRollover: parent.allowRollover,
        sortOrder: parent.sortOrder, childVisible: parent.childVisible, note: parent.note,
        amountPerSession: perSession, amountUnit: parent.weeklyQuota?.unit ?? parent.amountUnit,
        checklistItems: parent.checklistItems?.map((item, itemIndex) => ({ ...item, id: makeId(), done: false, sortOrder: itemIndex })),
        parentTaskId: parent.id, allocationWeekStart, sessionIndex: completed.length + index + 1, planPeriodId: parent.planPeriodId, applicablePeriodType: parent.applicablePeriodType,
        startTime: parent.startTime, endTime: parent.endTime, estimatedMinutes: parent.estimatedMinutes, createdAt: now, updatedAt: now,
      })));
    });
    return remaining;
  },

  async create(draft: TaskDraft) {
    const now = new Date().toISOString();
    const task: Task = sanitizeTaskWrite({ ...normalizeDraft(draft), id: makeId(), createdAt: now, updatedAt: now });
    await db.transaction("rw", db.tasks, db.activityLogs, async () => {
      await db.tasks.add(task);
      await writeLog("create", "task", { entityId: task.id, entityTitle: task.title, afterSnapshot: task });
    });
    return task;
  },

  async update(id: string, changes: Partial<TaskDraft>) {
    const existing = await db.tasks.get(id);
    if (!existing) throw new Error("找不到要更新的任务");
    const task = sanitizeTaskWrite({ ...existing, ...changes, id, updatedAt: new Date().toISOString() }, existing.status);
    const checklistChanged = Object.prototype.hasOwnProperty.call(changes, "checklistItems");
    let result = task;
    await db.transaction("rw", db.tasks, db.activityLogs, async () => {
      await db.tasks.put(task);
      await writeLog("edit", "task", { entityId: id, entityTitle: task.title, beforeSnapshot: existing, afterSnapshot: task });
      if (checklistChanged) result = (await recomputeStatusFromChecklist(id, existing)).task ?? task;
    });
    return result;
  },

  async copyToDate(id: string, date: string) {
    const source = await db.tasks.get(id);
    if (!source) throw new Error("找不到要复制的任务");
    const now = new Date().toISOString();
    const copy: Task = {
      ...source, id: makeId(), timeType: "singleDate", schedulePattern: "singleDate", date,
      startDate: undefined, endDate: undefined, weekStart: undefined, month: undefined, recurrence: undefined,
      specificDates: undefined, rangeWeekdays: undefined, assignmentWindow: undefined, weeklyQuota: undefined,
      parentTaskId: undefined, allocationWeekStart: undefined, sessionIndex: undefined, status: "todo",
      checklistItems: source.checklistItems?.map((item, index) => ({ ...item, id: makeId(), done: false, sortOrder: index })),
      createdAt: now, updatedAt: now,
    };
    await db.transaction("rw", db.tasks, db.activityLogs, async () => {
      await db.tasks.add(copy);
      await writeLog("create", "task", { entityId: copy.id, entityTitle: copy.title, afterSnapshot: copy });
    });
    return copy;
  },

  async listPlanPeriods() { return db.planPeriods.orderBy("startDate").toArray(); },

  async createPlanPeriod(input: Omit<PlanPeriod, "id" | "createdAt" | "updatedAt">) {
    const now = new Date().toISOString();
    const period: PlanPeriod = { ...input, id: makeId(), createdAt: now, updatedAt: now };
    await db.transaction("rw", db.planPeriods, db.activityLogs, async () => {
      await db.planPeriods.add(period);
      await writeLog("createHoliday", "planPeriod", { entityId: period.id, entityTitle: period.name, afterSnapshot: period });
    });
    return period;
  },

  async updatePlanPeriod(id: string, changes: Partial<Omit<PlanPeriod, "id" | "createdAt" | "updatedAt">>) {
    const before = await db.planPeriods.get(id);
    const after = before ? { ...before, ...changes, updatedAt: new Date().toISOString() } : undefined;
    if (!after) return;
    await db.transaction("rw", db.planPeriods, db.activityLogs, async () => {
      await db.planPeriods.put(after);
      await writeLog("editHoliday", "planPeriod", { entityId: id, entityTitle: after.name, beforeSnapshot: before, afterSnapshot: after });
    });
  },

  async removePlanPeriod(id: string) {
    const before = await db.planPeriods.get(id);
    await db.transaction("rw", db.planPeriods, db.tasks, db.activityLogs, async () => {
      await db.planPeriods.delete(id);
      await db.tasks.where("planPeriodId").equals(id).modify({ planPeriodId: undefined, applicablePeriodType: "all" });
      await writeLog("deleteHoliday", "planPeriod", { entityId: id, entityTitle: before?.name, beforeSnapshot: before });
    });
  },

  // ── 课程库（TASK_02）。仿假期阶段，本地 CRUD + 操作日志。 ────────────────────
  async listCourses() { return db.courses.orderBy("sortOrder").toArray(); },

  async createCourse(input: Omit<Course, "id" | "createdAt" | "updatedAt">) {
    const now = new Date().toISOString();
    const course: Course = { ...input, id: makeId(), createdAt: now, updatedAt: now };
    await db.transaction("rw", db.courses, db.activityLogs, async () => {
      await db.courses.add(course);
      await writeLog("createCourse", "course", { entityId: course.id, entityTitle: course.name, afterSnapshot: course });
    });
    return course;
  },

  async updateCourse(id: string, changes: Partial<Omit<Course, "id" | "createdAt" | "updatedAt">>) {
    const before = await db.courses.get(id);
    const after = before ? { ...before, ...changes, updatedAt: new Date().toISOString() } : undefined;
    if (!after) return;
    await db.transaction("rw", db.courses, db.activityLogs, async () => {
      await db.courses.put(after);
      await writeLog("editCourse", "course", { entityId: id, entityTitle: after.name, beforeSnapshot: before, afterSnapshot: after });
    });
  },

  async removeCourse(id: string) {
    const before = await db.courses.get(id);
    // 课程删除不影响历史任务：只清掉任务上的 courseId 绑定，保留任务本身。
    await db.transaction("rw", db.courses, db.tasks, db.activityLogs, async () => {
      await db.courses.delete(id);
      await db.tasks.where("courseId").equals(id).modify({ courseId: undefined });
      await writeLog("deleteCourse", "course", { entityId: id, entityTitle: before?.name, beforeSnapshot: before });
    });
  },

  async remove(id: string) {
    const task = await db.tasks.get(id);
    if (!task || task.deletedAt) return;
    const now = new Date().toISOString();
    const info = deviceInfo();
    await db.transaction("rw", db.tasks, db.activityLogs, async () => {
      await db.tasks.update(id, { deletedAt: now, deletedByDevice: info.deviceLabel, deletedByActor: info.actorName, updatedAt: now });
      await db.tasks.where("parentTaskId").equals(id).modify({ deletedAt: now, deletedByDevice: info.deviceLabel, deletedByActor: info.actorName, updatedAt: now });
      await writeLog("delete", "task", { entityId: id, entityTitle: task.title, beforeSnapshot: task, afterSnapshot: { deletedAt: now } });
    });
  },

  async batchRemove(ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    const tasks = (await db.tasks.bulkGet(uniqueIds)).filter((task): task is Task => !!task && !task.deletedAt);
    if (!tasks.length) return 0;
    const now = new Date().toISOString();
    const info = deviceInfo();
    await db.transaction("rw", db.tasks, db.activityLogs, async () => {
      await Promise.all(tasks.map((task) => db.tasks.update(task.id, { deletedAt: now, deletedByDevice: info.deviceLabel, deletedByActor: info.actorName, updatedAt: now })));
      await db.tasks.where("parentTaskId").anyOf(tasks.map((task) => task.id)).modify({ deletedAt: now, deletedByDevice: info.deviceLabel, deletedByActor: info.actorName, updatedAt: now });
      await writeLog("batchDelete", "task", { entityTitle: `批量删除 ${tasks.length} 项`, beforeSnapshot: tasks, afterSnapshot: { taskIds: tasks.map((task) => task.id), deletedAt: now } });
    });
    return tasks.length;
  },

  async restore(id: string) {
    const task = await db.tasks.get(id);
    if (!task?.deletedAt) return;
    await db.transaction("rw", db.tasks, db.activityLogs, async () => {
      await db.tasks.update(id, { deletedAt: undefined, deletedByDevice: undefined, deletedByActor: undefined, updatedAt: new Date().toISOString() });
      await writeLog("restore", "task", { entityId: id, entityTitle: task.title, beforeSnapshot: task });
    });
  },

  async setDisplayStatus(task: TaskDisplay, status: TaskStatus): Promise<SyncResult> {
    // R1：按排期类型（而非展示字段）决定权威源——occurrence 类写单日状态表，其余写任务本体。
    // 被历史 bug 污染了 occurrenceDate 的非重复任务因此也能正确回到本体写入路径。
    if (isOccurrenceSchedule(task)) {
      if (!task.occurrenceDate) throw new Error("重复类任务缺少单日日期，无法记录完成状态");
      return this.setOccurrence(task.id, task.occurrenceDate, status);
    }
    const before = await db.tasks.get(task.id);
    const now = new Date().toISOString();
    let parentId: string | undefined;
    await db.transaction("rw", db.tasks, db.activityLogs, async () => {
      await db.tasks.update(task.id, { status, completedAt: status === "done" ? now : undefined, checklistItems: task.checklistItems?.map((item) => ({ ...item, done: status === "done" ? true : status === "todo" ? false : item.done })), updatedAt: now });
      await writeLog(status === "done" ? "complete" : "uncomplete", "task", { entityId: task.id, entityTitle: task.title, beforeSnapshot: before, afterSnapshot: { status } });
      parentId = await syncParentCompletion(task.id);
    });
    return { parentId, synced: true };
  },

  async saveActualMinutes(taskId: string, itemId: string | null, additionalMinutes: number): Promise<void> {
    const now = new Date().toISOString();
    const task = await db.tasks.get(taskId);
    if (!task) return;
    if (itemId) {
      const items = (task.checklistItems ?? []).map((item) =>
        item.id === itemId
          ? { ...item, actualMinutes: (item.actualMinutes ?? 0) + additionalMinutes }
          : item
      );
      await db.tasks.update(taskId, { checklistItems: items, updatedAt: now });
    } else {
      await db.tasks.update(taskId, {
        actualMinutes: (task.actualMinutes ?? 0) + additionalMinutes,
        updatedAt: now,
      });
    }
  },

  async toggleChecklistItem(taskId: string, itemId: string, occurrenceDate?: string): Promise<SyncResult> {
    const task = await db.tasks.get(taskId);
    if (!task?.checklistItems) return { synced: true };
    const items = task.checklistItems.map((item) => item.id === itemId ? { ...item, done: !item.done } : item);
    const allDone = items.every((item) => item.done);
    const now = new Date().toISOString();
    let parentId: string | undefined;

    if (isOccurrenceSchedule(task)) {
      // R1：重复类任务本体 status/completedAt 不动，完成状态只写 occurrence 表
      await db.transaction("rw", db.tasks, db.taskOccurrenceStatuses, db.activityLogs, async () => {
        await db.tasks.update(taskId, { checklistItems: items, updatedAt: now });
        if (occurrenceDate) {
          const id = `${taskId}:${occurrenceDate}`;
          const existing = await db.taskOccurrenceStatuses.get(id);
          const status: OccurrenceStatus = allDone ? "done" : existing?.status === "done" ? "todo" : existing?.status ?? "todo";
          // R2：patch 语义，保留 override 字段
          await db.taskOccurrenceStatuses.put({ ...existing, id, taskId, occurrenceDate, status, createdAt: existing?.createdAt ?? now, updatedAt: now });
          if (status !== (existing?.status ?? "todo")) await writeLog(status === "done" ? "complete" : "uncomplete", "taskOccurrence", { entityId: id, entityTitle: task.title, beforeSnapshot: existing, afterSnapshot: { status, checklistItems: items } });
        }
      });
      return { synced: true };
    }

    await db.transaction("rw", db.tasks, db.activityLogs, async () => {
      await db.tasks.update(taskId, { checklistItems: items, updatedAt: now });
      parentId = (await recomputeStatusFromChecklist(taskId, task)).parentId;
    });
    return { parentId, synced: true };
  },

  async setOccurrence(taskId: string, occurrenceDate: string, status: OccurrenceStatus, overrideDate?: string, overrideNote?: string): Promise<SyncResult> {
    const id = `${taskId}:${occurrenceDate}`;
    const existing = await db.taskOccurrenceStatuses.get(id);
    const now = new Date().toISOString();
    const task = await db.tasks.get(taskId);
    await db.transaction("rw", db.taskOccurrenceStatuses, db.activityLogs, async () => {
      // R2：patch 语义——未显式传入的 override 字段保留原值，完成/取消一个已延期的任务不会抹掉延期记录
      const after = { ...existing, id, taskId, occurrenceDate, status, overrideDate: overrideDate ?? existing?.overrideDate, overrideNote: overrideNote ?? existing?.overrideNote, createdAt: existing?.createdAt ?? now, updatedAt: now };
      await db.taskOccurrenceStatuses.put(after);
      const action = status === "cancelled" ? "cancelOccurrence" : status === "postponed" ? "postponeOccurrence" : status === "done" ? "complete" : "uncomplete";
      await writeLog(action, "taskOccurrence", { entityId: id, entityTitle: task?.title, beforeSnapshot: existing, afterSnapshot: after });
    });
    return { synced: true };
  },

  /** 手动重试：把本地当前状态原样重新同步到云端，不触发任何本地状态变化（本地模式无需处理，直接视为已同步） */
  async resyncTask(_taskId: string, _occurrenceDate?: string): Promise<boolean> {
    return true;
  },

  async listReadingLogs(taskId: string, weekDate: string) {
    const weekStart = getWeekStartKey(weekDate);
    return db.readingLogs.where("[taskId+weekStart]").equals([taskId, weekStart]).reverse().sortBy("createdAt");
  },

  async addReadingLog(input: { taskId: string; date: string; amount: number; title?: string; note?: string }) {
    const task = await db.tasks.get(input.taskId);
    if (!task || task.deletedAt || task.mainCategory !== "readingPlan" || !task.weeklyQuota) throw new Error("找不到对应的阅读计划");
    if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("阅读数量必须大于 0");
    const now = new Date().toISOString();
    const log: ReadingLog = {
      id: makeId(), taskId: task.id, weekStart: getWeekStartKey(input.date), date: input.date,
      readingType: task.subCategory === "chineseReading" ? "中文阅读" : "英文阅读",
      amount: input.amount, unit: task.weeklyQuota.unit, title: input.title?.trim() || undefined,
      note: input.note?.trim() || undefined, deviceLabel: deviceInfo().deviceLabel, createdAt: now, updatedAt: now,
    };
    await db.transaction("rw", db.readingLogs, db.activityLogs, async () => {
      await db.readingLogs.add(log);
      await writeLog("recordReading", "readingLog", { entityId: log.id, entityTitle: `${log.readingType} ${log.amount}${log.unit}`, afterSnapshot: log });
    });
    return log;
  },

  async undoLatestReadingLog(taskId: string, weekDate: string) {
    const logs = await this.listReadingLogs(taskId, weekDate);
    const latest = logs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!latest) return false;
    await db.transaction("rw", db.readingLogs, db.activityLogs, async () => {
      await db.readingLogs.delete(latest.id);
      await writeLog("undoReading", "readingLog", { entityId: latest.id, entityTitle: `${latest.readingType} ${latest.amount}${latest.unit}`, beforeSnapshot: latest });
    });
    return true;
  },

  async exportBackup(): Promise<BackupData> {
    const backup: BackupData = { version: 7, exportedAt: new Date().toISOString(), tasks: await db.tasks.toArray(), taskOccurrenceStatuses: await db.taskOccurrenceStatuses.toArray(), planPeriods: await db.planPeriods.toArray(), activityLogs: await db.activityLogs.toArray(), readingLogs: await db.readingLogs.toArray() };
    await writeLog("export", "backup", { entityTitle: "JSON 备份", afterSnapshot: { exportedAt: backup.exportedAt, taskCount: backup.tasks.length } });
    return backup;
  },

  async importBackup(input: unknown) {
    if (!input || typeof input !== "object") throw new Error("这不是有效的备份文件");
    const data = input as { version?: number; tasks?: unknown[]; taskOccurrenceStatuses?: unknown[]; planPeriods?: unknown[]; activityLogs?: ActivityLog[]; readingLogs?: ReadingLog[] };
    if (![1, 2, 3, 4, 5, 6, 7].includes(data.version ?? 0) || !Array.isArray(data.tasks) || !Array.isArray(data.taskOccurrenceStatuses)) throw new Error("备份格式不正确或版本不受支持");
    if (data.tasks.some((task) => !task || typeof task !== "object" || typeof (task as Record<string, unknown>).id !== "string" || typeof (task as Record<string, unknown>).title !== "string")) throw new Error("备份中的任务数据不完整");
    const tasks = data.tasks.map((task) => normalizeImported(task as Record<string, unknown>));
    const importedPeriods = Array.isArray(data.planPeriods) ? data.planPeriods as PlanPeriod[] : [];
    const regularIds = new Set(importedPeriods.filter((period) => period.type === "regular").map((period) => period.id));
    tasks.forEach((task) => { if (task.planPeriodId && regularIds.has(task.planPeriodId)) { task.applicablePeriodType = "regular"; task.planPeriodId = undefined; } else task.applicablePeriodType ??= task.planPeriodId ? "holiday" : "all"; });
    await db.transaction("rw", db.tasks, db.taskOccurrenceStatuses, db.planPeriods, db.activityLogs, db.readingLogs, async () => {
      await db.tasks.clear(); await db.taskOccurrenceStatuses.clear(); await db.planPeriods.clear(); await db.activityLogs.clear(); await db.readingLogs.clear();
      await db.tasks.bulkPut(tasks); await db.taskOccurrenceStatuses.bulkPut(data.taskOccurrenceStatuses as TaskOccurrenceStatus[]);
      if (importedPeriods.length) await db.planPeriods.bulkPut(importedPeriods);
      if (Array.isArray(data.activityLogs)) await db.activityLogs.bulkPut(data.activityLogs);
      if (Array.isArray(data.readingLogs)) await db.readingLogs.bulkPut(data.readingLogs);
      await writeLog("import", "backup", { entityTitle: "JSON 备份", afterSnapshot: { version: data.version, taskCount: tasks.length } });
    });
  },

  async listActivityLogs(limit = 100) { return (await db.activityLogs.orderBy("createdAt").reverse().toArray()).filter((log) => { const before = log.beforeSnapshot as { mainCategory?: string } | undefined; const after = log.afterSnapshot as { mainCategory?: string } | undefined; return log.entityType !== "readingLog" && !["recordReading", "undoReading"].includes(log.actionType) && before?.mainCategory !== "readingPlan" && after?.mainCategory !== "readingPlan"; }).slice(0, limit); },

  async findTimeConflicts(draft: TaskDraft, excludeId?: string) {
    const start = draft.startTime ?? draft.time;
    const end = draft.endTime ?? (start && draft.estimatedMinutes ? addMinutesToTime(start, draft.estimatedMinutes) : undefined);
    if (!start || !end) return [] as TaskDisplay[];
    const dates = candidateDates(draft).slice(0, 120);
    const conflicts: TaskDisplay[] = [];
    for (const date of dates) {
      const tasks = await this.getTasksForDate(date);
      for (const task of tasks) {
        if (task.id === excludeId || task.status === "done" || task.status === "cancelled" || !task.childVisible) continue;
        const otherStart = task.startTime ?? task.time;
        const otherEnd = task.endTime ?? (otherStart && task.estimatedMinutes ? addMinutesToTime(otherStart, task.estimatedMinutes) : undefined);
        if (otherStart && otherEnd && start < otherEnd && end > otherStart) conflicts.push({ ...task, occurrenceDate: task.occurrenceDate ?? date });
      }
    }
    return conflicts;
  },
};

function addMinutesToTime(time: string, minutes: number) {
  const [hour, minute] = time.split(":").map(Number);
  const total = hour * 60 + minute + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function candidateDates(task: Partial<Task>) {
  if (task.schedulePattern === "specificDates") return task.specificDates ?? [];
  if (task.timeType === "singleDate" && task.date) return [task.date];
  const start = task.recurrence?.startDate ?? task.startDate;
  const rawEnd = task.recurrence?.endDate ?? task.endDate ?? (start ? toDateKey(addDays(parseISO(start), 90)) : undefined);
  if (!start || !rawEnd) return [];
  return eachDayOfInterval({ start: parseISO(start), end: parseISO(rawEnd) }).map(toDateKey).filter((date) => scheduleOccursOn(task as Task, date));
}
