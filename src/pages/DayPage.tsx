import { addDays } from "date-fns";
import { Backpack, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, GripVertical, Pencil, Pin, Plus, Sparkles, X } from "lucide-react";
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
import { ParentBonusRow, PointsHeader, practiceScoreLabels, WeekSummaryBanner } from "../components/PointsPanel";
import { loadPointsContext, settlePendingWeeks, type Celebration, type PointsContext } from "../data/pointsService";
import { EARLY_POINTS, formatMoreToDo, gainForLog, moreToDoToday, POINTS_START_WEEK, practiceSettingsOf, REACH_BONUS } from "../utils/points";
import { isParentDevice } from "../utils/device";
import { loadSchoolTimetable, type SchoolTimetable } from "../data/appSettingsRepository";
import { buildCarryList, carryItemsFor, splitCarryEdit, type CarryEntry } from "../utils/carryItems";
import { loadCarryReminders, saveCarryReminders, type CarryReminders } from "../data/carryRepository";
import { Sheet } from "../components/Sheet";
import { GroupHeading, NEUTRAL_DOT, RewardHint, SUBJECT_DOT } from "../components/GroupHeading";

/** 刚完成的任务在原位停留多久再收进"已完成"（略长于 400ms 的勾选动画） */
const COMPLETED_HOLD_MS = 700;

/**
 * 两栏卡片的表头（2026-11-25 用户嫌原来"标题 + 细进度条 + 右边小字"挤在一行太死板）：
 * 第一行 17px 粗体标题、可选提示胶囊、右边一个圆角小标签；第二行一条通栏进度条。
 */
