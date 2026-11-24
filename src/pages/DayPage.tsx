import { addDays } from "date-fns";
import { CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, GripVertical, Plus } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSwipe } from "../hooks/useSwipe";
import { EmptyState } from "../components/EmptyState";
import { TaskItem } from "../components/TaskItem";
import { getCalendarAnnotation } from "../data/calendarAnnotations";
import { getRepository } from "../data/repositoryProvider";
import { taskRepository } from "../data/taskRepository";
import type { TaskDisplay, TaskStatus } from "../types/task";
import { formatCompactDate, formatFullDate, fromDateKey, relativeDayLabel, toDateKey, todayKey } from "../utils/date";
import { dayTaskKey, findJustCompleted, groupDayTasks, isUncountedTask, isWeekPlanTask, normalizeSubjectOrder, weekPlanDueLabel, weekPlanDueTone, type DayTaskPlacement, type TaskSubjectGroup } from "../utils/taskGrouping";
import { useGroupOrder } from "../hooks/useGroupOrder";
import { useSortableList } from "../hooks/useSortableList";
import { itemSyncKey, taskSyncKey } from "../utils/taskMeta";
import { sumWeeklyTimes, weeklyTimesProgress } from "../utils/weeklyTimes";
import { AllDoneCelebration } from "../components/AllDoneCelebration";
import { ParentBonusRow, PointsBar, practiceScoreLabels } from "../components/PointsPanel";
import { flowerCelebrations, loadPointsContext, settlePendingWeeks, type Celebration, type PointsContext } from "../data/pointsService";
import { formatMoreToDo, gainForLog, moreToDoToday, POINTS_START_WEEK } from "../utils/points";
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
  onDayNoteSave: (task: TaskDisplay, text: string, date: string) => void | Promise<void>;
  onWeeklyLog: (task: TaskDisplay, delta: number, date: string) => void | Promise<void>;
  onCopy: (task: TaskDisplay) => void; onOpenMonth: () => void;
  onAddTask: () => void;
  /** 积分庆祝（家长加奖励跨过 100 的整数倍时） */
  onCelebrate?: (items: Celebration[]) => void;
  unsyncedTasks?: Set<string>; unsyncedItems?: Set<string>;
  onRetrySync?: (task: TaskDisplay) => void; onRetryItemSync?: (task: TaskDisplay, itemId: string) => void;
}

