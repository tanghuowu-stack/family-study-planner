import Dexie, { type EntityTable } from "dexie";
import type { ActivityLog, Course, MainCategory, PlanPeriod, ReadingLog, Task, TaskOccurrenceStatus } from "../types/task";

type LegacyTask = Record<string, unknown> & { category?: string; subType?: string; courseType?: string };

const migrateCategory = (task: LegacyTask): { mainCategory: MainCategory; subCategory: string } => {
  if (task.category === "schoolHomework") return { mainCategory: "school", subCategory: task.subType ?? "other" };
  if (task.category === "reading") return { mainCategory: "readingPlan", subCategory: "dailyReading" };
  if (["examPractice", "extraClass"].includes(task.category ?? "")) {
    const sub = task.courseType === "aoshu" ? "math" : task.courseType === "chinese" ? "chinese" : "english";
    return { mainCategory: "extraHomework", subCategory: sub };
  }
  if (task.category === "sportsArt") {
    const sub = task.courseType === "swimming" ? "swimmingClass" : task.courseType === "piano" ? "pianoPractice" : "other";
    return { mainCategory: "interestClass", subCategory: sub };
  }
  return { mainCategory: "temporary", subCategory: task.category === "familyActivity" ? "leisure" : task.category === "specialDate" ? "examCompetition" : "other" };
};

export class PlannerDatabase extends Dexie {
  tasks!: EntityTable<Task, "id">;
  taskOccurrenceStatuses!: EntityTable<TaskOccurrenceStatus, "id">;
  planPeriods!: EntityTable<PlanPeriod, "id">;
  activityLogs!: EntityTable<ActivityLog, "id">;
  readingLogs!: EntityTable<ReadingLog, "id">;
  courses!: EntityTable<Course, "id">;

