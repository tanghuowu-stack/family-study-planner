import { CalendarPlus, CalendarX, Check, Copy, MoreHorizontal, Pause, Pencil, Play, RotateCcw, Square, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { formatElapsed, useTimer, type TimerSaveFn } from "../context/TimerContext";
import type { ChecklistItem, TaskDisplay, TaskStatus } from "../types/task";
import { STATUS_META, canEndRecurring, canExtendRecurring, isCourseTask, taskShortName, SUB_CATEGORY_META } from "../utils/taskMeta";

interface Props {
  task: TaskDisplay;
  compact?: boolean;
  print?: boolean;
  showTimerUI?: boolean; // 页面级开关：false = 整页不显示任何计时/用时 UI
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
  onSaveActualTime?: TimerSaveFn;
  onSaveActualTimeManual?: (taskId: string, itemId: string | null, minutes: number | undefined) => void;
  onSaveEstimatedMinutes?: (taskId: string, itemId: string | null, minutes: number | undefined) => void;
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
    ? "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 transition-all duration-300"
    : "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all duration-200";
  if (animState === "checking") return `${base} scale-110 border-primary bg-primary text-white`;
  if (animState === "unchecking") return `${base} scale-95 border-stone-300 bg-stone-100 text-stone-300`;
  if (checked) return `${base} border-primary bg-primary text-white`;
  return size === "md"
    ? `${base} border-stone-300 text-transparent hover:border-primary`
    : `${base} border-stone-300`;
}

function TimerControls({
  targetId,
  taskId,
  targetType,
  saveFn,
}: {
  targetId: string;
  taskId: string;
  targetType: "checklist" | "task";
  saveFn: TimerSaveFn;
}) {
  const { activeId, elapsed, isRunning, start, pause, resume, stop, reset } = useTimer();
  const isActive = activeId === targetId;

  if (!isActive) {
    return (
      <button
        type="button"
        onClick={() => void start(targetId, targetType, taskId, saveFn)}
        title="开始计时"
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted hover:bg-mint hover:text-primary"
      >
        <Play className="h-4 w-4" />
        <span>计时</span>
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <span className="min-w-[42px] text-center font-mono text-xs font-medium text-primary">
        {formatElapsed(elapsed)}
      </span>
      {isRunning ? (
        <button type="button" onClick={() => pause()} title="暂停"
          className="rounded-lg p-1 text-primary hover:bg-mint">
          <Pause className="h-4 w-4" />
        </button>
      ) : (
        <button type="button" onClick={() => resume()} title="继续"
          className="rounded-lg p-1 text-primary hover:bg-mint">
          <Play className="h-4 w-4" />
        </button>
      )}
      <button type="button" onClick={() => void stop(saveFn)} title="完成计时"
        className="rounded-lg p-1 text-stone-400 hover:bg-rose-50 hover:text-rose-500">
        <Square className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => reset()} title="重置计时"
        className="rounded-lg p-1 text-stone-300 hover:bg-stone-100 hover:text-stone-500">
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

export function TaskItem({ task, compact = false, print = false, showTimerUI = true, unsynced, unsyncedItemIds, onStatusChange, onEdit, onDelete, onEnd, onExtend, onOccurrenceCancel, onOccurrencePostpone, onChecklistToggle, onRetrySync, onRetryItemSync, onCopy, onSaveActualTime, onSaveActualTimeManual, onSaveEstimatedMinutes }: Props) {
  const [menu, setMenu] = useState(false);
  const [checkState, setCheckState] = useState<AnimState>("idle");
  const [itemAnim, setItemAnim] = useState<Record<string, AnimState>>({});
  const [optimisticDone, setOptimisticDone] = useState<boolean | null>(null);
  const [optimisticItems, setOptimisticItems] = useState<Record<string, boolean>>({});
  const { activeId, activeType, isRunning, stop } = useTimer();

  const effectiveStatus = task.occurrenceStatus === "postponed" && task.overrideDate ? "todo" : task.status;
  const done = optimisticDone !== null ? optimisticDone : effectiveStatus === "done";
  const hasChecklist = !!task.checklistItems?.length;
  // 两层开关：页面级(showTimerUI) AND 任务级(enableTimer === true，未设置=默认关)
  const showTimeInfo = showTimerUI && task.enableTimer === true;

  // 父组件刷新后清除乐观覆盖
  useEffect(() => { setOptimisticDone(null); }, [task.status, task.id]);
  useEffect(() => { setOptimisticItems({}); }, [task.checklistItems]);

  const handleStatusChange = (newStatus: TaskStatus) => {
    const completing = newStatus === "done";
    setOptimisticDone(completing);
    setCheckState(completing ? "checking" : "unchecking");
    setTimeout(() => setCheckState("idle"), completing ? 400 : 250);

    // 完成任务前，若本任务（或其小项）有计时器在跑，先停止计时并保存实际用时，避免留下无法停止的孤儿计时器
    const timerBelongsToTask = completing && isRunning && !!onSaveActualTime &&
      ((activeType === "task" && activeId === task.id) ||
        (activeType === "checklist" && !!task.checklistItems?.some((item) => item.id === activeId)));
    if (timerBelongsToTask) {
      void stop(onSaveActualTime!).then(() => onStatusChange?.(task, newStatus));
    } else {
      onStatusChange?.(task, newStatus); // 立即触发，不等动画
    }
  };

  const handleChecklistToggle = (itemId: string, wasDone: boolean) => {
    const completing = !wasDone;
    setOptimisticItems(prev => ({ ...prev, [itemId]: !wasDone }));
    setItemAnim(prev => ({ ...prev, [itemId]: wasDone ? "unchecking" : "checking" }));
    setTimeout(() => setItemAnim(prev => { const next = { ...prev }; delete next[itemId]; return next; }), wasDone ? 250 : 400);

    // 勾完小项前，若正是这个小项自己在计时，先停止计时并保存实际用时——否则计时器留在后台孤儿运行，
    // 这条小项（可能连带父任务）已经完成却永远拿不到这段用时（同任务级 handleStatusChange 的防线，按小项收窄）
    const timerBelongsToItem = completing && isRunning && !!onSaveActualTime && activeType === "checklist" && activeId === itemId;
    if (timerBelongsToItem) {
      void stop(onSaveActualTime!).then(() => onChecklistToggle?.(task, itemId));
    } else {
      onChecklistToggle?.(task, itemId); // 立即触发
    }
  };

  return (
    <div className={`relative flex items-start gap-3 border-b border-stone-100 last:border-0 ${compact ? "px-3 py-2" : "px-4 py-3.5"} ${done || effectiveStatus === "cancelled" ? "text-stone-400" : "text-ink"}`}>
      {print
        ? <span className="mt-0.5 text-lg">□</span>
        : <button aria-label={done ? "标记为未完成" : "标记为完成"} onClick={() => handleStatusChange(done ? "todo" : "done")} className={checkboxClass(checkState, done)}>
            <Check className="h-4 w-4" strokeWidth={3} />
          </button>
      }

      <div className="min-w-0 flex-1">
        {/* 标题行 */}
        <div className={`font-semibold leading-relaxed ${compact ? "text-sm" : "text-base"} ${done || effectiveStatus === "cancelled" ? "line-through" : ""}`}>
          {formatTime(task)}
          {taskShortName(task)}
          {task.subCategory && SUB_CATEGORY_META[task.subCategory as keyof typeof SUB_CATEGORY_META] && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold no-underline" style={{ backgroundColor: SUB_CATEGORY_META[task.subCategory as keyof typeof SUB_CATEGORY_META].bgColor, color: SUB_CATEGORY_META[task.subCategory as keyof typeof SUB_CATEGORY_META].color }}>
              {SUB_CATEGORY_META[task.subCategory as keyof typeof SUB_CATEGORY_META].icon} {SUB_CATEGORY_META[task.subCategory as keyof typeof SUB_CATEGORY_META].label}
            </span>
          )}
          {task.note && !task.overrideNote && (
            <span className="ml-2 inline-block text-xs font-normal text-stone-400 no-underline">备注：{task.note}</span>
          )}
          {isCourseTask(task) && (
            <span className={`ml-2 inline-flex rounded-md px-2 py-0.5 align-middle text-[10px] font-semibold no-underline ${done || effectiveStatus === "cancelled" ? "bg-stone-200 text-stone-400" : "bg-mint text-primary"}`}>上课</span>
          )}
          {unsynced && !print && <UnsyncedBadge onRetry={onRetrySync} />}
          {hasChecklist && (() => {
            const items = task.checklistItems!.map(i => ({ ...i, done: optimisticItems[i.id] !== undefined ? optimisticItems[i.id] : i.done }));
            const doneCount = items.filter(i => i.done).length;
            return (
            <span className="ml-2 inline-flex items-center gap-1.5">
              <span className="relative inline-block h-1.5 w-16 rounded-full bg-stone-200">
                <span className="absolute h-full rounded-full bg-primary transition-all" style={{ width: `${(doneCount / items.length) * 100}%` }} />
              </span>
              <span className="text-xs font-normal text-stone-400">{doneCount}/{items.length}</span>
            </span>
            );
          })()}
        </div>

        {/* Checklist 小项 */}
        {hasChecklist && (
          <div className="mt-1.5 space-y-0.5">
            {task.checklistItems!.map((item) => {
              const optimisticItemDone = optimisticItems[item.id] !== undefined ? optimisticItems[item.id] : item.done;
              return (
              <ChecklistRow
                key={item.id}
                item={{ ...item, done: optimisticItemDone }}
                taskId={task.id}
                animState={itemAnim[item.id] ?? "idle"}
                print={print}
                showTimeInfo={showTimeInfo}
                unsynced={unsyncedItemIds?.has(item.id)}
                onToggle={() => handleChecklistToggle(item.id, item.done)}
                onRetrySync={() => onRetryItemSync?.(item.id)}
                saveFn={showTimeInfo && !optimisticItemDone ? onSaveActualTime : undefined}
                onSaveEstimated={showTimeInfo && !optimisticItemDone && onSaveEstimatedMinutes ? (mins) => onSaveEstimatedMinutes(task.id, item.id, mins) : undefined}
                onSaveActual={showTimeInfo && onSaveActualTimeManual ? (mins) => onSaveActualTimeManual(task.id, item.id, mins) : undefined}
              />);
            })}
          </div>
        )}

        {/* 计时/用时行（无 checklist，非打印；完成后仍显示作为记录） */}
        {!hasChecklist && !print && (
          <TaskLevelTimerRow
            task={task}
            show={showTimeInfo}
            done={done}
            saveFn={showTimeInfo && !done ? onSaveActualTime : undefined}
            onSaveEstimated={showTimeInfo && !done ? onSaveEstimatedMinutes : undefined}
            onSaveActual={showTimeInfo ? onSaveActualTimeManual : undefined}
          />
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

      {!print && (
        <div className="relative">
          <button aria-label="任务操作" onClick={() => setMenu(!menu)} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100">
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menu && (
            <div className="absolute right-0 top-8 z-20 w-40 rounded-xl border border-stone-100 bg-white p-1.5 text-sm shadow-card">
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
      )}
    </div>
  );
}

function ChecklistRow({ item, taskId, animState, print, showTimeInfo, unsynced, onToggle, onRetrySync, saveFn, onSaveEstimated, onSaveActual }: {
  item: ChecklistItem;
  taskId: string;
  animState: AnimState;
  print: boolean;
  showTimeInfo: boolean;
  unsynced?: boolean;
  onToggle: () => void;
  onRetrySync?: () => void;
  saveFn?: TimerSaveFn;
  onSaveEstimated?: (mins: number | undefined) => void;
  onSaveActual?: (mins: number | undefined) => void;
}) {
  return (
    <div className={`flex items-center gap-2 rounded-md px-1.5 py-1 ${item.done ? "text-stone-400" : "text-stone-600"}`}>
      <button type="button" disabled={print} onClick={onToggle} className="shrink-0">
        <span className={checkboxClass(animState, item.done, "sm")}>
          {print ? "□" : item.done ? "✓" : ""}
        </span>
      </button>
      <span className={`min-w-0 flex-1 text-sm ${item.done ? "line-through" : ""}`}>{item.title}</span>
      {unsynced && !print && <UnsyncedBadge onRetry={onRetrySync} />}
      {!print && showTimeInfo && (
        <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
          {/* 未完成：可编辑预计；已完成：只读显示 */}
          {!item.done ? (
            onSaveEstimated
              ? <EstimatedInput value={item.estimatedMinutes} onSave={onSaveEstimated} />
              : item.estimatedMinutes ? <span className="text-[11px] text-muted">预计{item.estimatedMinutes}m</span> : null
          ) : (
            item.estimatedMinutes ? <span className="text-[11px] text-stone-400">预计{item.estimatedMinutes}m</span> : null
          )}
          {/* 计时按钮只在未完成时显示 */}
          {saveFn && <TimerControls targetId={item.id} taskId={taskId} targetType="checklist" saveFn={saveFn} />}
          {/* 实际用时：可编辑（已完成也可编辑/清除） */}
          {onSaveActual
            ? <ActualInput value={item.actualMinutes} onSave={onSaveActual} />
            : item.actualMinutes ? <span className="shrink-0 rounded bg-mint px-1.5 py-0.5 text-[11px] text-primary">实{item.actualMinutes}m</span> : null}
        </span>
      )}
    </div>
  );
}

function EstimatedInput({ value, onSave }: { value?: number; onSave: (v: number | undefined) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value?.toString() ?? "");

  if (!editing) {
    return (
      <button type="button" onClick={() => { setDraft(value?.toString() ?? ""); setEditing(true); }}
        className="rounded px-1 text-[11px] text-muted hover:bg-mint hover:text-primary"
        title="点击编辑预计用时">
        {value ? `预计${value}m` : <span className="text-stone-300">+预计</span>}
      </button>
    );
  }
  return (
    <input
      autoFocus
      type="number" min="1" step="1" inputMode="numeric"
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        const v = parseInt(draft, 10);
        onSave(v > 0 ? v : undefined);
        setEditing(false);
      }}
      onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur(); }}
      className="w-14 rounded border px-1.5 py-0.5 text-[11px] text-ink focus:outline-none focus:ring-1 focus:ring-primary"
      placeholder="分钟"
    />
  );
}

function ActualInput({ value, onSave }: { value?: number; onSave: (v: number | undefined) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value?.toString() ?? "");

  if (!editing) {
    return (
      <button type="button" onClick={() => { setDraft(value?.toString() ?? ""); setEditing(true); }}
        className={`rounded px-1.5 py-0.5 text-[11px] hover:opacity-70 ${value ? "bg-mint text-primary" : "text-stone-300 hover:bg-mint hover:text-primary"}`}
        title="点击编辑实际用时（留空清除）">
        {value ? `实${value}m` : "+实际"}
      </button>
    );
  }
  return (
    <input
      autoFocus type="number" min="1" step="1" inputMode="numeric"
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { const v = parseInt(draft, 10); onSave(v > 0 ? v : undefined); setEditing(false); }}
      onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur(); }}
      className="w-14 rounded border px-1.5 py-0.5 text-[11px] text-ink focus:outline-none focus:ring-1 focus:ring-primary"
      placeholder="分钟"
    />
  );
}

