import { CalendarPlus, CalendarX, Check, ChevronDown, Copy, MoreHorizontal, NotebookPen, Pencil, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ChecklistItem, TaskDisplay, TaskStatus } from "../types/task";
import { WEEKLY_LOG_DAY_MAX, type WeeklyTimesProgress } from "../utils/weeklyTimes";
import { STATUS_META, canEndRecurring, canExtendRecurring, isOccurrenceSchedule, taskShortName } from "../utils/taskMeta";
import { formatCompactDate, todayKey } from "../utils/date";

interface Props {
  task: TaskDisplay;
  compact?: boolean;
  /** 今日页正在看的日期：在这一天之前就做完的小项收成一行"已完成 N 项" */
  viewDate?: string;
  /** 每周几次（今日页右栏"每周练习"）：左侧显示本周进度环，标题下是一周七天的圆点（左键打勾、右键 / 长按填数量） */
  weekly?: {
    progress: WeeklyTimesProgress;
    onLog: (date: string, delta: number) => void;
    /** 积分（2026-11-24）：标题右侧灰色小字"N 分"，超出目标但不计分的"多读了 N 本" */
    score?: { points: string; extra?: string };
    /** 记这一下能多得几分：今天打勾时圆点上方飘出"+2"（补记以前的日子不飘） */
    gainFor?: (date: string, delta: number) => number;
    /** 能不能在过去的日子上补记（只有 Mac 上可以，docs/TASK_09_points.md §7） */
    allowPast?: boolean;
  };
  /** 勾选框、小项点不了（iPad / 手机上查看过去的日子：补记只在 Mac 上） */
  readOnly?: boolean;
  /** 小项默认收起成一行"还有 N 项"，点开再勾（今日页"本周作业"：一周的事不必每天摊开全部小项） */
  collapseChecklist?: boolean;
  /** 截止标签（今日页"本周作业"里的"周五截止"、截止日当天的"今天截止"）：today 红、soon（明天）琥珀、其余主色 */
  dueLabel?: { text: string; tone: "today" | "soon" | "normal" };
  /** 拖拽手柄（今日页可排序的任务才有），放在"…"左边，不挤占勾选框的位置 */
  dragHandle?: ReactNode;
  unsynced?: boolean; // 任务自身完成状态未同步到云端
  unsyncedItemIds?: Set<string>; // 哪些清单小项未同步到云端
  onStatusChange?: (task: TaskDisplay, status: TaskStatus) => void | Promise<void>;
  onEdit?: (task: TaskDisplay) => void;
  onDelete?: (task: TaskDisplay) => void;
  onEnd?: (task: TaskDisplay) => void;
  onExtend?: (task: TaskDisplay) => void;
  onOccurrenceCancel?: (task: TaskDisplay) => void;
  onOccurrencePostpone?: (task: TaskDisplay) => void;
  onChecklistToggle?: (task: TaskDisplay, itemId: string) => void | Promise<void>;
  onRetrySync?: () => void;
  onRetryItemSync?: (itemId: string) => void;
  onCopy?: (task: TaskDisplay) => void;
  /** 写查看日（viewDate）的记录，空文本即删除；不传则不显示记录标记 */
  onDayNoteSave?: (task: TaskDisplay, text: string) => void | Promise<void>;
}

/** 未同步到云端的持续可见标记（不是一闪而过的 toast），点击手动重试 */
function UnsyncedBadge({ onRetry }: { onRetry?: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onRetry?.(); }}
      title="未同步到云端，点击重试"
      className="ml-2 inline-flex shrink-0 items-center gap-1 rounded-full bg-sun/25 px-2 py-0.5 text-[13px] font-semibold leading-4 text-ink no-underline"
    >
      <TriangleAlert className="h-3 w-3" />未同步
    </button>
  );
}

type AnimState = "idle" | "checking" | "unchecking";

const DUE_TONE = { today: "bg-alert/10 text-alert", soon: "bg-amber-100 text-amber-800", normal: "bg-primary/10 text-primary" } as const;