  constructor() {
    super("familyLearningPlanner");
    this.version(1).stores({
      tasks: "id, timeType, category, date, startDate, endDate, weekStart, month, status, updatedAt",
      taskOccurrenceStatuses: "id, taskId, occurrenceDate, [taskId+occurrenceDate], status",
    });
    this.version(2).stores({
      tasks: "id, timeType, mainCategory, subCategory, date, startDate, endDate, weekStart, status, parentTaskId, updatedAt",
      taskOccurrenceStatuses: "id, taskId, occurrenceDate, overrideDate, [taskId+occurrenceDate], status",
    }).upgrade(async (transaction) => {
      await transaction.table("tasks").toCollection().modify((task: LegacyTask) => {
        if (!task.mainCategory) Object.assign(task, migrateCategory(task));
        task.rolloverMode ??= task.mainCategory === "extraHomework" ? "autoNextDay" : "keepOverdue";
        task.allowRollover ??= task.rolloverMode === "autoNextDay";
        task.sortOrder ??= 999;
        if (task.timeType === "monthGoal") task.timeType = "singleDate";
      });
    });
    this.version(3).stores({
      tasks: "id, timeType, mainCategory, subCategory, date, startDate, endDate, weekStart, month, status, parentTaskId, updatedAt",
      taskOccurrenceStatuses: "id, taskId, occurrenceDate, overrideDate, [taskId+occurrenceDate], status",
    }).upgrade(async (transaction) => {
      await transaction.table("tasks").toCollection().modify((task: Record<string, unknown>) => {
        if (task.mainCategory === "schoolHomework") task.mainCategory = "school";
        if (task.mainCategory === "interestClass") {
          const mapping: Record<string, string> = {
            jumpRopeClass: "other", aoshuClass: "aoshu", chineseClass: "dazeng", englishClass: "cambridge",
          };
          task.subCategory = mapping[String(task.subCategory)] ?? task.subCategory;
        }
        if (task.mainCategory === "reading") {
          task.mainCategory = "readingPlan";
          task.subCategory = task.timeType === "weekGoal" ? "weeklyReading" : "dailyReading";
        }
      });
    });
    this.version(4).stores({
      tasks: "id, timeType, mainCategory, subCategory, date, startDate, endDate, weekStart, month, status, parentTaskId, allocationWeekStart, planPeriodId, updatedAt",
      taskOccurrenceStatuses: "id, taskId, occurrenceDate, overrideDate, [taskId+occurrenceDate], status",
      planPeriods: "id, type, startDate, endDate, isActive, updatedAt",
    }).upgrade(async (transaction) => {
      await transaction.table("tasks").toCollection().modify((task: Record<string, unknown>) => {
        if (task.mainCategory === "readingPlan") {
          const text = `${String(task.title ?? "")} ${String(task.subCategory ?? "")}`.toLowerCase();
          task.subCategory = text.includes("中文") || text.includes("chinese") ? "chineseReading" : "englishReading";
          if (!task.weeklyQuota) {
            const target = Number(task.readingTargetCount ?? task.totalAmount ?? 1);
            task.weeklyQuota = { enabled: true, targetCount: target, unit: task.readingTargetUnit ?? task.amountUnit ?? "本", isWeeklyRecurring: true, allowAutoDistribute: true, allowRollover: true };
          }
          if (task.timeType !== "weekGoal") task.timeType = "weekGoal";
        }
        task.schedulePattern ??= task.timeType === "recurring" ? "weeklyRecurring" : task.timeType === "dateRange" ? "dateRangeDaily" : "singleDate";
        task.startTime ??= task.time;
      });
    });
    this.version(5).stores({
      tasks: "id, timeType, mainCategory, subCategory, extraContentType, calendarVisibility, date, startDate, endDate, weekStart, month, status, parentTaskId, allocationWeekStart, planPeriodId, updatedAt",
      taskOccurrenceStatuses: "id, taskId, occurrenceDate, overrideDate, [taskId+occurrenceDate], status",
      planPeriods: "id, type, startDate, endDate, isActive, updatedAt",
    }).upgrade(async (transaction) => {
      await transaction.table("tasks").toCollection().modify((task: Record<string, unknown>) => {
        const title = String(task.title ?? "");
        if (task.mainCategory === "interestClass") {
          const sub = String(task.subCategory ?? "");
          const learning: Record<string, [string, string]> = { aoshu: ["math", "奥数课"], dazeng: ["chinese", "语文课"], cambridge: ["english", "FCE 课"] };
          if (learning[sub]) {
            task.mainCategory = "extraHomework"; task.subCategory = learning[sub][0]; task.extraContentType = "class";
            if (!title.trim()) task.title = learning[sub][1];
          } else if (sub === "pianoClass") task.subCategory = "piano";
          else if (sub === "swimmingClass") task.subCategory = "swimming";
          else if (sub === "rollerSkatingClass") task.subCategory = "rollerSkating";
          else if (sub === "other") { task.mainCategory = "extraHomework"; task.subCategory = "other"; task.extraContentType = "other"; }
        }
        if (task.mainCategory === "extraHomework") {
          if (task.subCategory === "chineseRecitation") { task.subCategory = "chinese"; task.extraContentType = "recitation"; if (!title.trim()) task.title = "语文背诵"; }
          else if (task.subCategory === "englishDictation") { task.subCategory = "english"; task.extraContentType = "dictation"; if (!title.trim()) task.title = "英语听写"; }
          task.extraContentType ??= inferExtraContent(title);
        }
        task.calendarVisibility ??= defaultCalendarVisibility(task);
        if (task.calendarVisibility === "hide") { task.rolloverMode = "skipIfMissed"; task.allowRollover = false; }
      });
    });
    this.version(6).stores({
      tasks: "id, timeType, mainCategory, subCategory, extraContentType, calendarVisibility, date, startDate, endDate, weekStart, month, status, parentTaskId, allocationWeekStart, planPeriodId, deletedAt, updatedAt",
      taskOccurrenceStatuses: "id, taskId, occurrenceDate, overrideDate, [taskId+occurrenceDate], status",
      planPeriods: "id, type, startDate, endDate, isActive, updatedAt",
      activityLogs: "id, actionType, entityType, entityId, createdAt",
    }).upgrade(async (transaction) => {
      const periods = await transaction.table("planPeriods").toArray() as PlanPeriod[];
      const regularIds = new Set(periods.filter((period) => period.type === "regular").map((period) => period.id));
      await transaction.table("tasks").toCollection().modify((task: Record<string, unknown>) => {
        if (typeof task.planPeriodId === "string" && regularIds.has(task.planPeriodId)) {
          task.applicablePeriodType = "regular";
          delete task.planPeriodId;
        } else if (task.planPeriodId) task.applicablePeriodType = "holiday";
        else task.applicablePeriodType ??= "all";
      });
    });
    this.version(7).stores({
      tasks: "id, timeType, mainCategory, subCategory, extraContentType, calendarVisibility, date, startDate, endDate, weekStart, month, status, parentTaskId, allocationWeekStart, planPeriodId, deletedAt, updatedAt",
      taskOccurrenceStatuses: "id, taskId, occurrenceDate, overrideDate, [taskId+occurrenceDate], status",
      planPeriods: "id, type, startDate, endDate, isActive, updatedAt",
      activityLogs: "id, actionType, entityType, entityId, createdAt",
      readingLogs: "id, taskId, weekStart, date, [taskId+weekStart], createdAt",
    });
    // 版本 8：新增课程库表（TASK_02），tasks 增加可选 courseId 索引。仅加表，不迁移现有数据。
    this.version(8).stores({
      tasks: "id, timeType, mainCategory, subCategory, extraContentType, calendarVisibility, date, startDate, endDate, weekStart, month, status, parentTaskId, allocationWeekStart, planPeriodId, courseId, deletedAt, updatedAt",
      taskOccurrenceStatuses: "id, taskId, occurrenceDate, overrideDate, [taskId+occurrenceDate], status",
      planPeriods: "id, type, startDate, endDate, isActive, updatedAt",
      activityLogs: "id, actionType, entityType, entityId, createdAt",
      readingLogs: "id, taskId, weekStart, date, [taskId+weekStart], createdAt",
      courses: "id, mainCategory, subCategory, status, sortOrder, updatedAt",
    });
  }
}

function inferExtraContent(title: string) {
  if (/听写/.test(title)) return "dictation";
  if (/背诵/.test(title)) return "recitation";
  if (/课$|上课|课程/.test(title)) return "class";
  if (/练习|计算|口算/.test(title)) return "practice";
  if (/作业/.test(title)) return "homework";
  return "other";
}

function defaultCalendarVisibility(task: Record<string, unknown>) {
  const title = String(task.title ?? "");
  const content = String(task.extraContentType ?? "");
  const daily = (task.recurrence as { frequency?: string } | undefined)?.frequency === "daily" || task.schedulePattern === "dailyRecurring";
  return content === "dictation" || (content === "practice" && /每日|计算|口算/.test(title)) || (content === "recitation" && daily) ? "hide" : "show";
}

export const db = new PlannerDatabase();
