import { addDays } from "date-fns";
import { ChevronDown, GripVertical } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useSwipe } from "../hooks/useSwipe";
import { EmptyState } from "../components/EmptyState";
import { TaskItem } from "../components/TaskItem";
import { getCalendarAnnotation } from "../data/calendarAnnotations";
import { taskRepository } from "../data/taskRepository";
import type { PlanOverviewItem, TaskDisplay, TaskStatus } from "../types/task";
import { formatFullDate, fromDateKey, toDateKey, todayKey } from "../utils/date";
import { TASK_SUBJECT_GROUPS, taskSubjectGroup, type TaskSubjectGroup } from "../utils/taskGrouping";
import { useGroupOrder } from "../hooks/useGroupOrder";

function ProgressCircle({ completed, total }: { completed: number; total: number }) {
  const percentage = total === 0 ? 0 : (completed / total) * 100;
  const radius = 17;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;
  return <svg width="44" height="44" viewBox="0 0 44 44" className="inline-block shrink-0">
    <circle cx="22" cy="22" r={radius} className="fill-none stroke-mint" strokeWidth="3" />
    <circle cx="22" cy="22" r={radius} className="fill-none stroke-primary transition-all duration-500" strokeWidth="3" strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" transform="rotate(-90 22 22)" />
    <text x="22" y="26" textAnchor="middle" fontSize="9" fontWeight="600" fill="currentColor">
      {completed}/{total}
    </text>
  </svg>;
}

interface Props {
  date: string; refreshKey: number; onDateChange: (date: string) => void;
  onStatusChange: (task: TaskDisplay, status: TaskStatus) => void; onEdit: (task: TaskDisplay) => void;
  onDelete: (task: TaskDisplay) => void; onOccurrenceCancel: (task: TaskDisplay) => void;
  onOccurrencePostpone: (task: TaskDisplay) => void; onChecklistToggle: (task: TaskDisplay, itemId: string) => void;
  onCopy: (task: TaskDisplay) => void; onOpenMonth: () => void;
  onSaveActualTime?: (taskId: string, itemId: string | null, minutes: number) => Promise<void>;
  onSaveActualTimeManual?: (taskId: string, itemId: string | null, minutes: number | undefined) => void;
  onSaveEstimatedMinutes?: (taskId: string, itemId: string | null, minutes: number | undefined) => void;
}

export function DayPage(props: Props) {
  const [tasks, setTasks] = useState<TaskDisplay[]>([]);
  const [overdue, setOverdue] = useState<TaskDisplay[]>([]);
  const [showDone, setShowDone] = useState(true);
  const { order, updateOrder } = useGroupOrder();
  useEffect(() => { Promise.all([taskRepository.getTasksForDate(props.date), taskRepository.getOverdueTasks(props.date)]).then(([items, late]) => { setTasks(items); setOverdue(late); }); }, [props.date, props.refreshKey]);
  const pending = tasks.filter((task) => !["done", "cancelled"].includes(task.status));
  const done = tasks.filter((task) => ["done", "cancelled"].includes(task.status));
  const move = (days: number) => props.onDateChange(toDateKey(addDays(fromDateKey(props.date), days)));
  const swipeRef = useSwipe<HTMLDivElement>(
    () => move(1),   // left swipe → next day
    () => move(-1),  // right swipe → prev day
  );
  const rowProps = { compact: true, onStatusChange: props.onStatusChange, onEdit: props.onEdit, onDelete: props.onDelete, onOccurrenceCancel: props.onOccurrenceCancel, onOccurrencePostpone: props.onOccurrencePostpone, onChecklistToggle: props.onChecklistToggle, onCopy: props.onCopy, onSaveActualTime: props.onSaveActualTime, onSaveActualTimeManual: props.onSaveActualTimeManual, onSaveEstimatedMinutes: props.onSaveEstimatedMinutes };
  const annotation = getCalendarAnnotation(props.date);
  const annotationLabels = [...annotation.solarTerms, ...annotation.festivals];
  const renderTask = (task: TaskDisplay) => <TaskItem key={`${task.id}:${task.occurrenceDate ?? task.date}`} task={task} {...rowProps} />;

  return <main className="mx-auto w-full max-w-7xl overflow-x-hidden px-4 pb-28 pt-3 sm:px-6 sm:pt-5">
    <div className="mb-5 flex flex-col items-center justify-center"><div className="flex items-center justify-center gap-3 text-center"><h1 className="text-3xl font-bold text-ink sm:text-4xl">{formatFullDate(props.date)}{annotationLabels.length > 0 && <span className="ml-2 text-base font-medium text-amber-700 sm:text-lg">· {annotationLabels.join(" · ")}</span>}{annotation.holidayStatus && <span className={`ml-2 inline-flex rounded-md px-2 py-0.5 align-middle text-sm font-bold ${annotation.holidayStatus === "休" ? "bg-rose-50 text-rose-700" : "bg-blue-50 text-blue-700"}`}>{annotation.holidayStatus}</span>}</h1><ProgressCircle completed={done.length} total={pending.length + done.length} /></div></div>
    <div className="mb-5 grid grid-cols-3 rounded-2xl border border-stone-100 bg-white p-1.5 text-sm"><button onClick={() => move(-1)} className="rounded-xl px-2 py-2 text-stone-500 hover:bg-stone-50">← 昨天</button><button onClick={() => props.onDateChange(todayKey())} className="rounded-xl px-2 py-2 font-medium text-primary hover:bg-mint">回到今天</button><button onClick={() => move(1)} className="rounded-xl px-2 py-2 text-stone-500 hover:bg-stone-50">明天 →</button></div>
    <div ref={swipeRef}><section className="rounded-2xl border border-stone-100 bg-white p-4 shadow-card"><div className="border-b border-stone-100 px-1 pb-3.5"><h2 className="text-base font-bold text-ink">今日清单</h2></div>{pending.length ? <GroupedTaskGrid tasks={pending} renderTask={renderTask} order={order} onReorder={updateOrder} /> : <div className="p-2"><EmptyState compact /></div>}</section>{overdue.length > 0 && <section className="mt-6 overflow-visible rounded-2xl border border-alert/30 bg-white"><div className="border-b border-alert/30 bg-alert/10 px-4 py-3"><h2 className="font-semibold text-alert">逾期未完成 · {overdue.length}</h2></div>{overdue.map(renderTask)}</section>}{done.length > 0 && <section className="mt-6 rounded-2xl border border-stone-100 bg-white p-4"><button onClick={() => setShowDone(!showDone)} className="flex w-full items-center justify-between px-1 py-1 text-base font-bold text-stone-600">已完成 · {done.length}<ChevronDown className={`h-4 w-4 transition ${showDone ? "rotate-180" : ""}`} /></button>{showDone && <GroupedTaskGrid tasks={done} renderTask={renderTask} order={order} onReorder={updateOrder} />}</section>}</div>
  </main>;
}