/** 写入结束后，界面数据仍未跟上乐观值时，多久之后放弃乐观值、如实显示库内状态 */
const OPTIMISTIC_FALLBACK_MS = 1500;

function checkboxClass(animState: AnimState, checked: boolean, size: "md" | "sm" = "md"): string {
  const base = size === "md"
    ? "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 transition-all duration-300"
    : "flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-all duration-200";
  if (animState === "checking") return `${base} scale-110 border-primary bg-primary text-white`;
  if (animState === "unchecking") return `${base} scale-95 border-stone-300 bg-stone-100 text-stone-300`;
  if (checked) return `${base} border-primary bg-primary text-white`;
  return size === "md"
    ? `${base} border-stone-300 text-transparent hover:border-primary`
    : `${base} border-stone-300 text-transparent`;
}

/**
 * 带小项的非重复任务：左侧不再是可点的整体勾选框，而是只读进度环。
 * 小项全部勾完后数据层自动把任务记为完成（recomputeStatusFromChecklist），
 * 避免孩子点偏到主框把所有小项一次性标完成。
 */
function ChecklistRing({ completed, total, done, label }: { completed: number; total: number; done: boolean; label?: string }) {
  const radius = 11;
  const circumference = 2 * Math.PI * radius;
  const ratio = done ? 1 : total === 0 ? 0 : completed / total;
  return (
    <span role="img" aria-label={label ?? (done ? "小项已全部完成" : `小项已完成 ${completed}/${total}`)} title={label ?? "勾完全部小项后自动完成"} className="relative flex h-7 w-7 shrink-0 items-center justify-center">
      <svg viewBox="0 0 28 28" className="h-7 w-7 -rotate-90">
        <circle cx="14" cy="14" r={radius} strokeWidth="3" className={`stroke-stone-200 transition-all duration-300 ${done ? "fill-primary" : "fill-none"}`} />
        <circle cx="14" cy="14" r={radius} strokeWidth="3" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - ratio)} className="fill-none stroke-primary transition-all duration-300" />
      </svg>
      {done && <Check className="absolute h-4 w-4 text-white" strokeWidth={3} />}
    </span>
  );
}

