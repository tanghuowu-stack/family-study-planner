import { addDays } from "date-fns";
import { CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, GripVertical, Plus } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSwipe } from "../hooks/useSwipe";
import { EmptyState } from "../components/EmptyState";
import { TaskItem } from "../components/TaskItem";
import { getCalendarAnnotation } from "../data/calendarAnnotations";
import { getRepository } from "../data/repositoryProvider";
import { taskRepository } from "../data/taskRepository";
import type { PlanOverviewItem, TaskDisplay, TaskStatus } from "../types/task";
import { formatCompactDate, formatFullDate, fromDateKey, relativeDayLabel, toDateKey, todayKey } from "../utils/date";
import { TASK_SUBJECT_GROUPS, dayTaskKey, findJustCompleted, groupDayTasks, normalizeSubjectOrder, type DayTaskPlacement, type TaskSubjectGroup } from "../utils/taskGrouping";
import { useGroupOrder } from "../hooks/useGroupOrder";
import { useSortableList } from "../hooks/useSortableList";
import { itemSyncKey, taskSyncKey } from "../utils/taskMeta";
import { SidebarMemo } from "../components/SidebarMemo";
import { AllDoneCelebration } from "../components/AllDoneCelebration";
import { GroupHeading, NEUTRAL_DOT, SUBJECT_DOT } from "../components/GroupHeading";

/** 刚完成的任务在原位停留多久再收进"已完成"（略长于 400ms 的勾选动画） */
const COMPLETED_HOLD_MS = 700;

function ProgressMeter({ completed, total }: { completed: number; total: number }) {
  const percentage = total === 0 ? 0 : (completed / total) * 100;
  return <div className="flex min-w-0 w-24 flex-1 items-center gap-1.5 sm:w-32 sm:max-w-40" role="meter" aria-label={`清单进度，已完成 ${completed}/${total}`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed}><div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-stone-200"><div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${percentage}%` }} /></div></div>;
}

interface Props {
  date: string; refreshKey: number; onDateChange: (date: string) => void;
  onStatusChange: (task: TaskDisplay, status: TaskStatus, asOfDate?: string) => void | Promise<void>; onEdit: (task: TaskDisplay) => void;
  onDelete: (task: TaskDisplay) => void; onEnd: (task: TaskDisplay) => void; onExtend: (task: TaskDisplay) => void; onOccurrenceCancel: (task: TaskDisplay) => void;
  onOccurrencePostpone: (task: TaskDisplay) => void; onChecklistToggle: (task: TaskDisplay, itemId: string, asOfDate?: string) => void | Promise<void>;
  onCopy: (task: TaskDisplay) => void; onOpenMonth: () => void;
  onAddTask: () => void;
  memo: string; onMemoFocus: () => void; onMemoChange: (value: string) => void; onMemoBlur: () => void; onMemoComplete: () => void;
  memoEditorOpen: boolean; memoFocusRequest: number;
  memoBusy: boolean;
  unsyncedTasks?: Set<string>; unsyncedItems?: Set<string>;
  onRetrySync?: (task: TaskDisplay) => void; onRetryItemSync?: (task: TaskDisplay, itemId: string) => void;
}

