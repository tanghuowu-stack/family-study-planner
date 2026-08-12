/**
 * activityUndo.ts —— 统计页"最近操作记录"的撤回入口（2026-08-12）。
 *
 * 只支持有明确、安全撤回语义的动作类型，其余（假期/课程/阅读旧记录/导入导出、
 * 以及拖拽排序这种没有单一 entityId 的 edit）一律不可撤回，不强行兼容。
 *
 * task 类（entityType="task"）的 edit/complete/uncomplete 走 `restoreSnapshot`
 * 而不是 `update`——update() 对 status 变化有"顺带联动 completedAt"的智能推断，
 * 会覆盖掉快照里要精确恢复的原始 completedAt，两种语义冲突，必须分开处理。
 */
import { getRepository } from "./repositoryProvider";
import type { ActivityLog, Task, TaskOccurrenceStatus } from "../types/task";

const UNDOABLE_TASK_ACTIONS = new Set<ActivityLog["actionType"]>(["create", "delete", "restore", "edit", "complete", "uncomplete"]);
const UNDOABLE_OCCURRENCE_ACTIONS = new Set<ActivityLog["actionType"]>(["complete", "uncomplete", "cancelOccurrence", "postponeOccurrence"]);

/** 该条操作记录是否可以撤回 */
export function canUndoActivityLog(log: ActivityLog): boolean {
  // batchDelete 的 entityType 也是 "task"，必须先判断，否则会被下面的 task 分支拦住
  if (log.actionType === "batchDelete") {
    return Array.isArray((log.afterSnapshot as { taskIds?: unknown })?.taskIds);
  }
  if (log.entityType === "task") {
    // 拖拽排序也记成 actionType="edit"，但没有单一 entityId、beforeSnapshot 形状也不同，排除
    return UNDOABLE_TASK_ACTIONS.has(log.actionType) && !!log.entityId;
  }
  if (log.entityType === "taskOccurrence") {
    return UNDOABLE_OCCURRENCE_ACTIONS.has(log.actionType) && !!log.entityId;
  }
  return false;
}

/** 执行撤回。调用前应先用 canUndoActivityLog 判断，否则会抛错。 */
export async function undoActivityLog(log: ActivityLog): Promise<void> {
  const repo = getRepository();

  if (log.actionType === "batchDelete") {
    const ids = ((log.afterSnapshot as { taskIds?: string[] })?.taskIds) ?? [];
    if (!ids.length) throw new Error("没有可恢复的任务");
    await Promise.all(ids.map((id) => repo.restore(id)));
    return;
  }

  if (log.entityType === "task") {
    const id = log.entityId;
    if (!id) throw new Error("记录缺少任务 id，无法撤回");
    switch (log.actionType) {
      case "create":
        await repo.remove(id);
        return;
      case "delete":
        await repo.restore(id);
        return;
      case "restore":
        await repo.remove(id);
        return;
      case "edit":
      case "complete":
      case "uncomplete": {
        if (!log.beforeSnapshot) throw new Error("没有可恢复的历史状态");
        await repo.restoreSnapshot(id, log.beforeSnapshot as Task);
        return;
      }
      default:
        throw new Error("该操作暂不支持撤回");
    }
  }

  if (log.entityType === "taskOccurrence") {
    const [taskId, occurrenceDate] = (log.entityId ?? "").split(":");
    if (!taskId || !occurrenceDate) throw new Error("记录信息不完整，无法撤回");
    const before = log.beforeSnapshot as TaskOccurrenceStatus | undefined;
    // completedAt 由 setOccurrence 按 status 自动推算（不接受精确覆盖），occurrence 完成判定
    // 只看 status 不看 completedAt，这里的近似值不影响任何读取路径。
    await repo.setOccurrence(taskId, occurrenceDate, before?.status ?? "todo", before?.overrideDate, before?.overrideNote);
    return;
  }

  throw new Error("该操作暂不支持撤回");
}