function GroupedTaskGrid({
  tasks,
  renderTask,
  order,
  onReorder,
}: {
  tasks: TaskDisplay[];
  renderTask: (task: TaskDisplay) => ReactNode;
  order: TaskSubjectGroup[];
  onReorder: (newOrder: TaskSubjectGroup[]) => void;
}) {
  const [dragKey, setDragKey] = useState<TaskSubjectGroup | null>(null);
  const [dragOverKey, setDragOverKey] = useState<TaskSubjectGroup | null>(null);

  const orderedGroups = order
    .map((key) => TASK_SUBJECT_GROUPS.find((g) => g.key === key)!)
    .filter(Boolean);

  function handleDrop(targetKey: TaskSubjectGroup) {
    if (!dragKey || dragKey === targetKey) return;
    const next = [...order];
    const fromIdx = next.indexOf(dragKey);
    const toIdx = next.indexOf(targetKey);
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, dragKey);
    onReorder(next);
  }

  return (
    <div className="mt-4 space-y-3">
      {orderedGroups.map((group) => {
        const groupTasks = tasks.filter((task) => taskSubjectGroup(task) === group.key);
        if (!groupTasks.length) return null;
        const isDragging = dragKey === group.key;
        const isOver = dragOverKey === group.key && dragKey !== group.key;
        return (
          <section
            key={group.key}
            draggable
            onDragStart={() => setDragKey(group.key)}
            onDragEnd={() => { setDragKey(null); setDragOverKey(null); }}
            onDragOver={(e) => { e.preventDefault(); setDragOverKey(group.key); }}
            onDrop={(e) => { e.preventDefault(); handleDrop(group.key); setDragKey(null); setDragOverKey(null); }}
            className={`w-full overflow-visible rounded-xl border bg-mint/40 transition-all ${isOver ? "border-primary" : "border-mint"} ${isDragging ? "opacity-40" : ""}`}
          >
            <h3 className="flex cursor-grab items-center gap-1.5 border-b border-mint px-3 py-2.5 text-xs font-semibold text-ink active:cursor-grabbing">
              <GripVertical className="h-3 w-3 shrink-0 text-stone-300" />
              {group.label}
            </h3>
            {groupTasks.map(renderTask)}
          </section>
        );
      })}
    </div>
  );
}

function PlanSummary({ title, items, onClick }: { title: string; items: PlanOverviewItem[]; onClick: () => void }) {
  const [expanded, setExpanded] = useState(true);
  return <section className="rounded-2xl border border-stone-100 bg-white px-4 py-4 text-left shadow-sm"><div className="flex items-center justify-between"><button onClick={() => setExpanded(!expanded)} className="flex flex-1 items-center justify-between font-bold text-ink"><span>{title}</span><ChevronDown className={`h-4 w-4 text-stone-400 ${expanded ? "rotate-180" : ""}`} /></button><button onClick={onClick} className="ml-3 text-xs text-primary">查看</button></div>{expanded && <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">{TASK_SUBJECT_GROUPS.map((group) => { const groupItems = items.filter((item) => item.group === group.key).sort((a, b) => { const aDone = a.done >= a.total; const bDone = b.done >= b.total; if (aDone && !bDone) return 1; if (!aDone && bDone) return -1; return 0; }); return <section key={group.key} className="rounded-xl bg-mint/40 p-3"><h3 className="text-xs font-semibold text-ink">{group.label}</h3><div className="mt-2 space-y-2">{groupItems.length ? groupItems.map((item) => { const unfinished = item.done < item.total; return <div key={item.id} className={`flex items-center gap-2 rounded-md border-l-2 px-2 py-1.5 text-[11px] ${unfinished ? "border-amber-400 bg-amber-50/80 font-medium text-stone-700" : "border-stone-200 text-stone-400"}`}><span className="min-w-0 flex-1 truncate">{item.label}</span>{item.isCourse && <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold ${unfinished ? "bg-mint text-primary" : "bg-stone-200 text-stone-400"}`}>上课</span>}<span className="shrink-0 tabular-nums">{item.done} / {item.total} {item.unit}</span></div>; }) : <p className="text-[11px] text-stone-300">暂无</p>}</div></section>; })}</div>}</section>;
}
