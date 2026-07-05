/**
 * cloudRepository.ts
 *
 * 云端优先数据层：读写 Supabase，同步缓存到本地 IndexedDB。
 * 提供和 taskRepository 尽量一致的方法签名。
 * 不删除本地数据，不做 Realtime，不做复杂冲突合并。
 */
import { supabase } from "../lib/supabase";
import { db } from "./db";
import { rowToTask } from "../lib/cloudRead";
import type {
  Task,
  TaskDraft,
  TaskDisplay,
  TaskStatus,
  OccurrenceStatus,
  TaskOccurrenceStatus,
  PlanPeriod,
  Course,
  BackupData,
  SyncResult,
} from "../types/task";
import { taskRepository } from "./taskRepository";
import { getWeekStartKey, getWeekEndKey, getMonthKey, getMonthBounds, todayKey, toDateKey } from "../utils/date";
import { addDays, eachDayOfInterval, parseISO } from "date-fns";

// ─── 云端同步失败回调（由 App.tsx 注册，写失败时提示用户） ──────────────────────

let _onSyncError: ((msg: string) => void) | null = null;
export function setCloudSyncErrorHandler(cb: (msg: string) => void): void {
  _onSyncError = cb;
}
export function notifySyncError(label: string, e: unknown): void {
  console.error(`[cloudRepository] ${label}`, e);
  _onSyncError?.(`${label}，数据已保存到本地`);
}

/** 完成状态类写入抗偶发网络抖动：失败后按固定间隔重试，重试次数用完仍失败才真正抛出 */
async function withRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 1500): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

// ─── helpers (reuse from cloudUpload logic) ─────────────────────────────────

function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as T;
}

function toDateOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 10);
}

function toTimestampOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

function buildMetadata(task: Task): Record<string, unknown> | null {
  const meta: Record<string, unknown> = {};
  if (task.totalAmount !== undefined) meta.totalAmount = task.totalAmount;
  if (task.amountUnit !== undefined) meta.amountUnit = task.amountUnit;
  if (task.splitCount !== undefined) meta.splitCount = task.splitCount;
  if (task.amountPerSession !== undefined) meta.amountPerSession = task.amountPerSession;
  if (task.readingTargetCount !== undefined) meta.readingTargetCount = task.readingTargetCount;
  if (task.readingTargetUnit !== undefined) meta.readingTargetUnit = task.readingTargetUnit;
  if (task.allowedWeekdays !== undefined) meta.allowedWeekdays = task.allowedWeekdays;
  if (task.allowWeekend !== undefined) meta.allowWeekend = task.allowWeekend;
  if (task.enableTimer !== undefined) meta.enableTimer = task.enableTimer;
  return Object.keys(meta).length > 0 ? meta : null;
}

function taskToRow(task: Task, familyId: string): Record<string, unknown> {
  return stripUndefined({
    id: task.id,
    family_id: familyId,
    title: task.title ?? "",
    main_category: task.mainCategory ?? "temporary",
    sub_category: task.subCategory ?? "other",
    extra_content_type: task.extraContentType ?? null,
    course_id: task.courseId ?? null,
    time_type: task.timeType ?? "singleDate",
    schedule_pattern: task.schedulePattern ?? null,
    date: toDateOrNull(task.date),
    start_date: toDateOrNull(task.startDate),
    end_date: toDateOrNull(task.endDate),
    week_start: toDateOrNull(task.weekStart),
    specific_dates: Array.isArray(task.specificDates) ? task.specificDates.filter(Boolean) : null,
    range_weekdays: task.rangeWeekdays ?? null,
    assignment_window: task.assignmentWindow ?? null,
    recurrence: task.recurrence ?? null,
    weekly_quota: task.weeklyQuota ?? null,
    applicable_period_type: task.applicablePeriodType ?? null,
    plan_period_id: task.planPeriodId ?? null,
    status: task.status ?? "todo",
    rollover_mode: task.rolloverMode ?? "keepOverdue",
    allow_rollover: task.allowRollover ?? false,
    calendar_visibility: task.calendarVisibility ?? "show",
    child_visible: task.childVisible ?? true,
    sort_order: task.sortOrder ?? 0,
    start_time: task.startTime ?? task.time ?? null,
    end_time: task.endTime ?? null,
    estimated_minutes: task.estimatedMinutes ?? null,
    actual_minutes: task.actualMinutes ?? null,
    location: task.location ?? null,
    note: task.note ?? null,
    important: task.important ?? false,
    parent_task_id: task.parentTaskId ?? null,
    session_index: task.sessionIndex ?? null,
    allocation_week_start: toDateOrNull(task.allocationWeekStart),
    completed_at: toTimestampOrNull(task.completedAt),
    deleted_at: toTimestampOrNull(task.deletedAt),
    deleted_by_device: task.deletedByDevice ?? null,
    deleted_by_actor: task.deletedByActor ?? null,
    metadata: buildMetadata(task),
    created_at: toTimestampOrNull(task.createdAt) ?? new Date().toISOString(),
    updated_at: toTimestampOrNull(task.updatedAt) ?? new Date().toISOString(),
  });
}