export function TaskItem({ task, compact = false, viewDate, readOnly = false, weekly, collapseChecklist, dueLabel, dragHandle, unsynced, unsyncedItemIds, onStatusChange, onEdit, onDelete, onEnd, onExtend, onOccurrenceCancel, onOccurrencePostpone, onChecklistToggle, onDayNoteSave, onRetrySync, onRetryItemSync, onCopy }: Props) {
  const [menu, setMenu] = useState(false);
  const [showEarlier, setShowEarlier] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  // 菜单离屏幕底部（含底部导航栏）太近时向上展开，避免被遮住
  const [menuAbove, setMenuAbove] = useState(false);
  const toggleMenu = (button: HTMLButtonElement) => {
    if (!menu) {
      const bounds = button.getBoundingClientRect();
      const spaceBelow = window.innerHeight - bounds.bottom;
      setMenuAbove(spaceBelow < 320 && bounds.top > spaceBelow);
    }
    setMenu(!menu);
  };
  const [checkState, setCheckState] = useState<AnimState>("idle");
  const [itemAnim, setItemAnim] = useState<Record<string, AnimState>>({});
  const [optimisticDone, setOptimisticDone] = useState<boolean | null>(null);
  const [optimisticItems, setOptimisticItems] = useState<Record<string, boolean>>({});

  const menuRef = useRef<HTMLDivElement>(null);

  // 当天记录（2026-11-14）：原先标题后有小本子标记可新写；2026-11-21 去掉入口，只保留已有记录的显示和修改
  const savedNote = viewDate ? task.dayNotes?.[viewDate] ?? "" : "";
  const [noteEditing, setNoteEditing] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [optimisticNote, setOptimisticNote] = useState<string | null>(null);
  const noteOpen = useRef(false); // 回车/Esc 结束后输入框卸载可能再触发一次失焦，只处理第一次
  const noteVersion = useRef(0);
  const note = optimisticNote ?? savedNote;
  const canNote = !!onDayNoteSave && !!viewDate;
  useEffect(() => { setOptimisticNote((current) => (current !== null && current === savedNote ? null : current)); }, [savedNote]);
  const openNote = () => { noteOpen.current = true; setNoteDraft(note); setNoteEditing(true); };
  const finishNote = (save: boolean) => {
    if (!noteOpen.current) return;
    noteOpen.current = false;
    setNoteEditing(false);
    if (!save) return;
    const value = noteDraft.trim();
    if (value === note) return;
    setOptimisticNote(value);
    const version = ++noteVersion.current;
    void Promise.resolve(onDayNoteSave?.(task, value)).catch(() => {}).finally(() => {
      setTimeout(() => { if (noteVersion.current === version) setOptimisticNote(null); }, OPTIMISTIC_FALLBACK_MS);
    });
  };

  const effectiveStatus = task.occurrenceStatus === "postponed" && task.overrideDate ? "todo" : task.status;
  const statusDone = optimisticDone !== null ? optimisticDone : effectiveStatus === "done";
  const hasChecklist = !!task.checklistItems?.length;
  const displayItems = task.checklistItems?.map((item) => ({ ...item, done: optimisticItems[item.id] ?? item.done })) ?? [];
  const completedItems = displayItems.filter((item) => item.done).length;
  // 重复类任务的小项是跨天共用的一份，某天是否完成记在当天的单日状态上，必须保留整体勾选框；
  // 其余带小项的任务由小项驱动完成，左侧只显示进度环。
  const ringMode = hasChecklist && !isOccurrenceSchedule(task);
  const done = weekly ? weekly.progress.reached : ringMode && Object.keys(optimisticItems).length > 0 ? completedItems === displayItems.length : statusDone;

  // 乐观覆盖的清除时机（2026-11）：
  // - 数据已经跟上（刷新后的值与乐观值一致）→ 清掉对应那一项；
  // - 还没跟上的保留：连点两个小项时，第一项写完触发的刷新不能把第二项的勾抹掉；
  // - 这次写入整体结束（含云端上传、含失败）后再等一小会儿仍没跟上 → 兜底清掉，避免写失败后界面一直停在乐观值。
  //   不能一结束就清：本地模式下写入结束时页面的重新读取还没回来，立刻清会闪回旧状态。
  //   用版本号判断"结束的是不是最新一次点击"，先勾后取消时旧的那次结束不能清掉新的。
  const statusVersion = useRef(0);
  const itemVersions = useRef<Record<string, number>>({});
  useEffect(() => { setOptimisticDone((current) => (current !== null && current === (effectiveStatus === "done") ? null : current)); }, [effectiveStatus]);
  useEffect(() => { setOptimisticDone(null); }, [task.id]);
  useEffect(() => {
    setOptimisticItems((current) => {
      const stillPending = Object.entries(current).filter(([id, value]) => {
        const actual = task.checklistItems?.find((item) => item.id === id);
        return actual !== undefined && actual.done !== value;
      });
      return stillPending.length === Object.keys(current).length ? current : Object.fromEntries(stillPending);
    });
  }, [task.checklistItems]);

  // 操作菜单：点菜单外或按 Esc 关闭
  useEffect(() => {
    if (!menu) return;
    const closeOnOutside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(false); };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menu]);

  const handleStatusChange = (newStatus: TaskStatus) => {
    const completing = newStatus === "done";
    setOptimisticDone(completing);
    setCheckState(completing ? "checking" : "unchecking");
    setTimeout(() => setCheckState("idle"), completing ? 400 : 250);

    const version = ++statusVersion.current;
    void Promise.resolve(onStatusChange?.(task, newStatus)).catch(() => {}).finally(() => {
      setTimeout(() => { if (statusVersion.current === version) setOptimisticDone(null); }, OPTIMISTIC_FALLBACK_MS);
    });
  };

  const handleChecklistToggle = (itemId: string, wasDone: boolean) => {
    const completing = !wasDone;
    setOptimisticItems(prev => ({ ...prev, [itemId]: !wasDone }));
    setItemAnim(prev => ({ ...prev, [itemId]: wasDone ? "unchecking" : "checking" }));
    setTimeout(() => setItemAnim(prev => { const next = { ...prev }; delete next[itemId]; return next; }), wasDone ? 250 : 400);

    const version = (itemVersions.current[itemId] ?? 0) + 1;
    itemVersions.current[itemId] = version;
    void Promise.resolve(onChecklistToggle?.(task, itemId)).catch(() => {}).finally(() => {
      setTimeout(() => {
        if (itemVersions.current[itemId] !== version) return;
        setOptimisticItems((prev) => { if (!(itemId in prev)) return prev; const next = { ...prev }; delete next[itemId]; return next; });
      }, OPTIMISTIC_FALLBACK_MS);
    });
  };

  return (
    <div className={`group relative flex items-start gap-2.5 border-b border-ink/[0.07] last:border-0 hover:bg-stone-50/70 ${compact ? "px-2.5 py-2.5 sm:px-3" : "px-4 py-3"} ${done || effectiveStatus === "cancelled" ? "text-stone-400" : "text-ink"}`}>
      {weekly ? (
        <ChecklistRing completed={Math.min(weekly.progress.done, weekly.progress.target)} total={weekly.progress.target} done={weekly.progress.reached} label={`本周已做 ${weekly.progress.done}/${weekly.progress.target} ${weekly.progress.unit}`} />
      ) : ringMode ? (
        <ChecklistRing completed={completedItems} total={displayItems.length} done={done} />
      ) : (
        // 视觉 28px，点击热区 44px（负外边距抵消，不改变行内排版）
        <button aria-label={done ? "标记为未完成" : "标记为完成"} disabled={readOnly} onClick={() => handleStatusChange(done ? "todo" : "done")} className="-m-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg disabled:cursor-default">
          <span className={checkboxClass(checkState, done)}><Check className="h-4 w-4" strokeWidth={3} /></span>
        </button>
      )}

      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex min-w-0 items-start gap-2">
          <div className="min-w-0 flex-1 text-base font-semibold leading-6">
            <span className={done || effectiveStatus === "cancelled" ? "line-through" : ""}>{taskShortName(task)}</span>
            {/* 2026-11-21 用户要求去掉标题后的"写当天记录"小本子图标；以前写过的记录仍显示在标题下，可点开修改 */}
            {/* 上课时间放在名称后面（2026-11-18 用户要求），名称在前一眼先看到是什么课；窄屏放不下时整块换行 */}
            {formatTime(task) && <span className="ml-1.5 inline-block whitespace-nowrap rounded bg-ink/[0.05] px-1.5 align-top text-[13px] font-medium leading-6 tabular-nums text-muted">{formatTime(task).trim()}</span>}
          </div>
          {hasChecklist && <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] leading-6 text-muted">{!ringMode && <span className="relative h-1 w-10 overflow-hidden rounded-full bg-stone-200"><span className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all" style={{ width: `${(completedItems / displayItems.length) * 100}%` }} /></span>}<span className="tabular-nums">{completedItems}/{displayItems.length}</span></span>}
          {dueLabel && !task.rolledFromDate && <span className={`mt-0.5 inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[13px] font-semibold leading-none ${done ? "bg-stone-100 text-stone-400" : DUE_TONE[dueLabel.tone]}`}>{dueLabel.text}</span>}
          {weekly && <span className={`shrink-0 text-[13px] font-semibold leading-6 tabular-nums ${weekly.progress.reached ? "text-primary" : "text-muted"}`}>{weekly.progress.done}/{weekly.progress.target} {weekly.progress.unit}</span>}
          {weekly?.score && <span className="shrink-0 text-[13px] leading-6 tabular-nums text-muted">{weekly.score.extra && <span className="mr-1.5">{weekly.score.extra}</span>}{weekly.score.points}</span>}
          {unsynced && <UnsyncedBadge onRetry={onRetrySync} />}
        </div>
        {weekly && <WeeklyTimesBar task={task} weekly={weekly} viewDate={viewDate} />}

        {task.note && !task.overrideNote && <div className="min-w-0 truncate text-[13px] text-muted">{task.note}</div>}

        {canNote && noteEditing && (
          <input
            autoFocus
            value={noteDraft}
            maxLength={200}
            enterKeyHint="done"
            aria-label="当天记录"
            placeholder="这次具体做了什么，如：语用2篇"
            onChange={(event) => setNoteDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return; // 中文输入法选词时的回车不算保存
              if (event.key === "Enter") { event.preventDefault(); finishNote(true); }
              if (event.key === "Escape") { event.preventDefault(); finishNote(false); }
            }}
            onBlur={() => finishNote(true)}
            className="mt-1 w-full rounded-lg border border-primary/40 bg-white px-2.5 py-1.5 text-base font-normal text-ink outline-none placeholder:text-stone-400 focus:ring-2 focus:ring-primary/20"
          />
        )}
        {canNote && note && !noteEditing && (
          <button type="button" onClick={openNote} aria-label={`当天记录：${note}，点击修改`}
            className="-mx-1 mt-0.5 flex max-w-full items-start gap-1.5 rounded-md px-1 py-0.5 text-left text-[13px] leading-5 text-ink/75 hover:bg-stone-100/70 [@media(pointer:coarse)]:min-h-8">
            <NotebookPen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="min-w-0 break-words">{note}</span>
          </button>
        )}

        {/* Checklist 小项：在查看日之前就做完的收成一行"已完成 N 项"（点开可看、可取消勾选）；
            当天刚勾的仍原地划掉，让孩子看到反馈。重复任务的小项按天显示，不会有"之前做完的" */}
        {hasChecklist && collapseChecklist && !checklistOpen && (
          <button type="button" onClick={() => setChecklistOpen(true)} aria-expanded={false}
            className={`mt-1 inline-flex min-h-7 items-center gap-1 rounded-md px-2 text-[13px] font-semibold [@media(pointer:coarse)]:min-h-9 ${displayItems.length - completedItems > 0 ? "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200 hover:bg-amber-100" : "text-muted hover:bg-stone-100/70"}`}>
            {displayItems.length - completedItems > 0 ? `还有 ${displayItems.length - completedItems} 项未完成` : `${displayItems.length} 项都已完成`}
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        )}
        {hasChecklist && (!collapseChecklist || checklistOpen) && (() => {
          const rows = task.checklistItems!.map((item) => {
            const optimisticItemDone = optimisticItems[item.id] ?? item.done;
            const doneEarlier = !!viewDate && item.done && optimisticItems[item.id] !== false && (!item.completedDate || item.completedDate < viewDate);
            return { item, optimisticItemDone, doneEarlier };
          });
          const earlier = rows.filter((row) => row.doneEarlier);
          const render = ({ item, optimisticItemDone }: typeof rows[number]) => (
            <ChecklistRow
              key={item.id}
              item={{ ...item, done: optimisticItemDone }}
              animState={itemAnim[item.id] ?? "idle"}
              readOnly={readOnly}
              unsynced={unsyncedItemIds?.has(item.id)}
              onToggle={() => handleChecklistToggle(item.id, item.done)}
              onRetrySync={() => onRetryItemSync?.(item.id)}
            />
          );
          return (
            <div className="mt-1 border-l border-ink/10 pl-1.5">
              {rows.filter((row) => !row.doneEarlier).map(render)}
              {earlier.length > 0 && (
                <>
                  <button type="button" onClick={() => setShowEarlier((value) => !value)} aria-expanded={showEarlier}
                    className="flex min-h-8 w-full items-center gap-2 rounded-md px-1.5 text-left text-[13px] text-muted hover:bg-stone-100/70 [@media(pointer:coarse)]:min-h-11">
                    <Check className="h-4 w-4 text-primary" strokeWidth={3} />之前已完成 {earlier.length} 项
                    <ChevronDown className={`h-3.5 w-3.5 transition ${showEarlier ? "rotate-180" : ""}`} />
                  </button>
                  {showEarlier && earlier.map(render)}
                </>
              )}
              {collapseChecklist && (
                <button type="button" onClick={() => setChecklistOpen(false)} aria-expanded
                  className="flex min-h-8 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[13px] text-muted hover:bg-stone-100/70 [@media(pointer:coarse)]:min-h-10">
                  收起<ChevronDown className="h-3.5 w-3.5 rotate-180" />
                </button>
              )}
            </div>
          );
        })()}

        {/* 顺延/延期标注 */}
        {(task.rolledFromDate || task.occurrenceStatus === "postponed") && (
          <div className="mt-0.5 flex flex-wrap gap-2 text-[13px]">
            {task.rolledFromDate && <span className="text-amber-700">{task.timeType === "dateRange" ? "截止" : "原定"} {formatCompactDate(task.rolledFromDate)}</span>}
            {task.occurrenceStatus === "postponed" && task.overrideDate && <span className="text-violet-700">这一次改到 {formatCompactDate(task.overrideDate)}</span>}
            {task.overrideNote && <span className="text-stone-400">{task.overrideNote}</span>}
          </div>
        )}
      </div>

      {(effectiveStatus === "doing" || effectiveStatus === "cancelled") && (
        <span className={`mt-0.5 hidden shrink-0 rounded-full px-2 py-0.5 text-[13px] leading-5 sm:block ${STATUS_META[effectiveStatus].className}`}>{STATUS_META[effectiveStatus].label}</span>
      )}

      {dragHandle}
      <div ref={menuRef} className="relative">
        <button aria-label="任务操作" aria-expanded={menu} onClick={(event) => toggleMenu(event.currentTarget)} className="rounded-lg p-1.5 text-stone-400 opacity-70 hover:bg-stone-100 hover:text-ink group-hover:opacity-100 [@media(pointer:coarse)]:-m-2 [@media(pointer:coarse)]:p-3.5">
          <MoreHorizontal className="h-4 w-4" />
        </button>
        {menu && (
          <div className={`absolute right-0 ${menuAbove ? "bottom-8" : "top-8"} z-20 w-48 rounded-lg border border-ink/10 bg-white p-1.5 text-sm shadow-card`}>
            <button onClick={() => { onEdit?.(task); setMenu(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-stone-50"><Pencil className="h-4 w-4" />编辑任务</button>
            <button onClick={() => { onCopy?.(task); setMenu(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-stone-50"><Copy className="h-4 w-4" />复制到日期</button>
            {task.occurrenceDate && (
              <>
                <button onClick={() => { onOccurrencePostpone?.(task); setMenu(false); }} className="w-full rounded-lg px-3 py-2 text-left hover:bg-violet-50">这一次改到别的日子</button>
                <button onClick={() => { onOccurrenceCancel?.(task); setMenu(false); }} className="w-full rounded-lg px-3 py-2 text-left hover:bg-amber-50">这一次跳过</button>
              </>
            )}
            {onEnd && canEndRecurring(task) && effectiveStatus !== "done" && effectiveStatus !== "cancelled" && (
              <>
                <div className="my-1 border-t border-stone-100" />
                <button onClick={() => { onEnd(task); setMenu(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-amber-700 hover:bg-amber-50"><CalendarX className="h-4 w-4" />今天起不再安排</button>
              </>
            )}
            {onExtend && canExtendRecurring(task) && effectiveStatus !== "done" && effectiveStatus !== "cancelled" && (
              <>
                <div className="my-1 border-t border-stone-100" />
                <button onClick={() => { onExtend(task); setMenu(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-primary hover:bg-mint"><CalendarPlus className="h-4 w-4" />继续安排</button>
              </>
            )}
            <button onClick={() => { onDelete?.(task); setMenu(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" />删除任务</button>
          </div>
        )}
      </div>
    </div>
  );
}

function ChecklistRow({ item, animState, readOnly, unsynced, onToggle, onRetrySync }: {
  item: ChecklistItem;
  animState: AnimState;
  readOnly?: boolean;
  unsynced?: boolean;
  onToggle: () => void;
  onRetrySync?: () => void;
}) {
  return (
    <div className={`flex items-center gap-1 ${item.done ? "text-stone-400" : "text-stone-600"}`}>
      {/* 整行可点；触屏上行高 44px，鼠标设备保持紧凑 */}
      <button type="button" role="checkbox" aria-checked={item.done} disabled={readOnly} onClick={onToggle} className="flex min-h-8 min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 py-1 text-left hover:bg-stone-100/70 disabled:cursor-default disabled:hover:bg-transparent [@media(pointer:coarse)]:min-h-11">
        <span className={checkboxClass(animState, item.done, "sm")}><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>
        <span className={`min-w-0 flex-1 text-[15px] leading-6 ${item.done ? "line-through" : ""}`}>{item.title}</span>
      </button>
      {unsynced && <UnsyncedBadge onRetry={onRetrySync} />}
    </div>
  );
}

function formatTime(task: TaskDisplay) {
  const start = task.startTime ?? task.time;
  if (!start) return "";
  return `${start}${task.endTime ? `-${task.endTime}` : ""}`;
}

const WEEKDAY_SHORT = ["一", "二", "三", "四", "五", "六", "日"];

/** 每周几次：一周七天的圆点，点哪天记哪天（以前的日子就是补记；今天以后、任务结束以后的点不了）。
 *  2026-11-17 用户反馈定稿：
 *  - 左键 / 轻点：没记 → 打 ✓（记 1 份）；记了 1 份 → 取消；记了好几份 → 打开填数（不一下清掉好几本）。
 *  - 右键 / 长按：圆点下弹出小输入框，填这天做了几本 / 几篇，回车或点别处保存，填 0 清掉。
 *  - 做了 1 份显示 ✓，好几份显示数字；查看的那天加浅色外圈。不放加减按钮、不写说明文字。
 *  - 不限制在任务开始日之后：每周几次按整周算，今天刚改成每周几次的也能给本周一补记。 */
function WeeklyTimesBar({ task, weekly, viewDate }: { task: TaskDisplay; weekly: NonNullable<Props["weekly"]>; viewDate?: string }) {
  const { progress, onLog } = weekly;
  const today = todayKey();
  // 今天以后、任务结束以后的点不了；以前的日子只有 Mac 上能补记（iPad / 手机上只能记今天）
  const loggable = (date: string) => date <= today && (weekly.allowPast !== false || date === today) && (!task.endDate || date <= task.endDate);
  const [editing, setEditing] = useState<string>();
  // 今天打勾得分时屏幕正中弹出大大的"➕2 分"，约 1.5 秒自己消失（不用点，docs/TASK_09_points.md §10）
  const [floats, setFloats] = useState<{ id: number; gain: number }[]>([]);
  const floatId = useRef(0);
  const log = (date: string, delta: number) => {
    const gain = delta > 0 && date === today ? weekly.gainFor?.(date, delta) ?? 0 : 0;
    onLog(date, delta);
    if (gain > 0) {
      const id = ++floatId.current;
      setFloats((current) => [...current, { id, gain }]);
      setTimeout(() => setFloats((current) => current.filter((item) => item.id !== id)), 1600);
    }
  };
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const clearPress = () => { if (pressTimer.current) clearTimeout(pressTimer.current); pressTimer.current = null; };
  useEffect(() => clearPress, []);
  const lastFloat = floats[floats.length - 1];
  return (
    <ol className="mt-1 flex items-center gap-1" aria-label="本周每天的记录">
      {lastFloat && createPortal(
        <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center">
          <div key={lastFloat.id} role="status" aria-label={`加 ${lastFloat.gain} 分`} data-testid="points-float"
            className="flex items-center gap-2 rounded-3xl bg-white/95 px-8 py-5 text-primary shadow-2xl ring-1 ring-primary/15"
            style={{ animation: "points-float 1500ms ease-out forwards" }}>
            <span aria-hidden="true" className="text-5xl leading-none">➕</span>
            <span aria-hidden="true" className="text-6xl font-extrabold leading-none tabular-nums">{lastFloat.gain}</span>
            <span aria-hidden="true" className="self-end pb-1 text-3xl font-bold leading-none">分</span>
          </div>
        </div>,
        document.body,
      )}
      {progress.days.map((day, index) => {
        const can = loggable(day.date);
        const name = `周${WEEKDAY_SHORT[index]}`;
        const state = day.count ? `做了 ${day.count} ${progress.unit}` : "没做";
        const tone = day.count ? "bg-primary text-white hover:bg-primary/85" : can ? "bg-stone-100 text-stone-500 hover:bg-primary/10 hover:text-primary" : "bg-stone-50 text-stone-300";
        return (
          <li key={day.date} className="relative">
            <button type="button" disabled={!can} aria-label={`${name}${state}`} aria-pressed={day.count > 0} aria-haspopup="dialog"
              title={can ? `${name}${state}｜点一下打勾，右键（长按）填数量` : name}
              onClick={() => {
                if (longPressed.current) { longPressed.current = false; return; }
                if (day.count > 1) setEditing(day.date);
                else log(day.date, day.count ? -1 : 1);
              }}
              onContextMenu={(event) => { event.preventDefault(); if (can) setEditing(day.date); }}
              onPointerDown={(event) => {
                if (event.pointerType === "mouse" || !can) return;
                longPressed.current = false;
                clearPress();
                pressTimer.current = setTimeout(() => { longPressed.current = true; setEditing(day.date); }, 500);
              }}
              onPointerUp={clearPress} onPointerLeave={clearPress} onPointerCancel={clearPress}
              className={`flex h-7 w-7 select-none items-center justify-center rounded-full text-[12px] font-semibold tabular-nums transition-colors [-webkit-touch-callout:none] disabled:cursor-default [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8 ${tone} ${day.date === viewDate ? "ring-2 ring-primary/35 ring-offset-1" : ""}`}>
              {day.count > 1 ? day.count : day.count === 1 ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : WEEKDAY_SHORT[index]}
            </button>
            {editing === day.date && (
              <DayCountEditor label={`${name}做了几${progress.unit}`} initial={day.count} unit={progress.unit}
                onClose={(value) => {
                  setEditing(undefined);
                  if (value !== undefined && value !== day.count) log(day.date, value - day.count);
                }} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** 圆点下的小输入框：填这天做了几份。回车 / ✓ / 点别处保存，Esc 取消；0 = 清掉这天 */
function DayCountEditor({ label, initial, unit, onClose }: { label: string; initial: number; unit: string; onClose: (value?: number) => void }) {
  const [text, setText] = useState(initial ? String(initial) : "");
  const closed = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);
  const finish = (save: boolean) => {
    if (closed.current) return;
    closed.current = true;
    const value = Math.round(Number(text || 0));
    onClose(save && Number.isFinite(value) ? Math.min(WEEKLY_LOG_DAY_MAX, Math.max(0, value)) : undefined);
  };
  return (
    <div role="dialog" aria-label={label} className="absolute left-1/2 top-full z-30 mt-1.5 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-ink/10 bg-white p-1 shadow-lg">
      <input ref={inputRef} type="number" inputMode="numeric" min={0} max={WEEKLY_LOG_DAY_MAX} value={text} aria-label={label}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") { event.preventDefault(); finish(true); }
          if (event.key === "Escape") { event.preventDefault(); finish(false); }
        }}
        onBlur={() => finish(true)}
        className="h-8 w-12 rounded-md border border-ink/15 px-1 text-center text-[15px] font-semibold tabular-nums text-ink outline-none focus:border-primary [@media(pointer:coarse)]:h-10 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
      <span className="text-[13px] text-muted">{unit}</span>
      <button type="button" aria-label="保存" onPointerDown={(event) => event.preventDefault()} onClick={() => finish(true)}
        className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-white [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10">
        <Check className="h-4 w-4" strokeWidth={3} />
      </button>
    </div>
  );
}