export function DayPage(props: Props) {
  const [tasks, setTasks] = useState<TaskDisplay[]>([]);
  const [overdue, setOverdue] = useState<TaskDisplay[]>([]);
  const [weekPlanDone, setWeekPlanDone] = useState<TaskDisplay[]>([]);
  const [weeklyTimes, setWeeklyTimes] = useState<TaskDisplay[]>([]);
  // 每周几次刚做够的那一下，先在原位停留片刻再收进"已完成"（同 held）
  const [weeklyHeld, setWeeklyHeld] = useState<Set<string>>(new Set());
  const weeklyReachedRef = useRef<{ date: string; reached: Set<string> } | null>(null);
  const [showDone, setShowDone] = useState(true);
  const [showWeekDone, setShowWeekDone] = useState(false);
  // 积分（2026-11-24）：分数由完成记录算出，账本（奖励、愿望、快照…）在 app_settings
  const [points, setPoints] = useState<PointsContext | null>(null);
  const pointsRequest = useRef(0);
  const reloadPoints = () => {
    const request = ++pointsRequest.current;
    return loadPointsContext().then(async (context) => {
      if (request !== pointsRequest.current) return;
      setPoints(context);
      // 上周（及以前没打开过的周）结束了还没结算的，补一份快照
      if (await settlePendingWeeks(context)) { const next = await loadPointsContext(); if (request === pointsRequest.current) setPoints(next); }
    }).catch((error) => console.warn("[points] load", error));
  };
  useEffect(() => { void reloadPoints(); }, [props.refreshKey]);
  const { order, updateOrder } = useGroupOrder();
  // 刚完成的任务先在原位停留片刻（划线变灰、勾选动画播完），再收进"已完成"，
  // 否则一勾上整行立刻跳走，孩子看不到反馈。held 记录每条停留中的任务原本在哪个区。
  const [held, setHeld] = useState<Map<string, DayTaskPlacement>>(new Map());
  const placementRef = useRef<{ date: string; placement: Map<string, DayTaskPlacement> } | null>(null);
  const holdTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const reload = () => {
    const date = props.date;
    // 未来的日子不显示逾期区：今天还没做完的事挂在明天页面上叫"逾期"，排明天作业时容易误会
    return Promise.all([taskRepository.getTasksForDate(date), date > todayKey() ? Promise.resolve([] as TaskDisplay[]) : taskRepository.getOverdueTasks(date), taskRepository.getWeekPlanDone(date), taskRepository.getWeeklyTimes(date)]).then(([items, late, weekDone, times]) => {
      const reachedNow = new Set(times.filter((task) => weeklyTimesProgress(task, date).reached).map((task) => task.id));
      const before = weeklyReachedRef.current?.date === date ? weeklyReachedRef.current.reached : null;
      weeklyReachedRef.current = { date, reached: reachedNow };
      const newlyReached = before ? [...reachedNow].filter((id) => !before.has(id)) : [];
      if (newlyReached.length > 0) {
        setWeeklyHeld((current) => new Set([...current, ...newlyReached]));
        const timer = setTimeout(() => {
          holdTimers.current.delete(timer);
          setWeeklyHeld((current) => { const next = new Set(current); newlyReached.forEach((id) => next.delete(id)); return next; });
        }, COMPLETED_HOLD_MS);
        holdTimers.current.add(timer);
      }
      setWeeklyTimes(times);
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
      setWeekPlanDone(weekDone);
    });
  };
  useEffect(() => { reload(); }, [props.date, props.refreshKey]);
  // 换日期时不带着上一页的停留状态
  useEffect(() => { setHeld(new Map()); setWeeklyHeld(new Set()); }, [props.date]);
  useEffect(() => () => { holdTimers.current.forEach((timer) => clearTimeout(timer)); }, []);
  const reorderTasks = async (ids: string[]) => { await getRepository().reorderTasks(ids); await reload(); };
  const isSettled = (task: TaskDisplay) => ["done", "cancelled"].includes(task.status);
  const isToday = props.date === todayKey();
  // 每日计划 / 本周计划（2026-11-17）：几天内做完的作业不到截止日不算"今日任务"，归入"本周作业"组（规则见 isWeekPlanTask）；同在左栏，排在今天的作业后面
  const daily = tasks.filter((task) => !isWeekPlanTask(task, props.date));
  const weekly = tasks.filter((task) => isWeekPlanTask(task, props.date));
  const pending = daily.filter((task) => !isSettled(task) || held.get(dayTaskKey(task)) === "pending");
  const done = daily.filter((task) => isSettled(task) && !held.has(dayTaskKey(task)));
  const overdueShown = [...overdue, ...daily.filter((task) => isSettled(task) && held.get(dayTaskKey(task)) === "overdue")];
  // 本周作业 / 每周练习都能拖手柄排序（写 sortOrder）；没拖过的按截止日。不按学科排，跨学科拖动才不会被压回去
  const byOrder = (a: TaskDisplay, b: TaskDisplay) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || (a.endDate ?? "").localeCompare(b.endDate ?? "") || a.createdAt.localeCompare(b.createdAt);
  const weekPending = weekly.filter((task) => !isSettled(task) || held.get(dayTaskKey(task)) === "pending").sort(byOrder);
  const weekDone = [...weekly.filter((task) => isSettled(task) && !held.has(dayTaskKey(task))), ...weekPlanDone];
  // 左栏 = 作业（今天的 + 本周内交的），右栏 = 每周练习（每周几次）。2026-11-17 起本周作业并入左栏
  const allDone = [...done, ...weekDone];
  const leftPending = pending.length + weekPending.length;
  // 每周练习：本周没做够的在上面，做够了的收进"已完成"
  const timesReached = (task: TaskDisplay) => weeklyTimesProgress(task, props.date).reached;
  const timesPending = weeklyTimes.filter((task) => !timesReached(task) || weeklyHeld.has(task.id)).sort(byOrder);
  const timesDone = weeklyTimes.filter((task) => timesReached(task) && !weeklyHeld.has(task.id));
  const hasPractice = weeklyTimes.length > 0;
  // 提醒、休闲、旅游照常显示可勾，但不算进"还剩 N 项"和进度条（isUncountedTask）
  const progress = countProgress([...daily, ...weekly, ...weekPlanDone].filter((task) => !isUncountedTask(task)));
  // 「还剩 N 项」与进度条同一口径（有小项按小项、没有小项按任务），避免两个数字对不上
  const remaining = progress.total - progress.completed;
  // 每周练习按总次数算（2026-11-19 用户要求）：各项目标次数之和 vs 已做次数之和（每项最多算到目标），单位不同只是次数相加
  const practice = sumWeeklyTimes(weeklyTimes.map((task) => weeklyTimesProgress(task, props.date)));
  const practiceAllDone = practice.target > 0 && practice.done >= practice.target;
  const pointsOn = !!points && todayKey() >= POINTS_START_WEEK;
  const scoreById = new Map((points?.summary.weekScores ?? []).map((score) => [score.taskId, score]));
  // 当天学校作业全部做完（只看今天的学校作业，不看本周作业和提醒）→ 原来"今天的作业都做完了"一行改成"还可以再做"
  const schoolToday = daily.filter((task) => task.mainCategory === "school");
  const schoolAllDone = isToday && schoolToday.length > 0 && schoolToday.every(isSettled);
  const moreText = isToday ? formatMoreToDo(moreToDoToday(weeklyTimes, props.date)) : "";
  const dueLabelFor = (task: TaskDisplay) =>
    task.timeType === "dateRange" && task.mainCategory !== "temporary" && task.endDate && !task.rolledFromDate && task.endDate >= props.date
      ? { text: weekPlanDueLabel(task.endDate, props.date), tone: weekPlanDueTone(task.endDate, props.date) }
      : undefined;
  const move = (days: number) => props.onDateChange(toDateKey(addDays(fromDateKey(props.date), days)));
  const swipeRef = useSwipe<HTMLDivElement>(
    () => move(1),   // left swipe → next day
    () => move(-1),  // right swipe → prev day
  );
  // 勾选动作带上本页的查看日：过去日补勾记为那天完成（数据层保证不晚于今天）
  const rowProps = { compact: true, viewDate: props.date, onStatusChange: (task: TaskDisplay, status: TaskStatus) => props.onStatusChange(task, status, props.date), onEdit: props.onEdit, onDelete: props.onDelete, onEnd: props.onEnd, onExtend: props.onExtend, onOccurrenceCancel: props.onOccurrenceCancel, onOccurrencePostpone: props.onOccurrencePostpone, onChecklistToggle: (task: TaskDisplay, itemId: string) => props.onChecklistToggle(task, itemId, props.date), onDayNoteSave: (task: TaskDisplay, text: string) => props.onDayNoteSave(task, text, props.date), onCopy: props.onCopy };
  const annotation = getCalendarAnnotation(props.date);
  const annotationLabels = [...annotation.solarTerms, ...annotation.festivals];
  const [dateLabel, weekdayLabel] = formatFullDate(props.date).split(" ");
  const navButton = "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-ink/15 bg-white text-muted shadow-sm hover:border-primary/30 hover:text-primary sm:h-10 sm:w-10";
  const renderTask = (task: TaskDisplay, dragHandle?: ReactNode) => <TaskItem
    key={dayTaskKey(task)}
    dragHandle={dragHandle}
    dueLabel={dueLabelFor(task)}
    weekly={task.timeType === "weeklyTimes" ? { progress: weeklyTimesProgress(task, props.date), onLog: (date, delta) => props.onWeeklyLog(task, delta, date), score: pointsOn && weeklyTimesProgress(task, props.date).weekStart === points?.summary.weekStart ? practiceScoreLabels(scoreById.get(task.id)) : undefined, gainFor: pointsOn ? (date, delta) => gainForLog(task, date, delta) : undefined } : undefined}
    task={task}
    unsynced={props.unsyncedTasks?.has(taskSyncKey(task))}
    unsyncedItemIds={props.unsyncedItems && task.checklistItems ? new Set(task.checklistItems.filter((item) => props.unsyncedItems!.has(itemSyncKey(task.id, item.id))).map((item) => item.id)) : undefined}
    onRetrySync={() => props.onRetrySync?.(task)}
    onRetryItemSync={(itemId) => props.onRetryItemSync?.(task, itemId)}
    {...rowProps}
  />;

  return <main className="mx-auto w-full max-w-3xl overflow-x-hidden lg:max-w-none xl:max-w-7xl px-3 pb-content pt-4 sm:px-7 sm:pt-6 lg:px-10">
    <header className="page-header">
      <div className="day-header-content grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 sm:gap-x-4">
        <div className="min-w-0"><div className="flex min-w-0 flex-wrap content-center items-center gap-x-2 gap-y-1"><h1 className="page-title"><span className="whitespace-nowrap">{dateLabel}</span><span className="block whitespace-nowrap sm:ml-2 sm:inline">{weekdayLabel}</span></h1>{annotationLabels.length > 0 && <span title={annotationLabels.join(" · ")} className="max-w-full truncate text-[13px] font-semibold text-amber-700">{annotationLabels.join(" · ")}</span>}{annotation.holidayStatus && <span className={`shrink-0 rounded px-1.5 py-0.5 text-[13px] font-bold leading-4 ${annotation.holidayStatus === "休" ? "bg-rose-50 text-rose-700" : "bg-blue-50 text-blue-700"}`}>{annotation.holidayStatus}</span>}</div></div>
        <div className="day-header-actions flex flex-nowrap items-center gap-1 sm:gap-2"><button onClick={() => move(-1)} aria-label="前一天" title="前一天" className={navButton}><ChevronLeft className="h-5 w-5" /></button><button onClick={() => props.onDateChange(todayKey())} aria-label={isToday ? "今天" : "回到今天"} title="回到今天" disabled={isToday} className={`h-8 w-20 shrink-0 rounded-lg border text-sm font-bold transition-colors sm:h-10 sm:w-20 ${isToday ? "border-primary bg-primary text-white" : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"}`}>今天</button><button onClick={() => move(1)} aria-label="后一天" title="后一天" className={navButton}><ChevronRight className="h-5 w-5" /></button><button onClick={props.onOpenMonth} aria-label="打开月视图" title="打开月视图" className={`${navButton} hidden sm:flex`}><CalendarDays className="h-5 w-5" /></button><button onClick={props.onAddTask} aria-label="新建当日任务" title="新建任务" className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-alert text-white hover:bg-[#cf5b40] desk:flex desk:h-10 desk:w-10"><Plus className="h-5 w-5" /></button></div>
      </div>
    </header>
    {!isToday && <div role="status" className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-sun/60 bg-sun/20 px-3 py-2 sm:px-4"><p className="min-w-0 text-sm font-semibold text-ink">正在看 {formatCompactDate(props.date)}（{relativeDayLabel(props.date)}），不是今天</p><button onClick={() => props.onDateChange(todayKey())} className="h-9 shrink-0 rounded-lg bg-primary px-3 text-sm font-bold text-white [@media(pointer:coarse)]:h-11">回到今天</button></div>}
    {/* Mac / iPad 横屏：左右两栏等宽等高。左栏是作业（逾期 / 今日任务〔今天的 + 本周作业〕/ 已完成），
        右栏是每周练习（每周几次）；两栏底边对齐，短的一栏主卡片拉长。
        窄屏依次排下来：逾期、今日任务、每周练习、已完成——两栏外壳在窄屏是 display:contents，靠 order 排序 */}
    {pointsOn && points && <PointsBar ctx={points} onChanged={() => void reloadPoints()} />}
    <div ref={swipeRef} className={`flex flex-col gap-4 ${hasPractice ? "lg:grid lg:grid-cols-2 lg:items-stretch" : ""}`}>
      <div className={`contents ${hasPractice ? "lg:flex lg:min-w-0 lg:flex-col lg:gap-4" : ""}`}>
        {overdueShown.length > 0 && <section className="surface overflow-visible border-alert/35 order-1 lg:order-none"><div className="flex items-center justify-between border-b border-alert/20 bg-alert/[0.06] px-3 py-2.5 sm:px-4"><h2 className="text-base font-bold text-alert">逾期未完成</h2><span className="text-[13px] font-semibold tabular-nums text-alert">{overdue.length}</span></div>{overdueShown.map((task) => renderTask(task))}</section>}
        <section className="surface order-2 overflow-visible lg:order-none lg:flex-1">
          <div className="flex items-center gap-3 border-b border-ink/10 px-3 py-3 sm:px-4"><h2 className="shrink-0 text-base font-bold text-ink">{isToday ? "今日任务" : "当日任务"}</h2><ProgressMeter completed={progress.completed} total={progress.total} />{progress.total > 0 && <span className={`ml-auto shrink-0 text-[13px] font-semibold tabular-nums ${remaining === 0 ? "text-primary" : "text-ink"}`}>{remaining === 0 ? "全部完成" : `还剩 ${remaining} 项`}</span>}</div>
          {pending.length > 0 && <GroupedTaskGrid tasks={pending} renderTask={renderTask} order={order} onReorder={updateOrder} onTaskReorder={reorderTasks} />}
          {schoolAllDone && pointsOn && leftPending > 0
            ? <p className={`px-4 py-3 text-[15px] leading-6 text-ink ${pending.length > 0 ? "border-t border-ink/[0.07]" : ""}`}><span className="font-semibold text-primary">学校作业都做完了</span>{moreText ? <>，还可以再做：<span className="whitespace-pre-wrap">{moreText}</span></> : weeklyTimes.every(timesReached) ? "，这周的练习也都达标了" : "，今天能做的练习也都做过了"}</p>
            : pending.length === 0 && weekPending.length > 0 && done.length > 0 && <p className="px-4 py-3 text-[15px] font-semibold text-primary">{isToday ? "今天" : "这一天"}的作业都做完了</p>}
          {weekPending.length > 0 && <div className={pending.length > 0 || done.length > 0 ? "border-t border-ink/[0.07]" : ""}>
            <GroupHeading label="本周作业" dot={NEUTRAL_DOT} count={weekPending.length} />
            <SortableTaskList tasks={weekPending} renderTask={renderTask} onReorder={reorderTasks} />
          </div>}
          {leftPending === 0 && (isToday && allDone.length > 0 && overdueShown.length === 0 ? <AllDoneCelebration count={allDone.length} /> : allDone.length > 0 ? <p className="px-4 py-4 text-[15px] font-semibold text-primary">这一天的事都做完了</p> : <div className="p-3"><EmptyState compact /></div>)}
        </section>
        {allDone.length > 0 && <section className="surface order-4 overflow-visible lg:order-none"><button onClick={() => setShowDone(!showDone)} className="flex w-full items-center justify-between px-3 py-2.5 text-left sm:px-4"><span className="flex items-center gap-2 text-base font-bold text-ink"><CheckCircle2 className="h-4 w-4 text-primary" />已完成 <span className="text-[13px] font-medium text-muted">{allDone.length}</span></span><ChevronDown className={`h-4 w-4 text-muted transition ${showDone ? "rotate-180" : ""}`} /></button>{showDone && <div className="border-t border-ink/10">{allDone.map((task) => renderTask(task))}</div>}</section>}
      </div>
      {hasPractice && <div className="contents lg:flex lg:min-w-0 lg:flex-col">
        <section aria-label="每周练习" className="surface order-3 overflow-visible lg:order-none lg:flex-1">
          <div className="flex items-center gap-3 border-b border-ink/10 px-3 py-3 sm:px-4"><h2 className="shrink-0 text-base font-bold text-ink">每周练习</h2><ProgressMeter completed={practice.done} total={practice.target} />{pointsOn && points ? <span title={`本周已做 ${practice.done}/${practice.target} 次`} className={`ml-auto shrink-0 text-[13px] font-semibold tabular-nums ${practiceAllDone ? "text-primary" : "text-ink"}`}>本周 {points.summary.weekTotal} 分</span> : <span title="本周已做次数 / 本周目标次数（各项加起来）" className={`ml-auto shrink-0 text-[13px] font-semibold tabular-nums ${practiceAllDone ? "text-primary" : "text-ink"}`}>{practiceAllDone ? `本周都做够了 ${practice.done}/${practice.target}` : `已做 ${practice.done}/${practice.target} 次`}</span>}</div>
          <SortableTaskList tasks={timesPending} renderTask={renderTask} onReorder={reorderTasks} />
          {timesPending.length === 0 && <p className="px-4 py-3 text-[15px] font-semibold text-primary">这周的练习都做够了</p>}
          {timesDone.length > 0 && <>
            <button onClick={() => setShowWeekDone(!showWeekDone)} aria-expanded={showWeekDone} className="flex min-h-11 w-full items-center justify-between border-t border-ink/[0.07] px-3 text-left text-[13px] font-semibold text-muted sm:px-4"><span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" />已做够 {timesDone.length}</span><ChevronDown className={`h-4 w-4 transition ${showWeekDone ? "rotate-180" : ""}`} /></button>
            {showWeekDone && <div className="border-t border-ink/[0.07]">{timesDone.map((task) => renderTask(task))}</div>}
          </>}
          {pointsOn && points && <ParentBonusRow ctx={points} onChanged={() => void reloadPoints()} onBonusAdded={(before) => { void reloadPoints(); void flowerCelebrations(before).then((items) => items.length && props.onCelebrate?.(items)); }} />}
        </section>
      </div>}
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
  const { classes, homework, reminders } = groupDayTasks(tasks, order);
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
      {reminders.length > 0 && (
        <section className="w-full overflow-visible">
          <GroupHeading label="其他" suffix="提醒" dot={SUBJECT_DOT.other} count={reminders.length} />
          <SortableTaskList tasks={reminders} renderTask={renderTask} onReorder={onTaskReorder} />
        </section>
      )}
    </div>
  );
}

// 组内逐条任务拖拽（与任务管理页共用 reorderTasks/sortOrder）：只对无具体时间的任务开放，
// 带时间的任务始终按时间置顶（taskSort 规则），不提供手柄避免误导。
// 2026-11-14 起用 useSortableList（指针拖拽、实时让位、松手立刻生效），手柄在每行右侧"…"旁边。
// 2026-11-18：手柄只在电脑（精确指针）上显示，手机和 iPad 不显示（用户：触屏上不需要调顺序）。
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
            className="-my-1 hidden h-8 w-7 shrink-0 items-center justify-center rounded-md text-stone-300 hover:bg-stone-100 hover:text-muted [@media(pointer:fine)]:flex">
            <GripVertical aria-hidden className="h-4 w-4" />
          </button>
        );
        return <div key={id} ref={item.ref} style={item.style}>{renderTask(task, handle)}</div>;
      })}
    </>
  );
}

/** 有小项时只统计小项；没有小项时，大项自身计为一项。使用当前查看日的展示状态，历史日期的小项完成情况由数据层提供 */
function countProgress(tasks: TaskDisplay[]) {
  return tasks.reduce((result, task) => {
    if (task.checklistItems?.length) {
      result.total += task.checklistItems.length;
      result.completed += task.checklistItems.filter((item) => item.done).length;
    } else {
      result.total += 1;
      if (["done", "cancelled"].includes(task.status)) result.completed += 1;
    }
    return result;
  }, { completed: 0, total: 0 });
}
