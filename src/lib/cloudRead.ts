import { supabase } from "./supabase";
import { db } from "../data/db";
import type { Task, ChecklistItem, TaskOccurrenceStatus, PlanPeriod } from "../types/task";

export interface CloudPreviewResult {
  localCounts: {
    tasks: number;
    checklistItems: number;
    occurrenceStatuses: number;
    planPeriods: number;
  };
  cloudCounts: {
    tasks: number;
    activeTasks: number;
    deletedTasks: number;
    checklistItems: number;
    occurrenceStatuses: number;
    planPeriods: number;
  };
  recentTasks: Task[];
}

export function rowToTask(row: any): Task {
  return {
    id: row.id,
    title: row.title ?? "",
    mainCategory: row.main_category,
    subCategory: row.sub_category,
    extraContentType: row.extra_content_type ?? undefined,
    courseId: row.course_id ?? undefined,
    timeType: row.time_type,
    schedulePattern: row.schedule_pattern ?? undefined,
    date: row.date ?? undefined,
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
    weekStart: row.week_start ?? undefined,
    specificDates: row.specific_dates ?? undefined,
    rangeWeekdays: row.range_weekdays ?? undefined,
    assignmentWindow: row.assignment_window ?? undefined,
    recurrence: row.recurrence ?? undefined,
    weeklyQuota: row.weekly_quota ?? undefined,
    applicablePeriodType: row.applicable_period_type ?? undefined,
    planPeriodId: row.plan_period_id ?? undefined,
    status: row.status,
    rolloverMode: row.rollover_mode,
    allowRollover: row.allow_rollover,
    calendarVisibility: row.calendar_visibility,
    childVisible: row.child_visible,
    sortOrder: row.sort_order,
    time: row.start_time ?? undefined,
    startTime: row.start_time ?? undefined,
    endTime: row.end_time ?? undefined,
    estimatedMinutes: row.estimated_minutes ?? undefined,
    location: row.location ?? undefined,
    note: row.note ?? undefined,
    important: row.important,
    parentTaskId: row.parent_task_id ?? undefined,
    sessionIndex: row.session_index ?? undefined,
    allocationWeekStart: row.allocation_week_start ?? undefined,
    completedAt: row.completed_at ?? undefined,
    enableStreak: row.enable_streak ?? undefined,
    streakStartDate: row.streak_start_date ?? undefined,
    deletedAt: row.deleted_at ?? undefined,
    deletedByDevice: row.deleted_by_device ?? undefined,
    deletedByActor: row.deleted_by_actor ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...row.metadata, // 展开低频字段
  };
}

export async function fetchCloudDataPreview(familyId: string): Promise<CloudPreviewResult> {
  if (!supabase) throw new Error("Supabase 未配置");

  // 1. 读取本地数量
  const [localTasks, localOccurrences, localPeriods] = await Promise.all([
    db.tasks.toArray(),
    db.taskOccurrenceStatuses.count(),
    db.planPeriods.count(),
  ]);
  
  let localChecklistItems = 0;
  localTasks.forEach(t => {
    if (t.checklistItems) localChecklistItems += t.checklistItems.length;
  });

  // 2. 读取云端数据
  // Supabase RLS 或 family_id 过滤
  const [
    { data: tasksData, error: tasksError },
    { data: checklistData, error: checklistError },
    { count: occurrencesCount, error: occurrencesError },
    { count: periodsCount, error: periodsError }
  ] = await Promise.all([
    supabase.from("tasks").select("*").eq("family_id", familyId).order('created_at', { ascending: false }),
    supabase.from("task_checklist_items").select("*").eq("family_id", familyId).order('sort_order', { ascending: true }),
    supabase.from("task_occurrence_statuses").select("*", { count: 'exact', head: true }).eq("family_id", familyId),
    supabase.from("plan_periods").select("*", { count: 'exact', head: true }).eq("family_id", familyId),
  ]);

  if (tasksError) throw new Error(`读取云端任务失败: ${tasksError.message}`);
  if (checklistError) throw new Error(`读取云端清单失败: ${checklistError.message}`);
  if (occurrencesError) throw new Error(`读取云端单次状态失败: ${occurrencesError.message}`);
  if (periodsError) throw new Error(`读取云端假期阶段失败: ${periodsError.message}`);

  const tasks = (tasksData || []).map(rowToTask);
  const checklistItems = checklistData || [];

  // 组装 checklist items
  const taskMap = new Map<string, Task>();
  tasks.forEach(t => {
    t.checklistItems = [];
    taskMap.set(t.id, t);
  });

  checklistItems.forEach(row => {
    const task = taskMap.get(row.task_id);
    if (task) {
      task.checklistItems!.push({
        id: row.id,
        title: row.title,
        done: row.done,
        sortOrder: row.sort_order,
        estimatedMinutes: row.estimated_minutes ?? undefined,
        actualMinutes: row.actual_minutes ?? undefined,
      });
    }
  });

  // 统计有效和已删除任务
  let activeTasks = 0;
  let deletedTasks = 0;
  tasks.forEach(t => {
    if (t.deletedAt) deletedTasks++;
    else activeTasks++;
  });

  return {
    localCounts: {
      tasks: localTasks.length,
      checklistItems: localChecklistItems,
      occurrenceStatuses: localOccurrences,
      planPeriods: localPeriods,
    },
    cloudCounts: {
      tasks: tasks.length,
      activeTasks,
      deletedTasks,
      checklistItems: checklistItems.length,
      occurrenceStatuses: occurrencesCount ?? 0,
      planPeriods: periodsCount ?? 0,
    },
    // 最近 5 条有效任务
    recentTasks: tasks.filter(t => !t.deletedAt).slice(0, 5),
  };
}

export interface CloudDiffResult {
  localOnlyTasks: Task[];
  cloudOnlyTasks: Task[];
}

export async function checkCloudDiff(familyId: string): Promise<CloudDiffResult> {
  if (!supabase) throw new Error("Supabase 未配置");

  // 1. 读取本地任务
  const localTasks = await db.tasks.toArray();
  const localMap = new Map(localTasks.map(t => [t.id, t]));

  // 2. 读取云端任务
  const { data: tasksData, error: tasksError } = await supabase
    .from("tasks")
    .select("*")
    .eq("family_id", familyId);

  if (tasksError) throw new Error(`读取云端任务失败: ${tasksError.message}`);

  const cloudTasks = (tasksData || []).map(rowToTask);
  const cloudMap = new Map(cloudTasks.map(t => [t.id, t]));

  const localOnlyTasks: Task[] = [];
  const cloudOnlyTasks: Task[] = [];

  localTasks.forEach(t => {
    if (!cloudMap.has(t.id)) {
      localOnlyTasks.push(t);
    }
  });

  cloudTasks.forEach(t => {
    if (!localMap.has(t.id)) {
      cloudOnlyTasks.push(t);
    }
  });

  return {
    localOnlyTasks,
    cloudOnlyTasks,
  };
}
