import { addDays } from "date-fns";
import { CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, GripVertical, Plus } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useSwipe } from "../hooks/useSwipe";
import { EmptyState } from "../components/EmptyState";
import { TaskItem } from "../components/TaskItem";
import { getCalendarAnnotation } from "../data/calendarAnnotations";
import { getRepository } from "../data/repositoryProvider";
import { taskRepository } from "../data/taskRepository";
import type { PlanOverviewItem, TaskDisplay, TaskStatus } from "../types/task";
import { formatFullDate, fromDateKey, toDateKey, todayKey } from "../utils/date";
import { TASK_SUBJECT_GROUPS, groupDayTasks, normalizeSubjectOrder, type TaskSubjectGroup } from "../utils/taskGrouping";
import { useGroupOrder } from "../hooks/useGroupOrder";
import { itemSyncKey, taskSyncKey } from "../utils/taskMeta";

function ProgressMeter({ completed, total }: { completed: number; total: number }) {
  const percentage = total === 0 ? 0 : (completed / total) * 100;
  return <div className="flex min-w-0 w-24 flex-1 items-center gap-1.5 sm:w-32 sm:max-w-40" role="meter" aria-label="清单进度" aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed}><div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-stone-200"><div className="h-full rounded-full bg-alert transition-all duration-500" style={{ width: `${percentage}%` }} /></div><span className="shrink-0 tabular-nums text-[11px] font-semibold text-ink">{completed}/{total}</span></div>;
}

interface Props {
  date: string; refreshKey: number; onDateChange: (date: string) => void;
  onStatusChange: (task: TaskDisplay, status: TaskStatus, asOfDate?: string) => void; onEdit: (task: TaskDisplay) => void;
  onDelete: (task: TaskDisplay) => void; onEnd: (task: TaskDisplay) => void; onExtend: (task: TaskDisplay) => void; onOccurrenceCancel: (task: TaskDisplay) => void;
  onOccurrencePostpone: (task: TaskDisplay) => void; onChecklistToggle: (task: TaskDisplay, itemId: string, asOfDate?: string) => void;
  onCopy: (task: TaskDisplay) => void; onOpenMonth: () => void;
  onAddTask: () => void;
  unsyncedTasks?: Set<string>; unsyncedItems?: Set<string>;
  onRetrySync?: (task: TaskDisplay) => void; onRetryItemSync?: (task: TaskDisplay, itemId: string) => void;
}