function checklistItemRows(task: Task, familyId: string): Record<string, unknown>[] {
  if (!Array.isArray(task.checklistItems) || task.checklistItems.length === 0) return [];
  return task.checklistItems.map((item, idx) =>
    stripUndefined({
      id: item.id ?? `${task.id}:ci:${idx}`,
      family_id: familyId,
      task_id: task.id,
      title: item.title ?? "",
      done: item.done ?? false,
      sort_order: item.sortOrder ?? idx,
      estimated_minutes: item.estimatedMinutes ?? null,
      actual_minutes: item.actualMinutes ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
  );
}

/** upsert task to Supabase and sync checklist items */
async function upsertTask(task: Task, familyId: string): Promise<void> {
  if (!supabase) return;
  const row = taskToRow(task, familyId);
  const { error: taskErr } = await supabase.from("tasks").upsert(row, { onConflict: "id" });
  if (taskErr) throw new Error(`云端保存任务失败: ${taskErr.message}`);

  // upsert 现有小项（按 id），再按 id 差集删除不再存在的旧小项，避免先删后插的原子性问题
  const items = checklistItemRows(task, familyId);
  if (items.length > 0) {
    const { error: upsertErr } = await supabase
      .from("task_checklist_items")
      .upsert(items, { onConflict: "id" });
    if (upsertErr) throw new Error(`云端更新清单失败: ${upsertErr.message}`);
  }

  const { data: existingRows, error: fetchErr } = await supabase
    .from("task_checklist_items")
    .select("id")
    .eq("task_id", task.id)
    .eq("family_id", familyId);
  if (fetchErr) throw new Error(`云端读取清单失败: ${fetchErr.message}`);

  const currentIds = new Set(items.map((item) => item.id as string));
  const staleIds = (existingRows ?? []).map((row) => row.id as string).filter((id) => !currentIds.has(id));
  if (staleIds.length > 0) {
    const { error: delErr } = await supabase
      .from("task_checklist_items")
      .delete()
      .in("id", staleIds);
    if (delErr) throw new Error(`云端清理旧清单失败: ${delErr.message}`);
  }
}

/** upsert occurrence status to Supabase */
async function upsertOccurrence(
  occ: TaskOccurrenceStatus,
  familyId: string
): Promise<void> {
  if (!supabase) return;
  const row = stripUndefined({
    id: occ.id,
    family_id: familyId,
    task_id: occ.taskId,
    occurrence_date: occ.occurrenceDate,
    status: occ.status,
    override_date: toDateOrNull(occ.overrideDate),
    override_title: occ.overrideTitle ?? null,
    override_note: occ.overrideNote ?? null,
    completed_at: null,
    created_at: toTimestampOrNull(occ.createdAt) ?? new Date().toISOString(),
    updated_at: toTimestampOrNull(occ.updatedAt) ?? new Date().toISOString(),
  });
  const { error } = await supabase
    .from("task_occurrence_statuses")
    .upsert(row, { onConflict: "id" });
  if (error) throw new Error(`云端保存单次状态失败: ${error.message}`);
}

/** Supabase courses 行 → Course */
function rowToCourse(row: any): Course {
  return {
    id: row.id,
    name: row.name ?? "",
    mainCategory: row.main_category,
    subCategory: row.sub_category,
    extraContentType: row.extra_content_type ?? undefined,
    isClass: row.is_class ?? true,
    status: row.status ?? "active",
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
    schedule: row.schedule ?? undefined,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Course → Supabase courses 行 */
function courseToRow(course: Course, familyId: string): Record<string, unknown> {
  return stripUndefined({
    id: course.id,
    family_id: familyId,
    name: course.name ?? "",
    main_category: course.mainCategory,
    sub_category: course.subCategory,
    extra_content_type: course.extraContentType ?? null,
    is_class: course.isClass ?? true,
    status: course.status ?? "active",
    start_date: toDateOrNull(course.startDate),
    end_date: toDateOrNull(course.endDate),
    schedule: course.schedule ?? null,
    sort_order: course.sortOrder ?? 0,
    created_at: toTimestampOrNull(course.createdAt) ?? new Date().toISOString(),
    updated_at: toTimestampOrNull(course.updatedAt) ?? new Date().toISOString(),
  });
}

/**
 * Last-write-wins 合并（PROJECT_GUIDE 6.5 铁律 R5）：把云端记录写入本地缓存，
 * 但跳过本地 updatedAt 更新的记录，避免本地刚改、尚未同步成功的数据被云端旧值覆盖回滚
 * （"任务已完成又弹回未完成"的根因）。只用于自动同步路径（realtime / 回前台拉取）；
 * 手动「从云端下载数据到本地」是强制覆盖，不走这里。
 */
// table 传入的是 Dexie 表实例；其 bulkGet/bulkPut 重载类型与结构化约束难以对齐，
// 故放宽为 any，类型安全由泛型 incoming: T[] 保证（写入项与目标表同源）。
async function lwwMerge<T extends { id: string; updatedAt: string }>(table: { bulkGet(keys: string[]): Promise<(T | undefined)[]>; bulkPut(items: T[]): Promise<unknown> } | any, incoming: T[]): Promise<void> {
  if (incoming.length === 0) return;
  const locals: (T | undefined)[] = await table.bulkGet(incoming.map((r) => r.id));
  const localUpdatedAt = new Map<string, string | undefined>();
  locals.forEach((l) => { if (l) localUpdatedAt.set(l.id, l.updatedAt); });
  const toWrite = incoming.filter((r) => {
    if (!localUpdatedAt.has(r.id)) return true;           // 本地不存在 → 新增
    const local = localUpdatedAt.get(r.id);
    return !local || r.updatedAt >= local;                // 本地 updatedAt 缺失，或云端不更旧 → 覆盖
  });
  if (toWrite.length > 0) await table.bulkPut(toWrite);
}

/** Load all tasks from Supabase and cache to IndexedDB */
async function fetchAndCacheTasks(familyId: string): Promise<Task[]> {
  if (!supabase) return db.tasks.toArray();

  const [{ data: tasksData, error: tasksError }, { data: checklistData }] = await Promise.all([
    supabase.from("tasks").select("*").eq("family_id", familyId),
    supabase.from("task_checklist_items").select("*").eq("family_id", familyId).order("sort_order"),
  ]);

  if (tasksError) {
    console.warn("[cloudRepository] 读取云端任务失败，降级到本地", tasksError.message);
    return db.tasks.toArray();
  }

  const tasks = (tasksData || []).map(rowToTask);
  const taskMap = new Map<string, Task>();
  tasks.forEach((t) => {
    t.checklistItems = [];
    taskMap.set(t.id, t);
  });

  (checklistData || []).forEach((row) => {
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

  // cache to local IndexedDB（LWW：本地更新的记录不被云端旧值覆盖）
  await lwwMerge(db.tasks, tasks).catch((e) =>
    console.warn("[cloudRepository] 缓存到本地失败", e)
  );

  return tasks;
}

/** Load all occurrence statuses from Supabase */
async function fetchOccurrences(familyId: string): Promise<TaskOccurrenceStatus[]> {
  if (!supabase) return db.taskOccurrenceStatuses.toArray();
  const { data, error } = await supabase
    .from("task_occurrence_statuses")
    .select("*")
    .eq("family_id", familyId);
  if (error) {
    console.warn("[cloudRepository] 读取云端单次状态失败，降级到本地", error.message);
    return db.taskOccurrenceStatuses.toArray();
  }
  const statuses: TaskOccurrenceStatus[] = (data || []).map((row) => ({
    id: row.id,
    taskId: row.task_id,
    occurrenceDate: row.occurrence_date,
    status: row.status,
    overrideDate: row.override_date ?? undefined,
    overrideTitle: row.override_title ?? undefined,
    overrideNote: row.override_note ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  // LWW：本地更新的单日状态不被云端旧值覆盖
  await lwwMerge(db.taskOccurrenceStatuses, statuses).catch(() => {});
  return statuses;
}

// ─── cloudRepository object ──────────────────────────────────────────────────

let _familyId: string | null = null;

export const cloudRepository = {
  /** Must be called once after login with the resolved familyId */
  setFamilyId(id: string) {
    _familyId = id;
  },

  getFamilyId(): string | null {
    return _familyId;
  },

  // ── Read methods: delegate to taskRepository but using cloud-cached data
  // Because taskRepository reads from IndexedDB, and we keep IndexedDB in sync,
  // we can use taskRepository for all complex query logic after a fetch.

  async listAll() {
    if (_familyId) await fetchAndCacheTasks(_familyId);
    return taskRepository.listAll();
  },

  async getTasksForDate(date: string, options?: { forCalendar?: boolean }) {
    // Use cached IndexedDB data — caller is responsible for refreshing
    return taskRepository.getTasksForDate(date, options);
  },

  async getOverdueTasks(date: string) {
    return taskRepository.getOverdueTasks(date);
  },

  async getWeekPools(date: string) {
    return taskRepository.getWeekPools(date);
  },

  async getChildren(parentId: string, weekStart?: string) {
    return taskRepository.getChildren(parentId, weekStart);
  },

  async getPlanSummary(date: string, period: "week" | "month") {
    return taskRepository.getPlanSummary(date, period);
  },

  async getWeekOverview(date: string) {
    return taskRepository.getWeekOverview(date);
  },

  async getMonthOverview(date: string) {
    return taskRepository.getMonthOverview(date);
  },

  async getCourseStatistics(startDate: string, endDate: string) {
    return taskRepository.getCourseStatistics(startDate, endDate);
  },

  // ── Refresh from cloud (call before rendering a page) ────────────────────

  async refreshFromCloud(): Promise<void> {
    if (!_familyId) return;
    // fetchAndCacheTasks / fetchOccurrences 内部已按 LWW 写入本地缓存，此处不再重复 bulkPut
    // （否则会用云端旧值无条件覆盖，绕过 LWW 保护）
    await Promise.all([
      fetchAndCacheTasks(_familyId),
      fetchOccurrences(_familyId),
    ]);
    // also fetch planPeriods
    if (supabase) {
      const { data } = await supabase
        .from("plan_periods")
        .select("*")
        .eq("family_id", _familyId);
      if (data) {
        const periods: PlanPeriod[] = data.map((row) => ({
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
        // 假期是硬删除：全量覆盖本地缓存，否则另一端删掉的假期会残留。
        // 仅在 fetch 成功（data 非 null）时清空，避免请求失败时误删本地缓存。
        await db.planPeriods.clear().catch(() => {});
        if (periods.length > 0) await db.planPeriods.bulkPut(periods).catch(() => {});
      }

      // 课程库（TASK_02）
      const { data: courseData } = await supabase
        .from("courses")
        .select("*")
        .eq("family_id", _familyId);
      if (courseData) {
        const courses: Course[] = courseData.map(rowToCourse);
        // 全量覆盖本地缓存：先清空避免云端已删的课程残留在本地下拉里
        await db.courses.clear().catch(() => {});
        if (courses.length > 0) await db.courses.bulkPut(courses).catch(() => {});
      }
    }
  },

  // ── Write methods ─────────────────────────────────────────────────────────

  async create(draft: TaskDraft) {
    const task = await taskRepository.create(draft);
    if (_familyId) {
      await upsertTask(task, _familyId).catch((e) =>
        notifySyncError("任务云端同步失败", e)
      );
    }
    return task;
  },

  async update(id: string, changes: Partial<TaskDraft>) {
    const checklistChanged = Object.prototype.hasOwnProperty.call(changes, "checklistItems");
    const task = await taskRepository.update(id, changes);
    if (_familyId) {
      await upsertTask(task, _familyId).catch((e) =>
        notifySyncError("任务云端同步失败", e)
      );
      if (checklistChanged && task.parentTaskId) {
        const parent = await db.tasks.get(task.parentTaskId);
        if (parent) {
          await upsertTask(parent, _familyId).catch((e) =>
            notifySyncError("父任务云端同步失败", e)
          );
        }
      }
    }
    return task;
  },

  async remove(id: string) {
    await taskRepository.remove(id);
    if (_familyId) {
      // Fetch the soft-deleted task and its cascaded children, upsert both to cloud with deleted_at
      const task = await db.tasks.get(id);
      if (task) {
        await upsertTask(task, _familyId).catch((e) =>
          notifySyncError("任务云端同步失败", e)
        );
      }
      const children = await db.tasks.where("parentTaskId").equals(id).toArray();
      for (const child of children) {
        await upsertTask(child, _familyId).catch((e) =>
          notifySyncError("任务云端同步失败", e)
        );
      }
    }
  },

  async batchRemove(ids: string[]) {
    const count = await taskRepository.batchRemove(ids);
    if (_familyId) {
      const tasks = await db.tasks.bulkGet(ids);
      for (const task of tasks) {
        if (task) {
          await upsertTask(task, _familyId).catch((e) =>
            notifySyncError("任务云端同步失败", e)
          );
        }
      }
      const children = await db.tasks.where("parentTaskId").anyOf(ids).toArray();
      for (const child of children) {
        await upsertTask(child, _familyId).catch((e) =>
          notifySyncError("任务云端同步失败", e)
        );
      }
    }
    return count;
  },

  async restore(id: string) {
    await taskRepository.restore(id);
    if (_familyId) {
      const task = await db.tasks.get(id);
      if (task) {
        await upsertTask(task, _familyId).catch((e) =>
          notifySyncError("任务云端同步失败", e)
        );
      }
    }
  },

  async copyToDate(id: string, date: string) {
    const copy = await taskRepository.copyToDate(id, date);
    if (_familyId) {
      await upsertTask(copy, _familyId).catch((e) =>
        notifySyncError("任务云端同步失败", e)
      );
    }
    return copy;
  },

  async allocateTask(parentId: string, weekDate?: string) {
    const count = await taskRepository.allocateTask(parentId, weekDate);
    if (_familyId) {
      // Re-upload all children of this parent
      const children = await db.tasks
        .where("parentTaskId")
        .equals(parentId)
        .toArray();
      for (const child of children) {
        await upsertTask(child, _familyId).catch((e) =>
          notifySyncError("任务云端同步失败", e)
        );
      }
    }
    return count;
  },

  async setDisplayStatus(task: TaskDisplay, status: TaskStatus): Promise<SyncResult> {
    const { parentId } = await taskRepository.setDisplayStatus(task, status);
    let synced = true;
    if (_familyId) {
      const updated = await db.tasks.get(task.id);
      if (updated) {
        await withRetry(() => upsertTask(updated, _familyId!)).catch((e) => {
          notifySyncError("任务云端同步失败", e);
          synced = false;
        });
      }
      if (task.occurrenceDate) {
        const id = `${task.id}:${task.occurrenceDate}`;
        const occ = await db.taskOccurrenceStatuses.get(id);
        if (occ) {
          await withRetry(() => upsertOccurrence(occ, _familyId!)).catch((e) => {
            notifySyncError("单日状态云端同步失败", e);
            synced = false;
          });
        }
      }
      if (parentId) {
        const parent = await db.tasks.get(parentId);
        if (parent) {
          await withRetry(() => upsertTask(parent, _familyId!)).catch((e) =>
            notifySyncError("父任务云端同步失败", e)
          );
        }
      }
    }
    return { parentId, synced };
  },

  async saveActualMinutes(taskId: string, itemId: string | null, additionalMinutes: number): Promise<void> {
    await taskRepository.saveActualMinutes(taskId, itemId, additionalMinutes);
    if (_familyId) {
      const updated = await db.tasks.get(taskId);
      if (updated) {
        await upsertTask(updated, _familyId).catch((e) =>
          notifySyncError("计时数据同步失败", e)
        );
      }
    }
  },

  async toggleChecklistItem(taskId: string, itemId: string, occurrenceDate?: string): Promise<SyncResult> {
    const { parentId } = await taskRepository.toggleChecklistItem(taskId, itemId, occurrenceDate);
    let synced = true;
    if (_familyId) {
      const updated = await db.tasks.get(taskId);
      if (updated) {
        await withRetry(() => upsertTask(updated, _familyId!)).catch((e) => {
          notifySyncError("任务云端同步失败", e);
          synced = false;
        });
      }
      if (occurrenceDate) {
        const id = `${taskId}:${occurrenceDate}`;
        const occ = await db.taskOccurrenceStatuses.get(id);
        if (occ) {
          await withRetry(() => upsertOccurrence(occ, _familyId!)).catch((e) => {
            notifySyncError("单日状态云端同步失败", e);
            synced = false;
          });
        }
      }
      if (parentId) {
        const parent = await db.tasks.get(parentId);
        if (parent) {
          await withRetry(() => upsertTask(parent, _familyId!)).catch((e) =>
            notifySyncError("父任务云端同步失败", e)
          );
        }
      }
    }
    return { parentId, synced };
  },

  /** 手动重试：不触发本地状态变化，重新原样读取本地当前数据推一遍云端 */
  async resyncTask(taskId: string, occurrenceDate?: string): Promise<boolean> {
    if (!_familyId) return true;
    let synced = true;
    const task = await db.tasks.get(taskId);
    if (task) {
      await withRetry(() => upsertTask(task, _familyId!)).catch((e) => {
        notifySyncError("任务云端同步失败", e);
        synced = false;
      });
    }
    if (occurrenceDate) {
      const id = `${taskId}:${occurrenceDate}`;
      const occ = await db.taskOccurrenceStatuses.get(id);
      if (occ) {
        await withRetry(() => upsertOccurrence(occ, _familyId!)).catch((e) => {
          notifySyncError("单日状态云端同步失败", e);
          synced = false;
        });
      }
    }
    return synced;
  },

  async setOccurrence(
    taskId: string,
    occurrenceDate: string,
    status: OccurrenceStatus,
    overrideDate?: string,
    overrideNote?: string
  ): Promise<SyncResult> {
    await taskRepository.setOccurrence(taskId, occurrenceDate, status, overrideDate, overrideNote);
    let synced = true;
    if (_familyId) {
      const id = `${taskId}:${occurrenceDate}`;
      const occ = await db.taskOccurrenceStatuses.get(id);
      if (occ) {
        await withRetry(() => upsertOccurrence(occ, _familyId!)).catch((e) => {
          notifySyncError("任务云端同步失败", e);
          synced = false;
        });
      }
    }
    return { synced };
  },

  // ── Plan periods ──────────────────────────────────────────────────────────

  async listPlanPeriods() {
    return taskRepository.listPlanPeriods();
  },

  async createPlanPeriod(input: Omit<PlanPeriod, "id" | "createdAt" | "updatedAt">) {
    const period = await taskRepository.createPlanPeriod(input);
    if (_familyId && supabase) {
      const row = stripUndefined({
        id: period.id,
        family_id: _familyId,
        name: period.name,
        type: period.type ?? "holiday",
        start_date: toDateOrNull(period.startDate),
        end_date: toDateOrNull(period.endDate),
        is_active: period.isActive ?? true,
        note: period.note ?? null,
        created_at: toTimestampOrNull(period.createdAt) ?? new Date().toISOString(),
        updated_at: toTimestampOrNull(period.updatedAt) ?? new Date().toISOString(),
      });
      await supabase.from("plan_periods").upsert(row, { onConflict: "id" }).then(({ error }) => {
        if (error) notifySyncError("假期设置云端同步失败", error);
      });
    }
    return period;
  },

  async updatePlanPeriod(id: string, changes: Partial<Omit<PlanPeriod, "id" | "createdAt" | "updatedAt">>) {
    await taskRepository.updatePlanPeriod(id, changes);
    if (_familyId && supabase) {
      const period = await db.planPeriods.get(id);
      if (period) {
        const row = stripUndefined({
          id: period.id,
          family_id: _familyId,
          name: period.name,
          type: period.type ?? "holiday",
          start_date: toDateOrNull(period.startDate),
          end_date: toDateOrNull(period.endDate),
          is_active: period.isActive ?? true,
          note: period.note ?? null,
          created_at: toTimestampOrNull(period.createdAt) ?? new Date().toISOString(),
          updated_at: toTimestampOrNull(period.updatedAt) ?? new Date().toISOString(),
        });
        await supabase.from("plan_periods").upsert(row, { onConflict: "id" }).then(({ error }) => {
          if (error) notifySyncError("假期设置云端同步失败", error);
        });
      }
    }
  },

  async removePlanPeriod(id: string) {
    await taskRepository.removePlanPeriod(id);
    if (_familyId && supabase) {
      await supabase.from("plan_periods").delete().eq("id", id).then(({ error }) => {
        if (error) notifySyncError("假期设置云端同步失败", error);
      });
    }
  },

  // ── 课程库（TASK_02） ───────────────────────────────────────────────────────

  async listCourses() {
    return taskRepository.listCourses();
  },

  async createCourse(input: Omit<Course, "id" | "createdAt" | "updatedAt">) {
    const course = await taskRepository.createCourse(input);
    if (_familyId && supabase) {
      await supabase.from("courses").upsert(courseToRow(course, _familyId), { onConflict: "id" }).then(({ error }) => {
        if (error) notifySyncError("课程云端同步失败", error);
      });
    }
    return course;
  },

  async updateCourse(id: string, changes: Partial<Omit<Course, "id" | "createdAt" | "updatedAt">>) {
    await taskRepository.updateCourse(id, changes);
    if (_familyId && supabase) {
      const course = await db.courses.get(id);
      if (course) {
        await supabase.from("courses").upsert(courseToRow(course, _familyId), { onConflict: "id" }).then(({ error }) => {
          if (error) notifySyncError("课程云端同步失败", error);
        });
      }
    }
  },

  async removeCourse(id: string) {
    await taskRepository.removeCourse(id);
    if (_familyId && supabase) {
      await supabase.from("courses").delete().eq("id", id).then(({ error }) => {
        if (error) notifySyncError("课程云端同步失败", error);
      });
    }
  },

  // ── Reading logs (delegate to local only for now) ─────────────────────────

  async listReadingLogs(taskId: string, weekDate: string) {
    return taskRepository.listReadingLogs(taskId, weekDate);
  },

  async addReadingLog(input: { taskId: string; date: string; amount: number; title?: string; note?: string }) {
    return taskRepository.addReadingLog(input);
  },

  async undoLatestReadingLog(taskId: string, weekDate: string) {
    return taskRepository.undoLatestReadingLog(taskId, weekDate);
  },

  // ── Backup (delegate to local for now) ───────────────────────────────────

  async exportBackup(): Promise<BackupData> {
    return taskRepository.exportBackup();
  },

  async importBackup(input: unknown) {
    return taskRepository.importBackup(input);
  },

  async findTimeConflicts(draft: TaskDraft, excludeId?: string) {
    return taskRepository.findTimeConflicts(draft, excludeId);
  },
};
