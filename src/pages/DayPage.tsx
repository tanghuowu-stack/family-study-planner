import { addDays } from "date-fns";
import { ChevronDown } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { EmptyState } from "../components/EmptyState";
import { TaskItem } from "../components/TaskItem";
import { getCalendarAnnotation } from "../data/calendarAnnotations";
import { taskRepository } from "../data/taskRepository";
import type { PlanOverviewItem, TaskDisplay, TaskStatus } from "../types/task";
import { formatFullDate, fromDateKey, toDateKey, todayKey } from "../utils/date";
import { TASK_SUBJECT_GROUPS, taskSubjectGroup } from "../utils/taskGrouping";

interface Props {
  date: string; refreshKey: number; onDateChange: (date: string) => void;
  onStatusChange: (task: TaskDisplay, status: TaskStatus) => void; onEdit: (task: TaskDisplay) => void;
  onDelete: (task: TaskDisplay) => void; onOccurrenceCancel: (task: TaskDisplay) => void;
  onOccurrencePostpone: (task: TaskDisplay) => void; onChecklistToggle: (task: TaskDisplay, itemId: string) => void;
  onCopy: (task: TaskDisplay) => void; onOpenWeek: () => void; onOpenMonth: () => void;
}

export function DayPage(props: Props) {
  const [tasks, setTasks] = useState<TaskDisplay[]>([]);
  const [overdue, setOverdue] = useState<TaskDisplay[]>([]);
  const [showDone, setShowDone] = useState(true);
  const [weekSummary, setWeekSummary] = useState<PlanOverviewItem[]>([]);
  const [monthSummary, setMonthSummary] = useState<PlanOverviewItem[]>([]);
  useEffect(() => { Promise.all([taskRepository.getTasksForDate(props.date), taskRepository.getOverdueTasks(props.date), taskRepository.getWeekOverview(props.date), taskRepository.getMonthOverview(props.date)]).then(([items, late, week, month]) => { setTasks(items); setOverdue(late); setWeekSummary(week); setMonthSummary(month); }); }, [props.date, props.refreshKey]);
  const pending = tasks.filter((task) => !["done", "cancelled"].includes(task.status));
  const done = tasks.filter((task) => ["done", "cancelled"].includes(task.status));
  const move = (days: number) => props.onDateChange(toDateKey(addDays(fromDateKey(props.date), days)));
  const rowProps = { compact: true, onStatusChange: props.onStatusChange, onEdit: props.onEdit, onDelete: props.onDelete, onOccurrenceCancel: props.onOccurrenceCancel, onOccurrencePostpone: props.onOccurrencePostpone, onChecklistToggle: props.onChecklistToggle, onCopy: props.onCopy };
  const annotation = getCalendarAnnotation(props.date);
  const annotationLabels = [...annotation.solarTerms, ...annotation.festivals];
  const renderTask = (task: TaskDisplay) => <TaskItem key={`${task.id}:${task.occurrenceDate ?? task.date}`} task={task} {...rowProps} />;

  return <main className="mx-auto w-full max-w-7xl px-4 pb-28 pt-5 sm:px-6 sm:pt-8">
    <div className="mb-5 text-center"><h1 className="text-3xl font-semibold text-ink sm:text-4xl">{formatFullDate(props.date)}{annotationLabels.length > 0 && <span className="ml-2 text-base font-medium text-amber-700 sm:text-lg">· {annotationLabels.join(" · ")}</span>}{annotation.holidayStatus && <span className={`ml-2 inline-flex rounded-md px-2 py-0.5 align-middle text-sm font-bold ${annotation.holidayStatus === "休" ? "bg-rose-50 text-rose-700" : "bg-blue-50 text-blue-700"}`}>{annotation.holidayStatus}</span>}</h1><p className="mt-2 text-sm text-stone-500">今日待完成 {pending.length} 项｜已完成 {done.length} 项</p></div>
    <div className="mb-5 grid grid-cols-3 rounded-2xl border border-stone-100 bg-white p-1.5 text-sm"><button onClick={() => move(-1)} className="rounded-xl px-2 py-2 text-stone-500 hover:bg-stone-50">← 昨天</button><button onClick={() => props.onDateChange(todayKey())} className="rounded-xl px-2 py-2 font-medium text-sage-700 hover:bg-sage-50">回到今天</button><button onClick={() => move(1)} className="rounded-xl px-2 py-2 text-stone-500 hover:bg-stone-50">明天 →</button></div>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_480px] lg:items-start"><div><section className="rounded-2xl border border-stone-100 bg-white p-3 shadow-card"><div className="border-b border-stone-100 px-1 pb-3"><h2 className="font-semibold text-ink">今日清单</h2></div>{pending.length ? <GroupedTaskGrid tasks={pending} renderTask={renderTask} /> : <div className="p-2"><EmptyState compact /></div>}</section>{overdue.length > 0 && <section className="mt-4 overflow-visible rounded-2xl border border-rose-100 bg-white"><div className="border-b border-rose-100 bg-rose-50/50 px-4 py-2.5"><h2 className="text-sm font-semibold text-rose-700">逾期未完成 · {overdue.length}</h2></div>{overdue.map(renderTask)}</section>}{done.length > 0 && <section className="mt-4 rounded-2xl border border-stone-100 bg-white p-3"><button onClick={() => setShowDone(!showDone)} className="flex w-full items-center justify-between px-1 py-1 text-sm font-semibold text-stone-500">已完成 · {done.length}<ChevronDown className={`h-4 w-4 transition ${showDone ? "rotate-180" : ""}`} /></button>{showDone && <GroupedTaskGrid tasks={done} renderTask={renderTask} />}</section>}</div><aside className="grid gap-3 lg:sticky lg:top-20"><PlanSummary title="本周计划" items={weekSummary} onClick={props.onOpenWeek} /><PlanSummary title="本月计划" items={monthSummary} onClick={props.onOpenMonth} /></aside></div>
  </main>;
}

