import { supabase } from "./supabase";
import { db } from "../data/db";
import type { Task, TaskOccurrenceStatus, PlanPeriod } from "../types/task";
import { rowToTask } from "./cloudRead";

export interface DownloadResult {
  tasks: number;
  checklistItems: number;
  occurrenceStatuses: number;
  planPeriods: number;
}

export async function downloadCloudDataToLocal(familyId: string): Promise<DownloadResult> {
  if (!supabase) throw new Error("Supabase 未配置");

  // 1. 读取云端数据
  const [
    { data: tasksData, error: tasksError },
    { data: checklistData, error: checklistError },
    { data: occurrencesData, error: occurrencesError },
    { data: periodsData, error: periodsError }
  ] = await Promise.all([
    supabase.from("tasks").select("*").eq("family_id", familyId),
    supabase.from("task_checklist_items").select("*").eq("family_id", familyId).order('sort_order', { ascending: true }),
    supabase.from("task_occurrence_statuses").select("*").eq("family_id", familyId),
    supabase.from("plan_periods").select("*").eq("family_id", familyId),
  ]);

  if (tasksError) throw new Error(`读取云端任务失败: ${tasksError.message}`);
  if (checklistError) throw new Error(`读取云端清单失败: ${checklistError.message}`);
  if (occurrencesError) throw new Error(`读取云端单次状态失败: ${occurrencesError.message}`);
  if (periodsError) throw new Error(`读取云端假期阶段失败: ${periodsError.message}`);

  // 2. 映射 tasks 和 checklistItems
  const tasks = (tasksData || []).map(rowToTask);
  const taskMap = new Map<string, Task>();
  tasks.forEach(t => {
    // 覆盖本地时，如果本来没有就不赋值为 undefined，先设置空数组，后续统一处理
    t.checklistItems = [];
    taskMap.set(t.id, t);
  });

  const checklistItems = checklistData || [];
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

  // 对于空 checklistItems，可以保留空数组，前端会适配

  // 3. 映射 occurrenceStatuses
  const occurrenceStatuses: TaskOccurrenceStatus[] = (occurrencesData || []).map(row => ({
    id: row.id,
    taskId: row.task_id,
    occurrenceDate: row.occurrence_date,
    status: row.status,
    overrideDate: row.override_date ?? undefined,
    overrideTitle: row.override_title ?? undefined,
    overrideNote: row.override_note ?? undefined,
    completedAt: row.completed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  // 4. 映射 planPeriods
  const planPeriods: PlanPeriod[] = (periodsData || []).map(row => ({
    id: row.id,
    name: row.name,
    type: row.type,
    startDate: row.start_date,
    endDate: row.end_date,
    isActive: row.is_active,
    note: row.note ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  // 5. 使用安全合并模式写入 IndexedDB
  await db.transaction("rw", db.tasks, db.taskOccurrenceStatuses, db.planPeriods, async () => {
    if (tasks.length > 0) {
      await db.tasks.bulkPut(tasks);
    }
    if (occurrenceStatuses.length > 0) {
      await db.taskOccurrenceStatuses.bulkPut(occurrenceStatuses);
    }
    if (planPeriods.length > 0) {
      await db.planPeriods.bulkPut(planPeriods);
    }
  });

  return {
    tasks: tasks.length,
    checklistItems: checklistItems.length,
    occurrenceStatuses: occurrenceStatuses.length,
    planPeriods: planPeriods.length,
  };
}