function CardHeader({ title, hint, badge, badgeDone, completed, total }: { title: string; hint?: ReactNode; badge?: ReactNode; badgeDone?: boolean; completed: number; total: number }) {
  const percentage = total === 0 ? 0 : Math.min(100, (completed / total) * 100);
  return (
    <div className="border-b border-ink/10 px-3 pb-3 pt-3.5 sm:px-4">
      <div className="flex min-w-0 items-center gap-2 desk:gap-2.5">
        <h2 className="shrink-0 text-[15px] font-bold leading-6 text-ink desk:text-[17px]">{title}</h2>
        {hint && <span className="min-w-0">{hint}</span>}
        {badge !== undefined && <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold tabular-nums desk:px-2.5 desk:text-[13px] ${badgeDone ? "bg-primary/10 text-primary" : "bg-stone-100 text-ink"}`}>{badge}</span>}
      </div>
      {total > 0 && <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-stone-200/80" role="meter" aria-label={`${title}进度，已完成 ${completed}/${total}`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed}>
        <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${percentage}%` }} />
      </div>}
    </div>
  );
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
  /** 积分庆祝（达标等，中档） */
  onCelebrate?: (items: Celebration[]) => void;
  /** 积分条上点零钱 / 存款 → 记账页 */
  onOpenLedger?: () => void;
  onOpenTimetable?: () => void;
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
  // 积分（2026-11-24）：分数由完成记录算出，账本（奖励、快照…）在 app_settings；零钱 / 存款余额由记账记录算出
  const [points, setPoints] = useState<PointsContext | null>(null);
  const [timetable, setTimetable] = useState<SchoolTimetable | null>(null);
  useEffect(() => { void loadSchoolTimetable().then(setTimetable).catch(() => setTimetable(null)); }, [props.refreshKey]);
  const [carryReminders, setCarryReminders] = useState<CarryReminders>({ pinned: [], days: {} });
  const [carryEditing, setCarryEditing] = useState(false);
  useEffect(() => { void loadCarryReminders().then(setCarryReminders).catch(() => setCarryReminders({ pinned: [], days: {} })); }, [props.refreshKey]);
  const pointsRequest = useRef(0);
  const reloadPoints = () => {
    const request = ++pointsRequest.current;
    return loadPointsContext().then(async (context) => {
      if (request !== pointsRequest.current) return;
      setPoints(context);
      // 上周（及以前没打开过的周）结束了还没结算的、周日晚 8 点后的这一周，补一份快照（固定那周的零花钱）
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
  // 明天要带（2026-11-25）：课表里明天高亮的课（课本 / 葫芦丝……）；只在看今天时显示，明天是周末或放假就没有
  const carryDate = fromDateKey(props.date);
  carryDate.setDate(carryDate.getDate() + 1);
  const carryKey = toDateKey(carryDate);
  const carryBase = isToday && timetable ? carryItemsFor(timetable, carryDate, getCalendarAnnotation(carryKey).holidayStatus === "休").map((item) => item.label) : [];
  const carryItems = buildCarryList(carryBase, carryReminders.pinned, carryReminders.days[carryKey]);
  const carryLabel = "明日必带";
  const scoreById = new Map((points?.summary.weekScores ?? []).map((score) => [score.taskId, score]));
  // 当天学校作业全部做完（只看今天的学校作业，不看本周作业和提醒）→ 原来"今天的作业都做完了"一行改成"还可以再做"
  const schoolToday = daily.filter((task) => task.mainCategory === "school");
  const schoolAllDone = isToday && schoolToday.length > 0 && schoolToday.every(isSettled);
  const moreText = isToday ? formatMoreToDo(moreToDoToday(weeklyTimes, props.date)) : "";
  // docs/TASK_09_points.md §9.5：还有能做的练习时只写"今天的作业做完了，快去赚积分吧！"（能做哪些看右栏每周练习，不再列）
  const moreLine = schoolAllDone && pointsOn
    ? <div className="px-3 py-3 sm:px-4"><p data-testid="more-to-do" className="flex items-center gap-2 rounded-lg bg-mint/70 px-3 py-3 text-[16px] font-bold leading-6 text-primary sm:gap-2.5 sm:px-3.5 sm:text-[17px]"><Sparkles aria-hidden className="h-5 w-5 shrink-0" strokeWidth={2.25} /><span className="min-w-0 whitespace-nowrap">{moreText ? "今天的作业做完了，快去赚积分吧！" : <>今天的作业都做完了。<span className="font-medium text-ink">{weeklyTimes.every(timesReached) ? "这周的练习也都达标了。" : "今天能做的练习也都做过了。"}</span></>}</span></p></div>
    : null;
  // 过去日期的补记（打勾或取消）只在 Mac 上有；iPad / 手机上过去日期的勾选框点不了（§7、§8）
  const parentDevice = isParentDevice();
  const pastLocked = !parentDevice && props.date < todayKey();
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
  const rowProps = { compact: true, viewDate: props.date, readOnly: pastLocked, onStatusChange: (task: TaskDisplay, status: TaskStatus) => props.onStatusChange(task, status, props.date), onEdit: props.onEdit, onDelete: props.onDelete, onEnd: props.onEnd, onExtend: props.onExtend, onOccurrenceCancel: props.onOccurrenceCancel, onOccurrencePostpone: props.onOccurrencePostpone, onChecklistToggle: (task: TaskDisplay, itemId: string) => props.onChecklistToggle(task, itemId, props.date), onDayNoteSave: (task: TaskDisplay, text: string) => props.onDayNoteSave(task, text, props.date), onCopy: props.onCopy };
  const annotation = getCalendarAnnotation(props.date);
  const annotationLabels = [...annotation.solarTerms, ...annotation.festivals];
  const [dateLabel, weekdayLabel] = formatFullDate(props.date).split(" ");
  const navButton = "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-ink/15 bg-white text-muted shadow-sm hover:border-primary/30 hover:text-primary desk:h-10 desk:w-10";
  const renderTask = (task: TaskDisplay, dragHandle?: ReactNode) => <TaskItem
    key={dayTaskKey(task)}
    dragHandle={dragHandle}
    dueLabel={dueLabelFor(task)}
    weekly={task.timeType === "weeklyTimes" ? { progress: weeklyTimesProgress(task, props.date), onLog: (date, delta) => props.onWeeklyLog(task, delta, date), score: pointsOn && weeklyTimesProgress(task, props.date).weekStart === points?.summary.weekStart ? practiceScoreLabels(scoreById.get(task.id)) : undefined, pointValue: pointsOn ? practiceSettingsOf(task).points : undefined, gainFor: pointsOn ? (date, delta) => gainForLog(task, date, delta) : undefined, allowPast: parentDevice } : undefined}
    task={task}
    unsynced={props.unsyncedTasks?.has(taskSyncKey(task))}
    unsyncedItemIds={props.unsyncedItems && task.checklistItems ? new Set(task.checklistItems.filter((item) => props.unsyncedItems!.has(itemSyncKey(task.id, item.id))).map((item) => item.id)) : undefined}
    onRetrySync={() => props.onRetrySync?.(task)}
    onRetryItemSync={(itemId) => props.onRetryItemSync?.(task, itemId)}
    {...rowProps}
  />;

  return <main className="mx-auto w-full max-w-3xl overflow-x-hidden lg:max-w-none xl:max-w-7xl px-3 pb-content pt-3 sm:px-5 desk:px-10 desk:pt-6">
    <header className="page-header">
      {/* 2026-11-25：上周 / 本周积分放在表头中间（宽屏 lg 起；窄屏放在日期下面一行居中） */}
      <div className="day-header-content grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 sm:gap-x-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="min-w-0"><div className="flex min-w-0 flex-wrap content-center items-center gap-x-2 gap-y-1"><h1 className="page-title day-title"><span className="hidden whitespace-nowrap desk:inline">{dateLabel}</span><span className="whitespace-nowrap desk:hidden">{dateLabel.replace(/^\d{4}年/, "")}</span><span className="day-title-weekday ml-1.5 whitespace-nowrap desk:ml-2">{weekdayLabel}</span></h1>{annotationLabels.length > 0 && <span title={annotationLabels.join(" · ")} className="max-w-full truncate text-[13px] font-semibold text-amber-700">{annotationLabels.join(" · ")}</span>}{annotation.holidayStatus && <span className={`shrink-0 rounded px-1.5 py-0.5 text-[13px] font-bold leading-4 ${annotation.holidayStatus === "休" ? "bg-rose-50 text-rose-700" : "bg-blue-50 text-blue-700"}`}>{annotation.holidayStatus}</span>}</div></div>
        {pointsOn && points && <div className="col-span-2 row-start-2 justify-self-center lg:col-span-1 lg:col-start-2 lg:row-start-1"><PointsHeader ctx={points} /></div>}
        <div className="day-header-actions flex flex-nowrap items-center gap-1 justify-self-end sm:gap-2 lg:col-start-3 lg:row-start-1"><button onClick={() => move(-1)} aria-label="前一天" title="前一天" className={navButton}><ChevronLeft className="h-4 w-4 desk:h-5 desk:w-5" /></button><button onClick={() => props.onDateChange(todayKey())} aria-label={isToday ? "今天" : "回到今天"} title="回到今天" disabled={isToday} className={`h-8 w-14 shrink-0 rounded-lg border text-[13px] font-bold transition-colors desk:h-10 desk:w-20 desk:text-sm ${isToday ? "border-primary bg-primary text-white" : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"}`}>今天</button><button onClick={() => move(1)} aria-label="后一天" title="后一天" className={navButton}><ChevronRight className="h-4 w-4 desk:h-5 desk:w-5" /></button><button onClick={props.onOpenMonth} aria-label="打开月视图" title="打开月视图" className={`${navButton} hidden sm:flex`}><CalendarDays className="h-5 w-5" /></button><button onClick={props.onAddTask} aria-label="新建当日任务" title="新建任务" className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-alert text-white hover:bg-[#cf5b40] desk:flex desk:h-10 desk:w-10"><Plus className="h-5 w-5" /></button></div>
      </div>
    </header>
    {!isToday && <div role="status" className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-sun/60 bg-sun/20 px-3 py-2 sm:px-4"><p className="min-w-0 text-sm font-semibold text-ink">正在看 {formatCompactDate(props.date)}（{relativeDayLabel(props.date)}），不是今天</p><button onClick={() => props.onDateChange(todayKey())} className="h-9 shrink-0 rounded-lg bg-primary px-3 text-sm font-bold text-white [@media(pointer:coarse)]:h-11">回到今天</button></div>}
    {/* Mac / iPad 横屏：左右两栏等宽等高。左栏是作业（逾期 / 家庭作业〔今天的 + 本周课外作业〕/ 已完成），
        右栏是每周练习（每周几次）；两栏底边对齐，短的一栏主卡片拉长。
        窄屏依次排下来：逾期、家庭作业、每周练习、已完成——两栏外壳在窄屏是 display:contents，靠 order 排序 */}
    {/* 明天要带（2026-11-25）：课表里明天高亮的课 + 手动补充 − 删掉的；最后一个笔图标改那一天的（补充或删除） */}
    {isToday && timetable && (
      <div data-testid="carry-reminder" className="mb-3 flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-[#3F8F86]/25 bg-[#EAF4F2] px-3 py-1.5 desk:mb-4 desk:min-h-11 desk:gap-x-2.5 desk:px-4 desk:py-2">
        <button type="button" onClick={props.onOpenTimetable} className="flex items-center gap-1.5 text-[13px] font-bold text-[#2D6F68] hover:underline desk:gap-2 desk:text-[14px]" title="打开课表"><Backpack aria-hidden className="h-4 w-4 desk:h-[18px] desk:w-[18px]" />{carryLabel}</button>
        {carryItems.length === 0 && <span className="text-[13px] text-muted">没有要带的</span>}
        {carryItems.map((item) => (
          <span key={item.label} className="relative rounded-full bg-white px-2 py-0.5 text-[12px] font-semibold desk:px-2.5 desk:text-[13px] text-ink ring-1 ring-inset ring-[#3F8F86]/25" title={item.pinned ? "常驻：每天都提醒" : undefined}>
            {item.label}
            {item.pinned && <span aria-label="常驻" className="absolute -right-1 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-white ring-2 ring-[#EAF4F2]"><Pin className="h-2.5 w-2.5" strokeWidth={3} /></span>}
          </span>
        ))}
        <button type="button" onClick={() => setCarryEditing(true)} aria-label="补充或删除明天要带的东西" title="补充或删除"
          className="-my-1 ml-auto flex h-8 w-8 items-center justify-center rounded-full text-[#2D6F68] hover:bg-white/70 desk:h-9 desk:w-9"><Pencil className="h-4 w-4" /></button>
      </div>
    )}
    {carryEditing && <CarryEditor title={carryLabel} items={carryItems} base={carryBase} onClose={() => setCarryEditing(false)}
      onSave={async (edited) => { const split = splitCarryEdit(carryBase, edited); setCarryReminders(await saveCarryReminders(carryKey, split.day, split.pinned, todayKey())); setCarryEditing(false); }} />}
    {pointsOn && points && <WeekSummaryBanner ctx={points} />}
    <div ref={swipeRef} className={`flex flex-col gap-4 ${hasPractice ? "lg:grid lg:grid-cols-2 lg:items-stretch" : ""}`}>
      <div className={`contents ${hasPractice ? "lg:flex lg:min-w-0 lg:flex-col lg:gap-4" : ""}`}>
        {overdueShown.length > 0 && <section className="surface overflow-visible border-alert/35 order-1 lg:order-none"><div className="flex items-center justify-between border-b border-alert/20 bg-alert/[0.06] px-3 py-2.5 sm:px-4"><h2 className="text-base font-bold text-alert">逾期未完成</h2><span className="text-[13px] font-semibold tabular-nums text-alert">{overdue.length}</span></div>{overdueShown.map((task) => renderTask(task))}</section>}
        <section className="surface order-2 overflow-visible lg:order-none lg:flex-1">
          {/* 2026-11-25 用户："今日任务"改名"家庭作业"（看别的日子也叫"家庭作业"） */}
          <CardHeader title="学校家庭作业" completed={progress.completed} total={progress.total} badge={progress.total > 0 ? (remaining === 0 ? "全部完成" : `还剩 ${remaining} 项`) : undefined} badgeDone={remaining === 0} />
          {pending.length > 0 && <GroupedTaskGrid tasks={pending} renderTask={renderTask} order={order} onReorder={updateOrder} onTaskReorder={reorderTasks} />}
          {moreLine && leftPending > 0
            ? <div className={pending.length > 0 ? "border-t border-ink/[0.07]" : ""}>{moreLine}</div>
            : pending.length === 0 && weekPending.length > 0 && done.length > 0 && <p className="px-4 py-3 text-[15px] font-semibold text-primary">{isToday ? "今天" : "这一天"}的作业都做完了</p>}
          {weekPending.length > 0 && <div className={pending.length > 0 || done.length > 0 ? "border-t border-ink/[0.07]" : ""}>
            <GroupHeading label="本周课外作业" hint={pointsOn ? `提前完成加${EARLY_POINTS}分` : undefined} dot={NEUTRAL_DOT} count={weekPending.length} />
            <SortableTaskList tasks={weekPending} renderTask={renderTask} onReorder={reorderTasks} />
          </div>}
          {/* 2026-11-25（B2）：全做完只留一处反馈——"今天的作业做完了，快去赚积分吧！"那一条（散花卡片会飞到这里），不再另加"今天的 N 件事都做完了"大卡片 */}
          {leftPending === 0 && (isToday && allDone.length > 0 && overdueShown.length === 0 ? (moreLine ?? <p className="px-4 py-4 text-[15px] font-semibold text-primary">今天的事都做完了！</p>) : allDone.length > 0 ? <p className="px-4 py-4 text-[15px] font-semibold text-primary">这一天的事都做完了</p> : <div className="p-3"><EmptyState compact /></div>)}
        </section>
        {allDone.length > 0 && <section className="surface order-4 overflow-visible lg:order-none"><button onClick={() => setShowDone(!showDone)} className="flex w-full items-center justify-between px-3 py-2.5 text-left sm:px-4"><span className="flex items-center gap-2 text-base font-bold text-ink"><CheckCircle2 className="h-4 w-4 text-primary" />已完成 <span className="text-[13px] font-medium text-muted">{allDone.length}</span></span><ChevronDown className={`h-4 w-4 text-muted transition ${showDone ? "rotate-180" : ""}`} /></button>{showDone && <div className="border-t border-ink/10">{allDone.map((task) => renderTask(task))}</div>}</section>}
      </div>
      {hasPractice && <div className="contents lg:flex lg:min-w-0 lg:flex-col">
        <section aria-label="每周练习" className="surface order-3 overflow-visible lg:order-none lg:flex-1">
          <CardHeader title="每周练习" hint={pointsOn ? <RewardHint text={`每项全完成另加${REACH_BONUS}分`} /> : undefined} completed={practice.done} total={practice.target} badgeDone={practiceAllDone}
            // 2026-11-25：分数已在表头"上周 / 本周"胶囊里，这里只写进度（各项本周已做次数之和 / 目标之和）
            badge={<span title="本周已做次数 / 本周目标次数（各项加起来）">{practiceAllDone ? `本周都做够了 ${practice.done}/${practice.target}` : `已做 ${practice.done}/${practice.target} 次`}</span>} />
          <SortableTaskList tasks={timesPending} renderTask={renderTask} onReorder={reorderTasks} />
          {timesPending.length === 0 && <p className="px-4 py-3 text-[15px] font-semibold text-primary">这周的练习都做够了</p>}
          {timesDone.length > 0 && <>
            <button onClick={() => setShowWeekDone(!showWeekDone)} aria-expanded={showWeekDone} className="flex min-h-11 w-full items-center justify-between border-t border-ink/[0.07] px-3 text-left text-[13px] font-semibold text-muted sm:px-4"><span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" />已做够 {timesDone.length}</span><ChevronDown className={`h-4 w-4 transition ${showWeekDone ? "rotate-180" : ""}`} /></button>
            {showWeekDone && <div className="border-t border-ink/[0.07]">{timesDone.map((task) => renderTask(task))}</div>}
          </>}
          {pointsOn && points && <ParentBonusRow ctx={points} onChanged={() => void reloadPoints()} />}
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


/**
 * 改"明天要带"（2026-11-25）：每样后面 × 删掉；自己加的东西可以点📌切换"常驻"（每天都提醒）/"仅明天"；
 * 输入框后面两个按钮"仅明天""每天都带"。课表里算出来的那几样删掉只影响这一天。
 */
function CarryEditor({ title, items, base, onClose, onSave }: { title: string; items: CarryEntry[]; base: string[]; onClose: () => void; onSave: (items: CarryEntry[]) => Promise<void> }) {
  const [list, setList] = useState(items);
  const [draft, setDraft] = useState("");
  const [draftPinned, setDraftPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  // 输入框后面一个图钉：点亮 = 每天都带，不点 = 仅明天；回车加进去，直接点保存也会把输入框里的一起加上
  const withDraft = (current: CarryEntry[]) => {
    const value = draft.trim();
    if (!value) return current;
    return [...current.filter((item) => item.label !== value), { label: value, pinned: draftPinned, fromTimetable: base.includes(value) }];
  };
  const add = () => { setList(withDraft(list)); setDraft(""); setDraftPinned(false); };
  const togglePin = (label: string) => setList(list.map((item) => item.label === label ? { ...item, pinned: !item.pinned } : item));
  // 2026-11-25 用户：不要解释文字；自己加的东西名字后面一个图钉，点亮 = 常驻（每天都提醒），点灭 = 只这一天
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="space-y-3">
        {list.length > 0 && (
          <ul className="space-y-1.5">
            {list.map((item) => (
              <li key={item.label} className="flex min-h-11 items-center gap-1 rounded-lg bg-white pl-3 pr-1 ring-1 ring-inset ring-ink/10">
                <span className="min-w-0 truncate text-[15px] font-semibold text-ink">{item.label}</span>
                {!item.fromTimetable && (
                  <button type="button" onClick={() => togglePin(item.label)} aria-pressed={item.pinned} aria-label={item.pinned ? `取消常驻 ${item.label}` : `设为常驻 ${item.label}`}
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${item.pinned ? "text-amber-500" : "text-stone-300 hover:text-muted"}`}>
                    <Pin className="h-4 w-4" fill={item.pinned ? "currentColor" : "none"} />
                  </button>
                )}
                <span className="flex-1" />
                <button type="button" aria-label={`删掉 ${item.label}`} onClick={() => setList(list.filter((value) => value.label !== item.label))} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-rose-50 hover:text-rose-700"><X className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex min-h-11 items-center gap-1 rounded-lg border border-ink/15 bg-white pl-3 pr-1 focus-within:border-primary">
          <input value={draft} maxLength={20} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} placeholder="加一样" aria-label="加一样要带的东西" enterKeyHint="done"
            className="min-h-10 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none" />
          <button type="button" onClick={() => setDraftPinned(!draftPinned)} aria-pressed={draftPinned} aria-label={draftPinned ? "每天都带（点一下改成仅明天）" : "仅明天（点一下改成每天都带）"}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${draftPinned ? "text-amber-500" : "text-stone-300 hover:text-muted"}`}>
            <Pin className="h-4 w-4" fill={draftPinned ? "currentColor" : "none"} />
          </button>
        </div>
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await onSave(withDraft(list)); } finally { setBusy(false); } }} className="min-h-11 w-full rounded-lg bg-primary text-sm font-bold text-white hover:bg-[#256a4d] disabled:opacity-50">保存</button>
      </div>
    </Sheet>
  );
}
