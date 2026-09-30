import { CalendarPlus, CalendarX, Check, Copy, MoreHorizontal, Pencil, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import type { ChecklistItem, TaskDisplay, TaskStatus } from "../types/task";
import { STATUS_META, canEndRecurring, canExtendRecurring, taskShortName } from "../utils/taskMeta";

interface Props {
  task: TaskDisplay;
  compact?: boolean;
  unsynced?: boolean; // 任务自身完成状态未同步到云端
  unsyncedItemIds?: Set<string>; // 哪些清单小项未同步到云端
  onStatusChange?: (task: TaskDisplay, status: TaskStatus) => void;
  onEdit?: (task: TaskDisplay) => void;
  onDelete?: (task: TaskDisplay) => void;
  onEnd?: (task: TaskDisplay) => void;
  onExtend?: (task: TaskDisplay) => void;
  onOccurrenceCancel?: (task: TaskDisplay) => void;
  onOccurrencePostpone?: (task: TaskDisplay) => void;
  onChecklistToggle?: (task: TaskDisplay, itemId: string) => void;
  onRetrySync?: () => void;
  onRetryItemSync?: (itemId: string) => void;
  onCopy?: (task: TaskDisplay) => void;
}

/** 未同步到云端的持续可见标记（不是一闪而过的 toast），点击手动重试 */
function UnsyncedBadge({ onRetry }: { onRetry?: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onRetry?.(); }}
      title="未同步到云端，点击重试"
      className="ml-2 inline-flex shrink-0 items-center gap-1 rounded-full bg-sun/25 px-2 py-0.5 text-[10px] font-semibold text-ink no-underline"
    >
      <TriangleAlert className="h-3 w-3" />未同步
    </button>
  );
}

type AnimState = "idle" | "checking" | "unchecking";

function checkboxClass(animState: AnimState, checked: boolean, size: "md" | "sm" = "md"): string {
  const base = size === "md"
    ? "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition-all duration-300"
    : "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all duration-200";
  if (animState === "checking") return `${base} scale-110 border-primary bg-primary text-white`;
  if (animState === "unchecking") return `${base} scale-95 border-stone-300 bg-stone-100 text-stone-300`;
  if (checked) return `${base} border-primary bg-primary text-white`;
  return size === "md"
    ? `${base} border-stone-300 text-transparent hover:border-primary`
    : `${base} border-stone-300`;
}