export function DayPage(props: Props) {
  const [tasks, setTasks] = useState<TaskDisplay[]>([]);
  const [overdue, setOverdue] = useState<TaskDisplay[]>([]);
  const [showDone, setShowDone] = useState(true);
  const { order, updateOrder } = useGroupOrder();
  // 刚完成的任务先在原位停留片刻（划线变灰、勾选动画播完），再收进"已完成"，
  // 否则一勾上整行立刻跳走，孩子看不到反馈。held 记录每条停留中的任务原本在哪个区。
  const [held, setHeld] = useState<Map<string, DayTaskPlacement>>(new Map());
  const placementRef = useRef<{ date: string; placement: Map<string, DayTaskPlacement> } | null>(null);
  const holdTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const reload = () => {
    const date = props.date;
    // 未来的日子不显示逾期区：今天还没做完的事挂在明天页面上叫"逾期"，排明天作业时容易误会
    return Promise.all([taskRepository.getTasksForDate(date), date > todayKey() ? Promise.resolve([] as TaskDisplay[]) : taskRepository.getOverdueTasks(date)]).then(([items, late]) => {
      const { placement, justCompleted } = findJustCompleted(placementRef.current?.date === date ? placementRef.current.placement : null, items, late);
      placementRef.current = { date, placement };
      if (justCompleted.size > 0) {
        setHeld((current) => new Map([...current, ...justCompleted]));
        const timer = setTimeout(() => {
          holdTimers.current.delete(timer);
          setHeld((current) => { const next = new Map(current); justCompleted.forEach((_, key) => next.delete(key)); return next; });
        }, COMPLETED_HOLD_MS);
        holdTimers.current.add(timer);
      }
      setTasks(items);
      setOverdue(late);
    });
  };
  useEffect(() => { reload(); }, [props.date, props.refreshKey]);
  // 换日期时不带着上一页的停留状态
  useEffect(() => { setHeld(new Map()); }, [props.date]);
  useEffect(() => () => { holdTimers.current.forEach((timer) => clearTimeout(timer)); }, []);
  const reorderTasks = async (ids: string[]) => { await getRepository().reorderTasks(ids); await reload(); };
  const isSettled = (task: TaskDisplay) => ["done", "cancelled"].includes(task.status);
  const pending = tasks.filter((task) => !isSettled(task) || held.get(dayTaskKey(task)) === "pending");
  const done = tasks.filter((task) => isSettled(task) && !held.has(dayTaskKey(task)));
  const overdueShown = [...overdue, ...tasks.filter((task) => isSettled(task) && held.get(dayTaskKey(task)) === "overdue")];
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
  // 「还剩 N 项」与进度条同一口径（有小项按小项、没有小项按任务），避免两个数字对不上
  const remaining = progress.total - progress.completed;
  const move = (days: number) => props.onDateChange(toDateKey(addDays(fromDateKey(props.date), days)));
  const swipeRef = useSwipe<HTMLDivElement>(
    () => move(1),   // left swipe → next day
    () => move(-1),  // right swipe → prev day
  );
  // 勾选动作带上本页的查看日：过去日补勾记为那天完成（数据层保证不晚于今天）
  const rowProps = { compact: true, viewDate: props.date, onStatusChange: (task: TaskDisplay, status: TaskStatus) => props.onStatusChange(task, status, props.date), onEdit: props.onEdit, onDelete: props.onDelete, onEnd: props.onEnd, onExtend: props.onExtend, onOccurrenceCancel: props.onOccurrenceCancel, onOccurrencePostpone: props.onOccurrencePostpone, onChecklistToggle: (task: TaskDisplay, itemId: string) => props.onChecklistToggle(task, itemId, props.date), onCopy: props.onCopy };
  const annotation = getCalendarAnnotation(props.date);
  const annotationLabels = [...annotation.solarTerms, ...annotation.festivals];
  const isToday = props.date === todayKey();
  const [dateLabel, weekdayLabel] = formatFullDate(props.date).split(" ");
  const navButton = "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-ink/15 bg-white text-muted shadow-sm hover:border-primary/30 hover:text-primary sm:h-10 sm:w-10";
  const renderTask = (task: TaskDisplay, dragHandle?: ReactNode) => <TaskItem
    key={dayTaskKey(task)}
    dragHandle={dragHandle}
    task={task}
    unsynced={props.unsyncedTasks?.has(taskSyncKey(task))}
    unsyncedItemIds={props.unsyncedItems && task.checklistItems ? new Set(task.checklistItems.filter((item) => props.unsyncedItems!.has(itemSyncKey(task.id, item.id))).map((item) => item.id)) : undefined}
    onRetrySync={() => props.onRetrySync?.(task)}
    onRetryItemSync={(itemId) => props.onRetryItemSync?.(task, itemId)}
    {...rowProps}
  />;

  return <main className="mx-auto w-full max-w-3xl overflow-x-hidden lg:max-w-none xl:max-w-6xl px-3 pb-content pt-4 sm:px-7 sm:pt-6 lg:px-10">
    <header className="page-header">
      <div className="day-header-content grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 sm:gap-x-4">
        <div className="min-w-0"><div className="flex min-w-0 flex-wrap content-center items-center gap-x-2 gap-y-1"><h1 className="page-title"><span className="whitespace-nowrap">{dateLabel}</span><span className="block whitespace-nowrap sm:ml-2 sm:inline">{weekdayLabel}</span></h1>{annotationLabels.length > 0 && <span title={annotationLabels.join(" · ")} className="max-w-full truncate text-[13px] font-semibold text-amber-700">{annotationLabels.join(" · ")}</span>}{annotation.holidayStatus && <span className={`shrink-0 rounded px-1.5 py-0.5 text-[13px] font-bold leading-4 ${annotation.holidayStatus === "休" ? "bg-rose-50 text-rose-700" : "bg-blue-50 text-blue-700"}`}>{annotation.holidayStatus}</span>}</div></div>
        <div className="day-header-actions flex flex-nowrap items-center gap-1 sm:gap-2"><button onClick={() => move(-1)} aria-label="前一天" title="前一天" className={navButton}><ChevronLeft className="h-5 w-5" /></button><button onClick={() => props.onDateChange(todayKey())} aria-label={isToday ? "今天" : "回到今天"} title="回到今天" disabled={isToday} className={`h-8 w-20 shrink-0 rounded-lg border text-sm font-bold transition-colors sm:h-10 sm:w-20 ${isToday ? "border-primary bg-primary text-white" : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"}`}>今天</button><button onClick={() => move(1)} aria-label="后一天" title="后一天" className={navButton}><ChevronRight className="h-5 w-5" /></button><button onClick={props.onOpenMonth} aria-label="打开月视图" title="打开月视图" className={`${navButton} hidden sm:flex`}><CalendarDays className="h-5 w-5" /></button><button onClick={props.onAddTask} aria-label="新建当日任务" title="新建任务" className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-alert text-white hover:bg-[#cf5b40] lg:flex lg:h-10 lg:w-10"><Plus className="h-5 w-5" /></button></div>
      </div>
    </header>
    {!isToday && <div role="status" className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-sun/60 bg-sun/20 px-3 py-2 sm:px-4"><p className="min-w-0 text-sm font-semibold text-ink">正在看 {formatCompactDate(props.date)}（{relativeDayLabel(props.date)}），不是今天</p><button onClick={() => props.onDateChange(todayKey())} className="h-9 shrink-0 rounded-lg bg-primary px-3 text-sm font-bold text-white [@media(pointer:coarse)]:h-11">回到今天</button></div>}
    <SidebarMemo value={props.memo} variant="narrow" editorOpen={props.memoEditorOpen} focusRequest={props.memoFocusRequest} busy={props.memoBusy} onFocus={props.onMemoFocus} onChange={props.onMemoChange} onBlur={props.onMemoBlur} onComplete={props.onMemoComplete} />
    <div ref={swipeRef} className="space-y-4">
      {overdueShown.length > 0 && <section className="surface overflow-visible border-alert/35"><div className="flex items-center justify-between border-b border-alert/20 bg-alert/[0.06] px-3 py-2.5 sm:px-4"><h2 className="text-base font-bold text-alert">逾期未完成</h2><span className="text-[13px] font-semibold tabular-nums text-alert">{overdue.length}</span></div>{overdueShown.map((task) => renderTask(task))}</section>}
      <section className="surface overflow-visible"><div className="flex items-center gap-3 border-b border-ink/10 px-3 py-3 sm:px-4"><h2 className="shrink-0 text-base font-bold text-ink">{isToday ? "今日清单" : "当日清单"}</h2><ProgressMeter completed={progress.completed} total={progress.total} />{progress.total > 0 && <span className={`ml-auto shrink-0 text-[13px] font-semibold tabular-nums ${remaining === 0 ? "text-primary" : "text-ink"}`}>{remaining === 0 ? "全部完成" : `还剩 ${remaining} 项`}</span>}</div>{pending.length ? <GroupedTaskGrid tasks={pending} renderTask={renderTask} order={order} onReorder={updateOrder} onTaskReorder={reorderTasks} /> : isToday && done.length > 0 && overdueShown.length === 0 ? <AllDoneCelebration count={done.length} /> : done.length > 0 ? <p className="px-4 py-4 text-[15px] font-semibold text-primary">这一天的事都做完了</p> : <div className="p-3"><EmptyState compact /></div>}</section>
      {done.length > 0 && <section className="surface overflow-visible"><button onClick={() => setShowDone(!showDone)} className="flex w-full items-center justify-between px-3 py-2.5 text-left sm:px-4"><span className="flex items-center gap-2 text-base font-bold text-ink"><CheckCircle2 className="h-4 w-4 text-primary" />已完成 <span className="text-[13px] font-medium text-muted">{done.length}</span></span><ChevronDown className={`h-4 w-4 text-muted transition ${showDone ? "rotate-180" : ""}`} /></button>{showDone && <div className="border-t border-ink/10">{done.map((task) => renderTask(task))}</div>}</section>}
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
  renderTask: (task: TaskDisplay, dragHandle?: ReactNode) => ReactNode;
  order: TaskSubjectGroup[];
  onReorder: (newOrder: TaskSubjectGroup[]) => void;
  onTaskReorder?: (ids: string[]) => Promise<void>;
}) {
  // 上课 / 作业两组（规则见 utils/taskGrouping.ts groupDayTasks）；作业组内的学科分组可整组拖拽排序
  const { classes, homework } = groupDayTasks(tasks, order);
  // 整组拖拽只在看得见的学科里挪，再按位置写回完整的学科顺序（看不见的学科保持原位）
  const groups = useSortableList(homework.map((group) => group.key), (visible) => {
    const full = normalizeSubjectOrder(order);
    const slots = full.map((key, index) => (visible.includes(key) ? index : -1)).filter((index) => index >= 0);
    const next = [...full];
    slots.forEach((slot, i) => { next[slot] = visible[i]; });
    onReorder(next);
  });
  const byKey = new Map(homework.map((group) => [group.key, group]));

  return (
    <div className="divide-y divide-ink/[0.07]">
      {classes.length > 0 && (
        <section className="w-full overflow-visible">
          <GroupHeading label="上课" dot={NEUTRAL_DOT} count={classes.length} />
          <SortableTaskList tasks={classes} renderTask={renderTask} onReorder={onTaskReorder} />
        </section>
      )}
      {homework.length > 0 && (
        <div className="divide-y divide-ink/[0.07]">
          {groups.order.map((key) => {
            const group = byKey.get(key);
            if (!group) return null;
            const item = groups.itemProps(key);
            return (
              <section key={key} ref={item.ref} style={item.style} className="w-full overflow-visible bg-white">
                <GroupHeading label={group.label} suffix="作业" dot={SUBJECT_DOT[group.key]} count={group.tasks.length} handle={homework.length > 1 ? groups.handleProps(key) : undefined} />
                <SortableTaskList tasks={group.tasks} renderTask={renderTask} onReorder={onTaskReorder} />
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 组内逐条任务拖拽（与任务管理页共用 reorderTasks/sortOrder）：只对无具体时间的任务开放，
// 带时间的任务始终按时间置顶（taskSort 规则），不提供手柄避免误导。
// 2026-11-14 起用 useSortableList（指针拖拽、实时让位、松手立刻生效），手柄在每行右侧"…"旁边。
function SortableTaskList({
  tasks,
  renderTask,
  onReorder,
}: {
  tasks: TaskDisplay[];
  renderTask: (task: TaskDisplay, dragHandle?: ReactNode) => ReactNode;
  onReorder?: (ids: string[]) => Promise<void>;
}) {
  const timed = tasks.filter((task) => task.startTime ?? task.time);
  const untimed = tasks.filter((task) => !(task.startTime ?? task.time));
  const sortable = !!onReorder && untimed.length > 1;
  const list = useSortableList(untimed.map((task) => task.id), (ids) => onReorder?.(ids), sortable);
  const byId = new Map(untimed.map((task) => [task.id, task]));

  return (
    <>
      {timed.map((task) => renderTask(task))}
      {list.order.map((id) => {
        const task = byId.get(id);
        if (!task) return null;
        if (!sortable) return <div key={id}>{renderTask(task)}</div>;
        const item = list.itemProps(id);
        const handle = (
          <button type="button" aria-label={`拖动调整“${task.title || "这项任务"}”的顺序`} title="按住拖动调整顺序" {...list.handleProps(id)}
            className="-my-1 flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-stone-300 hover:bg-stone-100 hover:text-muted [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-9">
            <GripVertical aria-hidden className="h-4 w-4" />
          </button>
        );
        return <div key={id} ref={item.ref} style={item.style}>{renderTask(task, handle)}</div>;
      })}
    </>
  );
}

function PlanSummary({ title, items, onClick }: { title: string; items: PlanOverviewItem[]; onClick: () => void }) {
  const [expanded, setExpanded] = useState(true);
  return <section className="rounded-2xl border border-stone-100 bg-white px-4 py-4 text-left shadow-sm"><div className="flex items-center justify-between"><button onClick={() => setExpanded(!expanded)} className="flex flex-1 items-center justify-between font-bold text-ink"><span>{title}</span><ChevronDown className={`h-4 w-4 text-stone-400 ${expanded ? "rotate-180" : ""}`} /></button><button onClick={onClick} className="ml-3 text-xs text-primary">查看</button></div>{expanded && <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">{TASK_SUBJECT_GROUPS.map((group) => { const groupItems = items.filter((item) => item.group === group.key).sort((a, b) => { const aDone = a.done >= a.total; const bDone = b.done >= b.total; if (aDone && !bDone) return 1; if (!aDone && bDone) return -1; return 0; }); return <section key={group.key} className="rounded-xl bg-mint/40 p-3"><h3 className="text-xs font-semibold text-ink">{group.label}</h3><div className="mt-2 space-y-2">{groupItems.length ? groupItems.map((item) => { const unfinished = item.done < item.total; return <div key={item.id} className={`flex items-center gap-2 rounded-md border-l-2 px-2 py-1.5 text-[11px] ${unfinished ? "border-amber-400 bg-amber-50/80 font-medium text-stone-700" : "border-stone-200 text-stone-400"}`}><span className="min-w-0 flex-1 truncate">{item.label}</span>{item.isCourse && <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold ${unfinished ? "bg-mint text-primary" : "bg-stone-200 text-stone-400"}`}>上课</span>}<span className="shrink-0 tabular-nums">{item.done} / {item.total} {item.unit}</span></div>; }) : <p className="text-[11px] text-stone-300">暂无</p>}</div></section>; })}</div>}</section>;
}