export function DayPage(props: Props) {
  const [tasks, setTasks] = useState<TaskDisplay[]>([]);
  const [overdue, setOverdue] = useState<TaskDisplay[]>([]);
  const [showDone, setShowDone] = useState(true);
  const { order, updateOrder } = useGroupOrder();
  const reload = () => Promise.all([taskRepository.getTasksForDate(props.date), taskRepository.getOverdueTasks(props.date)]).then(([items, late]) => { setTasks(items); setOverdue(late); });
  useEffect(() => { reload(); }, [props.date, props.refreshKey]);
  const reorderTasks = async (ids: string[]) => { await getRepository().reorderTasks(ids); await reload(); };
  const pending = tasks.filter((task) => !["done", "cancelled"].includes(task.status));
  const done = tasks.filter((task) => ["done", "cancelled"].includes(task.status));
  // 有小项时只统计小项；没有小项时，大项自身计为一项。
  // 使用当前查看日的展示状态，历史日期的小项完成情况由数据层提供。
  const progress = tasks.reduce((result, task) => {
    if (task.checklistItems?.length) {
      result.total += task.checklistItems.length;
      result.completed += task.checklistItems.filter((item) => item.done).length;
    } else {
      result.total += 1;
      if (["done", "cancelled"].includes(task.status)) result.completed += 1;
    }
    return result;
  }, { completed: 0, total: 0 });
  const move = (days: number) => props.onDateChange(toDateKey(addDays(fromDateKey(props.date), days)));
  const swipeRef = useSwipe<HTMLDivElement>(
    () => move(1),   // left swipe → next day
    () => move(-1),  // right swipe → prev day
  );
  // 勾选动作带上本页的查看日：过去日补勾记为那天完成（数据层保证不晚于今天）
  const rowProps = { compact: true, onStatusChange: (task: TaskDisplay, status: TaskStatus) => props.onStatusChange(task, status, props.date), onEdit: props.onEdit, onDelete: props.onDelete, onEnd: props.onEnd, onExtend: props.onExtend, onOccurrenceCancel: props.onOccurrenceCancel, onOccurrencePostpone: props.onOccurrencePostpone, onChecklistToggle: (task: TaskDisplay, itemId: string) => props.onChecklistToggle(task, itemId, props.date), onCopy: props.onCopy };
  const annotation = getCalendarAnnotation(props.date);
  const annotationLabels = [...annotation.solarTerms, ...annotation.festivals];
  const isToday = props.date === todayKey();
  const [dateLabel, weekdayLabel] = formatFullDate(props.date).split(" ");
  const navButton = "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-ink/15 bg-white text-muted shadow-sm hover:border-primary/30 hover:text-primary sm:h-10 sm:w-10";
  const renderTask = (task: TaskDisplay) => <TaskItem
    key={`${task.id}:${task.occurrenceDate ?? task.date}`}
    task={task}
    unsynced={props.unsyncedTasks?.has(taskSyncKey(task))}
    unsyncedItemIds={props.unsyncedItems && task.checklistItems ? new Set(task.checklistItems.filter((item) => props.unsyncedItems!.has(itemSyncKey(task.id, item.id))).map((item) => item.id)) : undefined}
    onRetrySync={() => props.onRetrySync?.(task)}
    onRetryItemSync={(itemId) => props.onRetryItemSync?.(task, itemId)}
    {...rowProps}
  />;

  return <main className="mx-auto w-full max-w-6xl overflow-x-hidden px-3 pb-content pt-4 sm:px-7 sm:pt-6 lg:px-10">
    <header className="mb-3 border-b border-ink/10 pb-3 sm:mb-4 sm:pb-4">
      <div className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 sm:min-h-20 sm:gap-x-4">
        <div className="min-w-0"><div className="flex min-h-14 flex-wrap content-center items-center gap-x-2 gap-y-1 sm:min-h-16"><h1 className="text-sm font-bold leading-tight text-ink sm:text-xl xl:text-2xl"><span className="whitespace-nowrap">{dateLabel}</span><span className="block whitespace-nowrap sm:ml-2 sm:inline">{weekdayLabel}</span></h1>{annotationLabels.length > 0 && <span title={annotationLabels.join(" · ")} className="max-w-full truncate text-[11px] font-semibold text-amber-700 sm:text-sm">{annotationLabels.join(" · ")}</span>}{!isToday && <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">非今天</span>}{annotation.holidayStatus && <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${annotation.holidayStatus === "休" ? "bg-rose-50 text-rose-700" : "bg-blue-50 text-blue-700"}`}>{annotation.holidayStatus}</span>}</div></div>
        <div className="flex flex-nowrap items-center gap-1 sm:gap-2"><button onClick={() => move(-1)} aria-label="前一天" title="前一天" className={navButton}><ChevronLeft className="h-5 w-5" /></button><button onClick={() => props.onDateChange(todayKey())} aria-label={isToday ? "今天" : "回到今天"} title="回到今天" disabled={isToday} className={`h-8 w-20 shrink-0 rounded-lg border text-sm font-bold transition-colors sm:h-10 sm:w-16 lg:w-20 ${isToday ? "border-primary bg-primary text-white" : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"}`}>今天</button><button onClick={() => move(1)} aria-label="后一天" title="后一天" className={navButton}><ChevronRight className="h-5 w-5" /></button><button onClick={props.onOpenMonth} aria-label="打开月视图" title="打开月视图" className={`${navButton} hidden sm:flex`}><CalendarDays className="h-5 w-5" /></button><button onClick={props.onAddTask} aria-label="新建当日任务" title="新建任务" className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-alert text-white hover:bg-[#cf5b40] lg:flex lg:h-10 lg:w-10"><Plus className="h-5 w-5" /></button></div>
      </div>
    </header>
    <div ref={swipeRef} className="space-y-4">
      {overdue.length > 0 && <section className="surface overflow-visible border-alert/35"><div className="flex items-center justify-between border-b border-alert/20 bg-alert/[0.06] px-3 py-2"><h2 className="text-xs font-bold text-alert">逾期未完成</h2><span className="text-xs font-bold tabular-nums text-alert">{overdue.length}</span></div>{overdue.map(renderTask)}</section>}
      <section className="surface overflow-visible"><div className="flex items-center gap-2 border-b border-ink/10 px-3 py-2.5 sm:px-4"><h2 className="shrink-0 text-sm font-bold text-ink">{isToday ? "今日清单" : "当日清单"}</h2><ProgressMeter completed={progress.completed} total={progress.total} /><span className="ml-auto shrink-0 text-[11px] text-muted">{pending.length} 项待完成</span></div>{pending.length ? <GroupedTaskGrid tasks={pending} renderTask={renderTask} order={order} onReorder={updateOrder} onTaskReorder={reorderTasks} /> : <div className="p-3"><EmptyState compact /></div>}</section>
      {done.length > 0 && <section className="surface overflow-visible"><button onClick={() => setShowDone(!showDone)} className="flex w-full items-center justify-between px-3 py-2.5 text-left sm:px-4"><span className="flex items-center gap-2 text-sm font-bold text-ink"><CheckCircle2 className="h-4 w-4 text-primary" />已完成 <span className="text-[11px] font-medium text-muted">{done.length}</span></span><ChevronDown className={`h-4 w-4 text-muted transition ${showDone ? "rotate-180" : ""}`} /></button>{showDone && <div className="border-t border-ink/10"><GroupedTaskGrid tasks={done} renderTask={renderTask} order={order} onReorder={updateOrder} /></div>}</section>}
    </div>
  </main>;
}

function GroupedTaskGrid({
  tasks,
  renderTask,
  order,
  onReorder,
  onTaskReorder,
}: {
  tasks: TaskDisplay[];
  renderTask: (task: TaskDisplay) => ReactNode;
  order: TaskSubjectGroup[];
  onReorder: (newOrder: TaskSubjectGroup[]) => void;
  onTaskReorder?: (ids: string[]) => Promise<void>;
}) {
  const [dragKey, setDragKey] = useState<TaskSubjectGroup | null>(null);
  const [dragOverKey, setDragOverKey] = useState<TaskSubjectGroup | null>(null);

  // 上课 / 作业两组（规则见 utils/taskGrouping.ts groupDayTasks）；作业组内的学科分组仍可整组拖拽排序
  const { classes, homework } = groupDayTasks(tasks, order);
  const groupStyle: Record<TaskSubjectGroup, { accent: string; heading: string; title: string; count: string }> = {
    chinese: { accent: "#D96A52", heading: "bg-[#FFF0EA]", title: "text-[#B64E39]", count: "text-[#B64E39]/60" },
    math: { accent: "#5868C8", heading: "bg-[#EEF0FF]", title: "text-[#4056B5]", count: "text-[#4056B5]/60" },
    english: { accent: "#9364C7", heading: "bg-[#F5EDFF]", title: "text-[#7546AE]", count: "text-[#7546AE]/60" },
    other: { accent: "#738078", heading: "bg-[#EFF2F0]", title: "text-[#536159]", count: "text-[#536159]/60" },
  };

  function handleDrop(targetKey: TaskSubjectGroup) {
    if (!dragKey || dragKey === targetKey) return;
    // 在规整后的完整学科序上挪动：存储值若缺某个学科，indexOf 得 -1，splice(-1) 会误删最后一科
    const next = normalizeSubjectOrder(order);
    const fromIdx = next.indexOf(dragKey);
    const toIdx = next.indexOf(targetKey);
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, dragKey);
    onReorder(next);
  }

  return (
    <div className="divide-y divide-ink/10">
      {classes.length > 0 && (
        <section className="w-full overflow-visible border-l-4" style={{ borderLeftColor: "#0EA5E9" }}>
          <div className="flex items-center justify-between bg-sky-100/80 px-3 py-2.5 sm:px-4"><h3 className="text-sm font-extrabold text-sky-800">上课</h3><span className="text-[10px] font-semibold tabular-nums text-sky-700/60">{classes.length}</span></div>
          <div>
            <SortableTaskList tasks={classes} renderTask={renderTask} onReorder={onTaskReorder} />
          </div>
        </section>
      )}
      {homework.length > 0 && (
        <div className="divide-y divide-ink/10">
            {homework.map((group) => {
              const isDragging = dragKey === group.key;
              const isOver = dragOverKey === group.key && dragKey !== group.key;
              const style = groupStyle[group.key];
              return (
                <section
                  key={group.key}
                  draggable
                  onDragStart={() => setDragKey(group.key)}
                  onDragEnd={() => { setDragKey(null); setDragOverKey(null); }}
                  onDragOver={(e) => { e.preventDefault(); setDragOverKey(group.key); }}
                  onDrop={(e) => { e.preventDefault(); handleDrop(group.key); setDragKey(null); setDragOverKey(null); }}
                  className={`w-full overflow-visible border-l-4 bg-white transition-all ${isDragging ? "opacity-40" : ""}`}
                  style={{ borderLeftColor: isOver ? "#245747" : style.accent }}
                >
                  <h4 className={`flex cursor-grab items-center gap-1.5 px-3 py-2.5 text-sm font-bold active:cursor-grabbing sm:px-4 ${style.heading}`}>
                    <GripVertical className="h-3 w-3 shrink-0 text-stone-300" />
                    <span className={style.title}>{group.label}</span><span className="font-medium text-stone-500">作业</span><span className={`ml-auto text-[10px] font-semibold tabular-nums ${style.count}`}>{group.tasks.length}</span>
                  </h4>
                  <SortableTaskList tasks={group.tasks} renderTask={renderTask} onReorder={onTaskReorder} />
                </section>
              );
            })}
        </div>
      )}
    </div>
  );
}

// 学科分组内逐条任务拖拽（与任务管理页共用 reorderTasks/sortOrder）：只对无具体时间的任务开放，
// 带时间的任务始终按时间置顶（taskSort 规则），拖拽对它们不产生视觉效果，不提供手柄避免误导
function SortableTaskList({
  tasks,
  renderTask,
  onReorder,
}: {
  tasks: TaskDisplay[];
  renderTask: (task: TaskDisplay) => ReactNode;
  onReorder?: (ids: string[]) => Promise<void>;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const timed = tasks.filter((task) => task.startTime ?? task.time);
  const untimed = tasks.filter((task) => !(task.startTime ?? task.time));
  const sortable = !!onReorder && untimed.length > 1;

  const drop = async (targetId: string) => {
    if (!sortable || !dragId || dragId === targetId) return;
    const ids = untimed.map((task) => task.id);
    const fromIdx = ids.indexOf(dragId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, dragId);
    await onReorder!(ids);
  };

  return (
    <>
      {timed.map(renderTask)}
      {untimed.map((task) => sortable ? (
        <div
          key={task.id}
          draggable
          onDragStart={() => setDragId(task.id)}
          onDragEnd={() => { setDragId(null); setOverId(null); }}
          onDragOver={(e) => { e.preventDefault(); setOverId(task.id); }}
          onDrop={(e) => { e.preventDefault(); void drop(task.id); setDragId(null); setOverId(null); }}
          className={`flex items-start gap-1 transition-all ${dragId === task.id ? "opacity-40" : ""} ${overId === task.id && dragId !== task.id ? "border-t-2 border-primary" : ""}`}
        >
          <GripVertical className="mt-4 h-3.5 w-3.5 shrink-0 cursor-grab text-stone-300 active:cursor-grabbing" />
          <div className="min-w-0 flex-1">{renderTask(task)}</div>
        </div>
      ) : <div key={task.id}>{renderTask(task)}</div>)}
    </>
  );
}

function PlanSummary({ title, items, onClick }: { title: string; items: PlanOverviewItem[]; onClick: () => void }) {
  const [expanded, setExpanded] = useState(true);
  return <section className="rounded-2xl border border-stone-100 bg-white px-4 py-4 text-left shadow-sm"><div className="flex items-center justify-between"><button onClick={() => setExpanded(!expanded)} className="flex flex-1 items-center justify-between font-bold text-ink"><span>{title}</span><ChevronDown className={`h-4 w-4 text-stone-400 ${expanded ? "rotate-180" : ""}`} /></button><button onClick={onClick} className="ml-3 text-xs text-primary">查看</button></div>{expanded && <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">{TASK_SUBJECT_GROUPS.map((group) => { const groupItems = items.filter((item) => item.group === group.key).sort((a, b) => { const aDone = a.done >= a.total; const bDone = b.done >= b.total; if (aDone && !bDone) return 1; if (!aDone && bDone) return -1; return 0; }); return <section key={group.key} className="rounded-xl bg-mint/40 p-3"><h3 className="text-xs font-semibold text-ink">{group.label}</h3><div className="mt-2 space-y-2">{groupItems.length ? groupItems.map((item) => { const unfinished = item.done < item.total; return <div key={item.id} className={`flex items-center gap-2 rounded-md border-l-2 px-2 py-1.5 text-[11px] ${unfinished ? "border-amber-400 bg-amber-50/80 font-medium text-stone-700" : "border-stone-200 text-stone-400"}`}><span className="min-w-0 flex-1 truncate">{item.label}</span>{item.isCourse && <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold ${unfinished ? "bg-mint text-primary" : "bg-stone-200 text-stone-400"}`}>上课</span>}<span className="shrink-0 tabular-nums">{item.done} / {item.total} {item.unit}</span></div>; }) : <p className="text-[11px] text-stone-300">暂无</p>}</div></section>; })}</div>}</section>;
}