export function TaskItem({ task, compact = false, unsynced, unsyncedItemIds, onStatusChange, onEdit, onDelete, onEnd, onExtend, onOccurrenceCancel, onOccurrencePostpone, onChecklistToggle, onRetrySync, onRetryItemSync, onCopy }: Props) {
  const [menu, setMenu] = useState(false);
  const [checkState, setCheckState] = useState<AnimState>("idle");
  const [itemAnim, setItemAnim] = useState<Record<string, AnimState>>({});
  const [optimisticDone, setOptimisticDone] = useState<boolean | null>(null);
  const [optimisticItems, setOptimisticItems] = useState<Record<string, boolean>>({});

  const effectiveStatus = task.occurrenceStatus === "postponed" && task.overrideDate ? "todo" : task.status;
  const done = optimisticDone !== null ? optimisticDone : effectiveStatus === "done";
  const hasChecklist = !!task.checklistItems?.length;
  const displayItems = task.checklistItems?.map((item) => ({ ...item, done: optimisticItems[item.id] ?? item.done })) ?? [];
  const completedItems = displayItems.filter((item) => item.done).length;

  // 父组件刷新后清除乐观覆盖
  useEffect(() => { setOptimisticDone(null); }, [task.status, task.id]);
  useEffect(() => { setOptimisticItems({}); }, [task.checklistItems]);

  const handleStatusChange = (newStatus: TaskStatus) => {
    const completing = newStatus === "done";
    setOptimisticDone(completing);
    setCheckState(completing ? "checking" : "unchecking");
    setTimeout(() => setCheckState("idle"), completing ? 400 : 250);

    onStatusChange?.(task, newStatus);
  };

  const handleChecklistToggle = (itemId: string, wasDone: boolean) => {
    const completing = !wasDone;
    setOptimisticItems(prev => ({ ...prev, [itemId]: !wasDone }));
    setItemAnim(prev => ({ ...prev, [itemId]: wasDone ? "unchecking" : "checking" }));
    setTimeout(() => setItemAnim(prev => { const next = { ...prev }; delete next[itemId]; return next; }), wasDone ? 250 : 400);

    onChecklistToggle?.(task, itemId);
  };

  return (
    <div className={`group relative flex items-start gap-2.5 border-b border-ink/[0.07] last:border-0 hover:bg-stone-50/70 ${compact ? "px-2.5 py-2.5 sm:px-3" : "px-4 py-3"} ${done || effectiveStatus === "cancelled" ? "text-stone-400" : "text-ink"}`}>
      <button aria-label={done ? "标记为未完成" : "标记为完成"} onClick={() => handleStatusChange(done ? "todo" : "done")} className={checkboxClass(checkState, done)}>
        <Check className="h-4 w-4" strokeWidth={3} />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-start gap-2">
          {formatTime(task) && <span className="mt-0.5 shrink-0 rounded bg-ink/[0.06] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted">{formatTime(task).trim()}</span>}
          <div className={`min-w-0 flex-1 font-semibold leading-5 ${compact ? "text-sm" : "text-base"} ${done || effectiveStatus === "cancelled" ? "line-through" : ""}`}>{taskShortName(task)}</div>
          {hasChecklist && <span className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 text-[11px] text-muted"><span className="relative h-1 w-10 overflow-hidden rounded-full bg-stone-200"><span className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all" style={{ width: `${(completedItems / displayItems.length) * 100}%` }} /></span><span className="tabular-nums">{completedItems}/{displayItems.length}</span></span>}
          {unsynced && <UnsyncedBadge onRetry={onRetrySync} />}
        </div>

        {task.note && !task.overrideNote && <div className="mt-0.5 min-w-0 truncate text-[11px] text-muted">{task.note}</div>}

        {/* Checklist 小项 */}
        {hasChecklist && (
          <div className="mt-1 space-y-0.5 border-l border-ink/10 pl-2">
            {task.checklistItems!.map((item) => {
              const optimisticItemDone = optimisticItems[item.id] ?? item.done;
              return (
              <ChecklistRow
                key={item.id}
                item={{ ...item, done: optimisticItemDone }}
                animState={itemAnim[item.id] ?? "idle"}
                unsynced={unsyncedItemIds?.has(item.id)}
                onToggle={() => handleChecklistToggle(item.id, item.done)}
                onRetrySync={() => onRetryItemSync?.(item.id)}
              />);
            })}
          </div>
        )}

        {/* 顺延/延期标注 */}
        {(task.rolledFromDate || task.occurrenceStatus === "postponed") && (
          <div className="mt-1 flex flex-wrap gap-2 text-xs">
            {task.rolledFromDate && <span className="text-amber-700">由 {task.rolledFromDate} 顺延</span>}
            {task.occurrenceStatus === "postponed" && task.overrideDate && <span className="text-violet-700">已延期到 {task.overrideDate}</span>}
            {task.overrideNote && <span className="text-stone-400">{task.overrideNote}</span>}
          </div>
        )}
      </div>

      {effectiveStatus !== "todo" && (
        <span className={`mt-1 hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] sm:block ${STATUS_META[effectiveStatus].className}`}>{STATUS_META[effectiveStatus].label}</span>
      )}

      <div className="relative">
        <button aria-label="任务操作" onClick={() => setMenu(!menu)} className="rounded-lg p-1.5 text-stone-400 opacity-70 hover:bg-stone-100 hover:text-ink group-hover:opacity-100">
          <MoreHorizontal className="h-4 w-4" />
        </button>
        {menu && (
          <div className="absolute right-0 top-8 z-20 w-44 rounded-lg border border-ink/10 bg-white p-1.5 text-sm shadow-card">
            <button onClick={() => { onEdit?.(task); setMenu(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-stone-50"><Pencil className="h-4 w-4" />编辑任务</button>
            <button onClick={() => { onCopy?.(task); setMenu(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-stone-50"><Copy className="h-4 w-4" />复制到日期</button>
            {task.occurrenceDate && (
              <>
                <button onClick={() => { onOccurrencePostpone?.(task); setMenu(false); }} className="w-full rounded-lg px-3 py-2 text-left hover:bg-violet-50">延期本次</button>
                <button onClick={() => { onOccurrenceCancel?.(task); setMenu(false); }} className="w-full rounded-lg px-3 py-2 text-left hover:bg-amber-50">取消本次</button>
              </>
            )}
            {onEnd && canEndRecurring(task) && effectiveStatus !== "done" && effectiveStatus !== "cancelled" && (
              <>
                <div className="my-1 border-t border-stone-100" />
                <button onClick={() => { onEnd(task); setMenu(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-amber-700 hover:bg-amber-50"><CalendarX className="h-4 w-4" />结束</button>
              </>
            )}
            {onExtend && canExtendRecurring(task) && effectiveStatus !== "done" && effectiveStatus !== "cancelled" && (
              <>
                <div className="my-1 border-t border-stone-100" />
                <button onClick={() => { onExtend(task); setMenu(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-primary hover:bg-mint"><CalendarPlus className="h-4 w-4" />延长周期</button>
              </>
            )}
            <button onClick={() => { onDelete?.(task); setMenu(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" />删除任务</button>
          </div>
        )}
      </div>
    </div>
  );
}

function ChecklistRow({ item, animState, unsynced, onToggle, onRetrySync }: {
  item: ChecklistItem;
  animState: AnimState;
  unsynced?: boolean;
  onToggle: () => void;
  onRetrySync?: () => void;
}) {
  return (
    <div className={`flex items-center gap-2 rounded-md px-1 py-1 ${item.done ? "text-stone-400" : "text-stone-600"}`}>
      <button type="button" onClick={onToggle} className="shrink-0">
        <span className={checkboxClass(animState, item.done, "sm")}>
          {item.done ? "✓" : ""}
        </span>
      </button>
      <span className={`min-w-0 flex-1 text-[13px] leading-5 ${item.done ? "line-through" : ""}`}>{item.title}</span>
      {unsynced && <UnsyncedBadge onRetry={onRetrySync} />}
    </div>
  );
}

function formatTime(task: TaskDisplay) {
  const start = task.startTime ?? task.time;
  if (!start) return "";
  return `${start}${task.endTime ? `-${task.endTime}` : ""}`;
}