function TaskLevelTimerRow({ task, show, done, saveFn, onSaveEstimated, onSaveActual }: {
  task: TaskDisplay;
  show: boolean;
  done: boolean;
  saveFn?: TimerSaveFn;
  onSaveEstimated?: (taskId: string, itemId: string | null, mins: number | undefined) => void;
  onSaveActual?: (taskId: string, itemId: string | null, mins: number | undefined) => void;
}) {
  if (!show) return null;
  // 已完成且无任何用时数据：不渲染空行
  if (done && !task.estimatedMinutes && !task.actualMinutes) return null;
  return (
    <div className="mt-1 hidden items-center gap-2 sm:flex">
      {/* 预计用时：未完成可编辑，已完成只读 */}
      {!done
        ? onSaveEstimated
          ? <EstimatedInput value={task.estimatedMinutes} onSave={mins => onSaveEstimated(task.id, null, mins)} />
          : task.estimatedMinutes ? <span className="text-[11px] text-muted">预计{task.estimatedMinutes}m</span> : null
        : task.estimatedMinutes ? <span className="text-[11px] text-stone-400">预计{task.estimatedMinutes}m</span> : null
      }
      {/* 计时按钮：只在未完成时显示 */}
      {saveFn && <TimerControls targetId={task.id} taskId={task.id} targetType="task" saveFn={saveFn} />}
      {/* 实际用时：可编辑（已完成也可编辑/清除） */}
      {onSaveActual
        ? <ActualInput value={task.actualMinutes} onSave={mins => onSaveActual(task.id, null, mins)} />
        : task.actualMinutes ? <span className="rounded bg-mint px-1.5 py-0.5 text-[11px] text-primary">实{task.actualMinutes}m</span> : null
      }
    </div>
  );
}

function formatTime(task: TaskDisplay) {
  const start = task.startTime ?? task.time;
  if (!start) return "";
  return `${start}${task.endTime ? `-${task.endTime}` : ""}${task.estimatedMinutes ? `｜预计${task.estimatedMinutes}分钟` : ""} `;
}
