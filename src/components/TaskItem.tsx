import { Check, Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import type { TaskDisplay, TaskStatus } from "../types/task";
import { STATUS_META, isCourseTask, taskDisplayName } from "../utils/taskMeta";

interface Props {
  task: TaskDisplay;
  compact?: boolean;
  print?: boolean;
  onStatusChange?: (task: TaskDisplay, status: TaskStatus) => void;
  onEdit?: (task: TaskDisplay) => void;
  onDelete?: (task: TaskDisplay) => void;
  onOccurrenceCancel?: (task: TaskDisplay) => void;
  onOccurrencePostpone?: (task: TaskDisplay) => void;
  onChecklistToggle?: (task: TaskDisplay, itemId: string) => void;
  onCopy?: (task: TaskDisplay) => void;
}

export function TaskItem({ task, compact = false, print = false, onStatusChange, onEdit, onDelete, onOccurrenceCancel, onOccurrencePostpone, onChecklistToggle, onCopy }: Props) {
  const [menu, setMenu] = useState(false);
  const effectiveStatus = task.occurrenceStatus === "postponed" && task.overrideDate ? "todo" : task.status;
  const done = effectiveStatus === "done";
  return <div className={`relative flex items-start gap-3 border-b border-stone-100 last:border-0 ${compact ? "px-3 py-2" : "px-4 py-3.5"} ${done || effectiveStatus === "cancelled" ? "text-stone-400" : "text-ink"}`}>
    {print ? <span className="mt-0.5 text-lg">□</span> : <button aria-label={done ? "标记为未完成" : "标记为完成"} onClick={() => onStatusChange?.(task, done ? "todo" : "done")} className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 ${done ? "border-sage-500 bg-sage-500 text-white" : "border-stone-300 text-transparent hover:border-sage-500"}`}><Check className="h-4 w-4" strokeWidth={3} /></button>}
    <div className="min-w-0 flex-1"><div className={`font-medium leading-6 ${compact ? "text-sm" : "text-[15px]"} ${done || effectiveStatus === "cancelled" ? "line-through" : ""}`}>{formatTime(task)}{taskDisplayName(task)}{isCourseTask(task) && <span className={`ml-2 inline-flex rounded-md px-2 py-0.5 align-middle text-[10px] font-semibold no-underline ${done || effectiveStatus === "cancelled" ? "bg-stone-200 text-stone-400" : "bg-ink text-white"}`}>上课</span>}{task.checklistItems?.length ? <span className="ml-2 text-xs font-normal text-stone-400">{task.checklistItems.filter((item) => item.done).length}/{task.checklistItems.length}</span> : null}</div>{task.checklistItems?.length ? <div className="mt-1.5 space-y-1">{task.checklistItems.map((item) => <button type="button" disabled={print} key={item.id} onClick={() => onChecklistToggle?.(task, item.id)} className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs ${item.done ? "text-stone-400 line-through" : "text-stone-600 hover:bg-stone-50"}`}><span className={`flex h-4 w-4 items-center justify-center rounded border ${item.done ? "border-sage-500 bg-sage-500 text-white" : "border-stone-300"}`}>{print ? "□" : item.done ? "✓" : ""}</span>{item.title}</button>)}</div> : null}{(task.note || task.rolledFromDate || task.overrideNote || task.occurrenceStatus === "postponed") && <details className="mt-1 text-xs text-stone-500"><summary className="cursor-pointer list-none text-stone-400">查看备注</summary><div className="mt-1 leading-5">{task.rolledFromDate && <span className="mr-3 text-amber-700">由 {task.rolledFromDate} 顺延</span>}{task.occurrenceStatus === "postponed" && task.overrideDate && <span className="mr-3 text-violet-700">已延期到 {task.overrideDate}</span>}{task.overrideNote ?? task.note}</div></details>}</div>
    {effectiveStatus !== "todo" && <span className={`mt-1 hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] sm:block ${STATUS_META[effectiveStatus].className}`}>{STATUS_META[effectiveStatus].label}</span>}
    {!print && <div className="relative"><button aria-label="任务操作" onClick={() => setMenu(!menu)} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100"><MoreHorizontal className="h-4 w-4" /></button>{menu && <div className="absolute right-0 top-8 z-20 w-40 rounded-xl border border-stone-100 bg-white p-1.5 text-sm shadow-card"><button onClick={() => { onEdit?.(task); setMenu(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-stone-50"><Pencil className="h-4 w-4" />编辑任务</button><button onClick={() => { onCopy?.(task); setMenu(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-stone-50"><Copy className="h-4 w-4" />复制到日期</button>{task.occurrenceDate && <><button onClick={() => { onOccurrencePostpone?.(task); setMenu(false); }} className="w-full rounded-lg px-3 py-2 text-left hover:bg-violet-50">延期本次</button><button onClick={() => { onOccurrenceCancel?.(task); setMenu(false); }} className="w-full rounded-lg px-3 py-2 text-left hover:bg-amber-50">取消本次</button></>}<button onClick={() => { onDelete?.(task); setMenu(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" />删除任务</button></div>}</div>}
  </div>;
}

function formatTime(task: TaskDisplay) {
  const start = task.startTime ?? task.time;
  if (!start) return "";
  return `${start}${task.endTime ? `-${task.endTime}` : ""}${task.estimatedMinutes ? `｜预计${task.estimatedMinutes}分钟` : ""} `;
}