function GroupedTaskGrid({ tasks, renderTask }: { tasks: TaskDisplay[]; renderTask: (task: TaskDisplay) => ReactNode }) {
  return <div className="mt-3 space-y-3">{TASK_SUBJECT_GROUPS.map((group) => { const groupTasks = tasks.filter((task) => taskSubjectGroup(task) === group.key); if (!groupTasks.length) return null; return <section key={group.key} className="w-full overflow-visible rounded-xl border border-stone-100 bg-stone-50/50"><h3 className="border-b border-stone-100 px-3 py-2 text-xs font-semibold text-stone-700">{group.label}</h3>{groupTasks.map(renderTask)}</section>; })}</div>;
}

function PlanSummary({ title, items, onClick }: { title: string; items: PlanOverviewItem[]; onClick: () => void }) {
  const [expanded, setExpanded] = useState(true);
  return <section className="rounded-2xl border border-stone-100 bg-white px-4 py-3 text-left shadow-sm"><div className="flex items-center justify-between"><button onClick={() => setExpanded(!expanded)} className="flex flex-1 items-center justify-between text-sm font-semibold"><span>{title}</span><ChevronDown className={`h-4 w-4 text-stone-400 ${expanded ? "rotate-180" : ""}`} /></button><button onClick={onClick} className="ml-3 text-xs text-sage-700">查看</button></div>{expanded && <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">{TASK_SUBJECT_GROUPS.map((group) => { const groupItems = items.filter((item) => item.group === group.key); return <section key={group.key} className="rounded-xl bg-stone-50/80 p-3"><h3 className="text-xs font-semibold text-stone-700">{group.label}</h3><div className="mt-2 space-y-2">{groupItems.length ? groupItems.map((item) => { const unfinished = item.done < item.total; return <div key={item.id} className={`flex items-center gap-2 rounded-md border-l-2 px-2 py-1.5 text-[11px] ${unfinished ? "border-amber-400 bg-amber-50/80 font-medium text-stone-700" : "border-stone-200 text-stone-400"}`}><span className="min-w-0 flex-1 truncate">{item.label}</span>{item.isCourse && <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold ${unfinished ? "bg-ink text-white" : "bg-stone-200 text-stone-400"}`}>上课</span>}<span className="shrink-0 tabular-nums">{item.done} / {item.total} {item.unit}</span></div>; }) : <p className="text-[11px] text-stone-300">暂无</p>}</div></section>; })}</div>}</section>;
}
