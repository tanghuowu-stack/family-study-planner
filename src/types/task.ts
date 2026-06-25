export type TaskStatus = "todo" | "doing" | "done" | "cancelled" | "overdue";
export type OccurrenceStatus = TaskStatus | "postponed";

export type MainCategory = "school" | "extraHomework" | "interestClass" | "readingPlan" | "temporary";

export type SchoolHomeworkType = "chinese" | "math" | "english" | "other";
export type ExtraHomeworkType = "chinese" | "math" | "english" | "other";
export type ExtraContentType = "class" | "homework" | "practice" | "dictation" | "recitation" | "other" | "reading";
export type InterestClassType =
  | "piano" | "swimming" | "rollerSkating" | "pianoPractice";
export type ReadingPlanType = "chineseReading" | "englishReading";
export type TemporaryType = "examCompetition" | "travel" | "leisure" | "other";
export type SubCategory = SchoolHomeworkType | ExtraHomeworkType | InterestClassType | ReadingPlanType | TemporaryType;

export type TaskTimeType = "singleDate" | "dateRange" | "weekGoal" | "monthGoal" | "assignmentWindow" | "recurring";
export type RolloverMode = "autoNextDay" | "keepOverdue" | "skipIfMissed";
export type PlanPeriodType = "regular" | "holiday" | "custom";
export type ApplicablePeriodType = "all" | "regular" | "holiday";
export type SchedulePattern = "singleDate" | "dailyRecurring" | "weeklyRecurring" | "specificDates" | "dateRangeDaily" | "dateRangeWeekdays";

export interface WeeklyQuota {
  enabled: boolean;
  targetCount: number;
  unit: "本" | "页" | "分钟" | "次" | "篇" | "题";
  isWeeklyRecurring: boolean;
  allowAutoDistribute: boolean;
  allowRollover: boolean;
}

export interface PlanPeriod {
  id: string;
  name: string;
  type: PlanPeriodType;
  startDate: string;
  endDate: string;
  isActive: boolean;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export type CourseStatus = "active" | "ended" | "planned";

/** 课程固定上课规律（仅作默认带出，不做自动排课） */
export interface CourseSchedule {
  weekdays?: number[];
  startTime?: string;
  endTime?: string;
}

/**
 * 课程库：把会变动的“课程”从硬编码字符串变成可配置数据（TASK_02）。
 * 字段对齐 task 的分类字段，选课时 1:1 带出，无需翻译层。
 * 仅用于 extraHomework（课外）与 interestClass（兴趣班）两类。
 */
export interface Course {
  id: string;
  name: string;
  mainCategory: MainCategory;
  subCategory: string;
  extraContentType?: ExtraContentType;
  isClass: boolean;
  status: CourseStatus;
  startDate?: string;
  endDate?: string;
  schedule?: CourseSchedule;
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
}

export interface RecurrenceRule {
  frequency: "daily" | "weekly" | "monthly";
  weekdays?: number[];
  monthDay?: number;
  startDate: string;
  endDate?: string;
}

export interface AssignmentWindow {
  sourceClassDate?: string;
  startDate: string;
  endDate: string;
}

export interface ChecklistItem {
  id: string;
  title: string;
  done: boolean;
  sortOrder?: number;
}

export interface Task {
  id: string;
  title: string;
  mainCategory: MainCategory;
  subCategory: string;
  extraContentType?: ExtraContentType;
  courseId?: string;
  timeType: TaskTimeType;
  date?: string;
  startDate?: string;
  endDate?: string;
  weekStart?: string;
  month?: string;
  recurrence?: RecurrenceRule;
  schedulePattern?: SchedulePattern;
  specificDates?: string[];
  rangeWeekdays?: number[];
  assignmentWindow?: AssignmentWindow;
  weeklyQuota?: WeeklyQuota;
  applicablePeriodType?: ApplicablePeriodType;
  planPeriodId?: string;
  status: TaskStatus;
  rolloverMode: RolloverMode;
  allowRollover: boolean;
  totalAmount?: number;
  amountUnit?: string;
  splitCount?: number;
  amountPerSession?: number;
  readingTargetCount?: number;
  readingTargetUnit?: "本" | "页" | "分钟";
  allowedWeekdays?: number[];
  allowWeekend?: boolean;
  sortOrder?: number;
  childVisible: boolean;
  note?: string;
  time?: string;
  startTime?: string;
  endTime?: string;
  estimatedMinutes?: number;
  location?: string;
  important?: boolean;
  calendarVisibility?: "show" | "hide";
  parentTaskId?: string;
  sessionIndex?: number;
  allocationWeekStart?: string;
  checklistItems?: ChecklistItem[];
  completedAt?: string;
  deletedAt?: string;
  deletedByDevice?: string;
  deletedByActor?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDisplay extends Task {
  occurrenceDate?: string;
  occurrenceStatus?: OccurrenceStatus;
  overrideDate?: string;
  overrideNote?: string;
  rolledFromDate?: string;
}

export interface TaskOccurrenceStatus {
  id: string;
  taskId: string;
  occurrenceDate: string;
  status: OccurrenceStatus;
  overrideDate?: string;
  overrideTitle?: string;
  overrideNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReadingLog {
  id: string;
  taskId: string;
  weekStart: string;
  date: string;
  readingType: "中文阅读" | "英文阅读";
  amount: number;
  unit: WeeklyQuota["unit"];
  title?: string;
  note?: string;
  deviceLabel?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlanOverviewItem {
  id: string;
  label: string;
  done: number;
  total: number;
  unit: string;
  isReading?: boolean;
  group: "chinese" | "math" | "english" | "other";
  isCourse?: boolean;
}

export type TaskDraft = Omit<Task, "id" | "createdAt" | "updatedAt">;

export type ActivityActionType =
  | "create" | "edit" | "complete" | "uncomplete" | "delete" | "batchDelete" | "restore"
  | "cancelOccurrence" | "postponeOccurrence" | "createHoliday" | "editHoliday" | "deleteHoliday"
  | "createCourse" | "editCourse" | "deleteCourse"
  | "recordReading" | "undoReading" | "import" | "export";

export interface ActivityLog {
  id: string;
  actionType: ActivityActionType;
  entityType: "task" | "taskOccurrence" | "planPeriod" | "course" | "readingLog" | "backup";
  entityId?: string;
  entityTitle?: string;
  beforeSnapshot?: unknown;
  afterSnapshot?: unknown;
  actorName: string;
  deviceType: string;
  deviceLabel: string;
  browser: string;
  createdAt: string;
}

export interface BackupData {
  version: 7;
  exportedAt: string;
  tasks: Task[];
  taskOccurrenceStatuses: TaskOccurrenceStatus[];
  planPeriods: PlanPeriod[];
  activityLogs: ActivityLog[];
  readingLogs: ReadingLog[];
}
