/**
 * cloudUpload.ts
 *
 * 单向上传：本地 IndexedDB → Supabase。
 * 不修改本地数据，不切换页面数据源，不做双向同步。
 */
import { db } from "../data/db";
import type { Task, TaskOccurrenceStatus, PlanPeriod, Course, ActivityLog } from "../types/task";
import { isOccurrenceSchedule } from "../utils/taskMeta";
import { supabase } from "./supabase";

export interface UploadResult {
  tasks: number;
  checklistItems: number;
  occurrenceStatuses: number;
  planPeriods: number;
  courses: number;
  activityLogs: number;
  skippedTasks: number;
  skippedOccurrenceStatuses: number;
  skippedDirtyOccurrences: number;
  skippedPlanPeriods: number;
}

/** 把 undefined 过滤掉，避免写入 Supabase 时报错 */
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

/** 将本地 Task 转换为 Supabase tasks 行，注入 family_id */
function taskToRow(task: Task, familyId: string): Record<string, unknown> {
  return stripUndefined({
    id: task.id,
    family_id: familyId,
    title: task.title ?? "", // 兜底空字符串
    main_category: task.mainCategory ?? "temporary", // 旧数据兼容
    sub_category: task.subCategory ?? "other", // 旧数据兼容
    extra_content_type: task.extraContentType ?? null,
    course_id: task.courseId ?? null,
    time_type: task.timeType ?? "singleDate", // 旧数据兼容
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
    calendar_visibility: task.calendarVisibility ?? "show", // 旧数据兼容：默认正常显示
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
    // enableStreak/streakStartDate 独立列；enableStreak 为 undefined 时两列均被剔除，云端未迁移前不会触碰
    enable_streak: task.enableStreak,
    streak_start_date: task.enableStreak === undefined ? undefined : task.streakStartDate ?? null,
    // 低频字段打包进 metadata jsonb
    metadata: buildMetadata(task),
    created_at: toTimestampOrNull(task.createdAt) ?? new Date().toISOString(),
    updated_at: toTimestampOrNull(task.updatedAt) ?? new Date().toISOString(),
  });
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

/**
 * 上传全部本地数据到 Supabase。
 * 使用 upsert，安全重复执行。
 */
export async function uploadLocalDataToCloud(familyId: string): Promise<UploadResult> {
  if (!supabase) throw new Error("Supabase 未配置");

  // ── 1. 读取本地数据 ─────────────────────────────────────────────
  const [tasks, occurrenceStatuses, planPeriods, courses, activityLogs] = await Promise.all([
    db.tasks.toArray(),
    db.taskOccurrenceStatuses.toArray(),
    db.planPeriods.toArray(),
    db.courses.toArray(),
    db.activityLogs.toArray(),
  ]);

  const result: UploadResult = {
    tasks: 0,
    checklistItems: 0,
    occurrenceStatuses: 0,
    planPeriods: 0,
    courses: 0,
    activityLogs: 0,
    skippedTasks: 0,
    skippedOccurrenceStatuses: 0,
    skippedDirtyOccurrences: 0,
    skippedPlanPeriods: 0,
  };

  const CHUNK = 100; // 每批最多 100 条，避免单次请求过大

  async function upsertChunked<T extends object>(
    table: string,
    rows: T[],
    onConflict: string
  ): Promise<number> {
    if (rows.length === 0) return 0;
    let count = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await supabase!
        .from(table)
        .upsert(chunk, { onConflict });
      if (error) throw new Error(`上传 ${table} 失败: ${error.message}`);
      count += chunk.length;
    }
    return count;
  }

  /** 只追加不覆盖的表专用（如 activity_logs）：冲突静默跳过，不触发实际 UPDATE，不需要 update 权限 */
  async function upsertChunkedIgnoreDup<T extends object>(
    table: string,
    rows: T[],
    onConflict: string
  ): Promise<number> {
    if (rows.length === 0) return 0;
    let count = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await supabase!
        .from(table)
        .upsert(chunk, { onConflict, ignoreDuplicates: true });
      if (error) throw new Error(`上传 ${table} 失败: ${error.message}`);
      count += chunk.length;
    }
    return count;
  }

  // ── 2. 上传 tasks ──────────────────────────────────────────────
  const taskRows = tasks.map((t) => taskToRow(t, familyId));
  result.tasks = await upsertChunked("tasks", taskRows, "id");

  // ── 3. 上传 task_checklist_items ───────────────────────────────
  const checklistRows: Record<string, unknown>[] = [];
  for (const task of tasks) {
    if (!Array.isArray(task.checklistItems) || task.checklistItems.length === 0) continue;
    task.checklistItems.forEach((item, idx) => {
      checklistRows.push(stripUndefined({
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
      }));
    });
  }
  result.checklistItems = await upsertChunked("task_checklist_items", checklistRows, "id");

  // ── 4. 上传 task_occurrence_statuses ───────────────────────────
  // R1 防线：非 occurrence 类任务不该有 occurrence 行，已软删任务的行也不该复活，
  // 本地缓存里这类 A 类违规残留一律不上传，防止脏数据回流云端。
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const occurrenceRows: Record<string, unknown>[] = [];
  occurrenceStatuses.forEach((s: TaskOccurrenceStatus) => {
    const owner = taskById.get(s.taskId);
    if (owner && (owner.deletedAt || !isOccurrenceSchedule(owner))) {
      result.skippedDirtyOccurrences++;
      return;
    }
    const occDate = toDateOrNull(s.occurrenceDate);
    if (!occDate) {
      result.skippedOccurrenceStatuses++;
      return;
    }
    occurrenceRows.push(stripUndefined({
      id: s.id,
      family_id: familyId,
      task_id: s.taskId,
      occurrence_date: occDate,
      status: s.status,
      override_date: toDateOrNull(s.overrideDate),
      override_title: s.overrideTitle ?? null,
      override_note: s.overrideNote ?? null,
      completed_at: toTimestampOrNull(s.completedAt),
      created_at: toTimestampOrNull(s.createdAt) ?? new Date().toISOString(),
      updated_at: toTimestampOrNull(s.updatedAt) ?? new Date().toISOString(),
    }));
  });
  result.occurrenceStatuses = await upsertChunked(
    "task_occurrence_statuses",
    occurrenceRows,
    "id"
  );

  // ── 5. 上传 plan_periods ───────────────────────────────────────
  const periodRows: Record<string, unknown>[] = [];
  planPeriods.forEach((p: PlanPeriod) => {
    const sDate = toDateOrNull(p.startDate);
    const eDate = toDateOrNull(p.endDate);
    if (!sDate || !eDate) {
      result.skippedPlanPeriods++;
      return;
    }
    periodRows.push(stripUndefined({
      id: p.id,
      family_id: familyId,
      name: p.name,
      type: p.type ?? "holiday",
      start_date: sDate,
      end_date: eDate,
      is_active: p.isActive ?? true,
      note: p.note ?? null,
      created_at: toTimestampOrNull(p.createdAt) ?? new Date().toISOString(),
      updated_at: toTimestampOrNull(p.updatedAt) ?? new Date().toISOString(),
    }));
  });
  result.planPeriods = await upsertChunked("plan_periods", periodRows, "id");

  // ── 5.5 上传 courses（课程库，TASK_02）─────────────────────────
  const courseRows: Record<string, unknown>[] = courses.map((c: Course) => stripUndefined({
    id: c.id,
    family_id: familyId,
    name: c.name ?? "",
    main_category: c.mainCategory,
    sub_category: c.subCategory,
    extra_content_type: c.extraContentType ?? null,
    is_class: c.isClass ?? true,
    status: c.status ?? "active",
    start_date: toDateOrNull(c.startDate),
    end_date: toDateOrNull(c.endDate),
    schedule: c.schedule ?? null,
    sort_order: c.sortOrder ?? 0,
    created_at: toTimestampOrNull(c.createdAt) ?? new Date().toISOString(),
    updated_at: toTimestampOrNull(c.updatedAt) ?? new Date().toISOString(),
  }));
  result.courses = await upsertChunked("courses", courseRows, "id");

  // ── 6. 上传 activity_logs ──────────────────────────────────────
  // 2026-08-12 启用：改用 ignoreDuplicates（ON CONFLICT DO NOTHING），不再依赖
  // update 权限，用于把这台设备存量的历史操作记录一次性补到云端（之后的新记录走
  // cloudRepository 的逐条自动上传，不再需要这个手动入口）。
  const logRows = activityLogs.map((log: ActivityLog) =>
    stripUndefined({
      id: log.id,
      family_id: familyId,
      action_type: log.actionType,
      entity_type: log.entityType ?? null,
      entity_id: log.entityId ?? null,
      entity_title: log.entityTitle ?? null,
      before_snapshot: log.beforeSnapshot ?? null,
      after_snapshot: log.afterSnapshot ?? null,
      actor_name: log.actorName ?? null,
      device_type: log.deviceType ?? null,
      device_label: log.deviceLabel ?? null,
      browser: log.browser ?? null,
      created_at: toTimestampOrNull(log.createdAt) ?? new Date().toISOString(),
    })
  );
  result.activityLogs = await upsertChunkedIgnoreDup("activity_logs", logRows, "id");

  return result;
}
