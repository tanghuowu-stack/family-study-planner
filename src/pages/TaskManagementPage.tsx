import { CalendarPlus, CalendarX, ChevronDown, Copy, GripVertical, MoreHorizontal, Pencil, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { taskRepository } from "../data/taskRepository";
import { getRepository } from "../data/repositoryProvider";
import { loadCustomTaskCategories, type CustomTaskCategories } from "../data/appSettingsRepository";
import type { Course, CourseStatus, ExtraContentType, MainCategory, PlanPeriod, Task } from "../types/task";
import { fmtDate, formatSpecificDates, getWeekEndKey, todayKey } from "../utils/date";
import { COURSE_MAIN_OPTIONS, COURSE_STATUS_META, MAIN_CATEGORY_META, SUB_CATEGORY_OPTIONS, WEEKDAY_LABELS, canEndRecurring, canExtendRecurring, interestContentType, isEndedRecurring, isValidSubCategory, subCategoryLabel, taskShortName, checklistOnDay, isOccurrenceSchedule } from "../utils/taskMeta";
import { taskSubjectGroup } from "../utils/taskGrouping";
import { GroupHeading, SUBJECT_DOT } from "../components/GroupHeading";
import { useSortableList } from "../hooks/useSortableList";

interface Props { refreshKey: number; onRefresh: () => void; notify: (text: string) => void; onEdit: (task: Task) => void; onDelete: (task: Task) => void; onEnd: (task: Task) => void; onExtend: (task: Task) => void; onCopy: (task: Task) => void; }
const order: MainCategory[] = ["school", "extraHomework", "interestClass", "temporary"];

type KindFilter = "all" | "repeat" | "weekly" | "range" | "once";
const KIND_LABEL: Record<Exclude<KindFilter, "all">, string> = { repeat: "重复", weekly: "每周几次", range: "时段", once: "单日" };
/** 任务按"怎么安排"分四类：筛选条和每行右侧的类型标签共用 */
const kindOf = (task: Task): Exclude<KindFilter, "all"> =>
  task.timeType === "weeklyTimes" ? "weekly"
    : task.timeType === "recurring" ? "repeat"
      : ["dateRange", "assignmentWindow", "weekGoal"].includes(task.timeType) ? "range" : "once";
type CategoryFilter = "all" | MainCategory;

/**
 * 任务管理（2026-11-18 重新整理，用户反馈"很乱，找任务找不到；有的有手柄有的没有"）：
 * - 顶部搜索框（按名称找，连已结束 / 已完成里的一起找）+ 平时 / 假期 + 按安排方式筛选（重复 / 每周几次 / 时段 / 单日）。
 * - 大类（学校作业 / 课外 / 兴趣班 / 其他安排）下按学科（或兴趣项目）分组，课外不再拆"上课 / 作业"两组，碎组少了。
 * - 每行：名称 + 上课时间（名称后面），第二行是安排说明和小项进度，右侧拖动手柄、"…"。
 * - 2026-11-19：筛选多一排按分类（学校作业 / 课外班 / 兴趣班 / 其他安排）；行右侧的彩色类型标签去掉（安排说明里已写，看着乱）。
 * - 拖动手柄只在电脑上有（手机、iPad 不显示）；能排序的区域里每行都留出手柄位置（只有一条的组放占位），列对齐。
 *   搜索或筛选时不能排序（只拖一部分会把整组顺序写乱）。
 */
export function TaskManagementPage(props: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [periods, setPeriods] = useState<PlanPeriod[]>([]);
  // 筛选只留 全部 / 平时 / 假期；没手动选过时跟随当前阶段（假期中默认"假期"，否则"平时"）
  const [filterChoice, setFilterChoice] = useState<"all" | "regular" | "holiday" | null>(null);
  const [kind, setKind] = useState<KindFilter>("all");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 批量管理：平时不显示勾选框（容易和今日页的"完成"勾选框混淆），点"批量管理"才出现
  const [selecting, setSelecting] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [showAllDone, setShowAllDone] = useState(false);
  const [showEnded, setShowEnded] = useState(false);
  const reload = () => Promise.all([taskRepository.listAll(), taskRepository.listPlanPeriods()]).then(([items, stages]) => { setTasks(items); setPeriods(stages); setSelected(new Set()); });
  useEffect(() => { reload(); }, [props.refreshKey]);
  const holidays = periods.filter((period) => period.type === "holiday");
  const currentHoliday = holidays.find((period) => period.isActive && todayKey() >= period.startDate && todayKey() <= period.endDate);
  const currentPhase: "regular" | "holiday" = currentHoliday ? "holiday" : "regular";
  const filter = filterChoice ?? currentPhase;
  const keyword = query.trim().toLowerCase();
  const searching = keyword.length > 0;
  const phaseFiltered = useMemo(() => tasks.filter((task) => {
    const boundHoliday = !!task.planPeriodId && holidays.some((period) => period.id === task.planPeriodId);
    if (filter === "all") return true;
    if (filter === "regular") return !boundHoliday;
    return boundHoliday;
  }), [tasks, periods, filter]);
  const matchesKeyword = (task: Task) => !searching || taskShortName(task).toLowerCase().includes(keyword) || task.title.toLowerCase().includes(keyword) || (task.note ?? "").toLowerCase().includes(keyword);
  const inCategory = (task: Task) => category === "all" || task.mainCategory === category;
  const filtered = phaseFiltered.filter((task) => inCategory(task) && (kind === "all" || kindOf(task) === kind) && matchesKeyword(task));
  const shownOrder = category === "all" ? order : order.filter((value) => value === category);
  const notFinished = filtered.filter((task) => !["done", "cancelled"].includes(task.status));
  // 「结束」≠「完成」：结束只改 recurrence.endDate，occurrence 类任务本体 status 按 R1 恒为
  // todo/cancelled，永远进不了"已完成"分组——不单独摘出来会一直卡在待办列表里（2026-07-20 用户反馈）
  const pending = notFinished.filter((task) => !isEndedRecurring(task));
  const ended = notFinished.filter((task) => isEndedRecurring(task));
  const completed = filtered.filter((task) => ["done", "cancelled"].includes(task.status));
  const completedCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const recentCompleted = completed.filter((task) => (task.completedAt ?? task.updatedAt) >= completedCutoff);
  const visibleCompleted = showAllDone || searching ? completed : recentCompleted;
  const earlierCompletedCount = completed.length - recentCompleted.length;
  const active = phaseFiltered.filter((task) => !["done", "cancelled"].includes(task.status) && !isEndedRecurring(task) && matchesKeyword(task));
  const categoryCounts = active.filter((task) => kind === "all" || kindOf(task) === kind)
    .reduce((counts, task) => { counts[task.mainCategory] = (counts[task.mainCategory] ?? 0) + 1; counts.all += 1; return counts; }, { all: 0 } as Partial<Record<CategoryFilter, number>> & { all: number });
  const kindCounts = active.filter(inCategory)
    .reduce((counts, task) => { counts[kindOf(task)] += 1; counts.all += 1; return counts; }, { all: 0, repeat: 0, weekly: 0, range: 0, once: 0 } as Record<KindFilter, number>);
  const canReorder = !selecting && !searching && kind === "all";
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const selectIds = (ids: string[]) => setSelected((current) => { const next = new Set(current); const all = ids.every((id) => next.has(id)); ids.forEach((id) => all ? next.delete(id) : next.add(id)); return next; });
  const batchDelete = async () => {
    if (!selected.size || !confirm(`确定删除已选的 ${selected.size} 项任务吗？任务会保留在本地记录中。`)) return;
    const count = await getRepository().batchRemove([...selected]);
    await reload(); setSelecting(false); props.onRefresh(); props.notify(`已删除 ${count} 项任务`);
  };
  const reorder = async (ids: string[]) => { await getRepository().reorderTasks(ids); await reload(); props.onRefresh(); };
  const groupProps = { selected, selecting, onToggle: toggle, onSelectGroup: selectIds, ...props };
  const chip = (active: boolean) => `inline-flex min-h-8 items-center gap-1 rounded-full px-3 text-[13px] font-semibold transition-colors ${active ? "bg-ink text-white" : "bg-white text-muted ring-1 ring-inset ring-ink/10 hover:text-ink"}`;
  return <main className="task-management mx-auto w-full max-w-4xl xl:max-w-6xl px-3 pb-content pt-4 sm:px-7 sm:pt-6 lg:px-10">
    <header className="page-header"><h1 className="page-title shrink-0">任务管理</h1>{selecting
      ? <div className="flex items-center gap-2"><button onClick={batchDelete} disabled={!selected.size} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-rose-600 px-3 text-sm font-semibold text-white disabled:opacity-40 sm:px-4"><Trash2 className="h-4 w-4" />删除{selected.size ? `（${selected.size}）` : ""}</button><button onClick={() => { setSelecting(false); setSelected(new Set()); }} className="min-h-10 rounded-lg border border-ink/10 bg-white px-3 text-sm font-semibold text-ink sm:px-4">完成</button></div>
      : <button onClick={() => setSelecting(true)} className="min-h-10 rounded-lg border border-ink/10 bg-white px-3 text-sm font-semibold text-muted hover:text-ink sm:px-4">批量管理</button>}</header>
    {selecting && <p className="-mt-2 mb-3 text-[13px] text-muted">点任务选中，可以按组全选，再点"删除"。</p>}
    <div className="mb-5 space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative block min-w-0 flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务名称" aria-label="搜索任务"
            className="h-10 w-full rounded-lg border border-ink/10 bg-white pl-9 pr-9 text-[15px] text-ink outline-none placeholder:text-stone-400 focus:border-primary/50 [&::-webkit-search-cancel-button]:hidden" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="清空搜索" className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-ink"><X className="h-4 w-4" /></button>}
        </label>
        <div className="inline-flex shrink-0 self-start rounded-lg bg-stone-100 p-0.5 sm:self-auto" role="tablist" aria-label="平时 / 假期">
          {(["regular", "holiday", "all"] as const).map((value) => <button key={value} role="tab" aria-selected={filter === value} onClick={() => setFilterChoice(value)}
            className={`min-h-9 rounded-md px-3 text-[13px] font-semibold ${filter === value ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"}`}>
            {{ all: "全部", regular: "平时", holiday: "假期" }[value]}{value === currentPhase && filter !== value ? <span className="ml-1 font-medium text-stone-400">·当前</span> : ""}
          </button>)}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="按分类筛选">
        {(["all", ...order] as const).map((value) => <button key={value} onClick={() => setCategory(value)} aria-pressed={category === value} className={chip(category === value)}>
          {value === "all" ? "全部分类" : MAIN_CATEGORY_META[value].label}<span className={`tabular-nums ${category === value ? "text-white/70" : "text-stone-400"}`}>{categoryCounts[value] ?? 0}</span>
        </button>)}
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="按安排方式筛选">
        {(["all", "repeat", "weekly", "range", "once"] as const).map((value) => <button key={value} onClick={() => setKind(value)} aria-pressed={kind === value} className={chip(kind === value)}>
          {value === "all" ? "全部安排" : KIND_LABEL[value]}<span className={`tabular-nums ${kind === value ? "text-white/70" : "text-stone-400"}`}>{kindCounts[value]}</span>
        </button>)}
      </div>
    </div>
    {pending.length === 0 && ended.length === 0 && completed.length === 0
      ? <p className="surface px-4 py-8 text-center text-[15px] text-muted">{searching ? `没有找到“${query.trim()}”` : "这里还没有任务"}</p>
      : <div className="space-y-5">{shownOrder.map((category) => <TaskGroup key={category} category={category} reorderable={canReorder} onReorder={reorder} tasks={pending.filter((task) => task.mainCategory === category)} {...groupProps} />)}</div>}
    {ended.length > 0 && <section className="mt-6 rounded-lg border border-stone-100 bg-white p-3 opacity-75 shadow-card"><button onClick={() => setShowEnded(!showEnded)} className="flex w-full items-center justify-between px-1 py-2 text-sm font-semibold text-stone-500">已结束的重复任务 · {ended.length}<ChevronDown className={`h-4 w-4 transition ${showEnded || searching ? "rotate-180" : ""}`} /></button>{(showEnded || searching) && <div className="mt-2 space-y-4">{shownOrder.map((category) => <TaskGroup key={category} category={category} tasks={ended.filter((task) => task.mainCategory === category)} {...groupProps} />)}</div>}</section>}
    {completed.length > 0 && <section className="mt-6 rounded-lg border border-stone-100 bg-white p-3 opacity-75 shadow-card"><button onClick={() => setShowDone(!showDone)} className="flex w-full items-center justify-between px-1 py-2 text-sm font-semibold text-stone-500">已完成任务 · {visibleCompleted.length}{!showAllDone && !searching && earlierCompletedCount > 0 ? `（另有 ${earlierCompletedCount} 项更早记录）` : ""}<ChevronDown className={`h-4 w-4 transition ${showDone || searching ? "rotate-180" : ""}`} /></button>{(showDone || searching) && <div className="mt-2 space-y-4">{shownOrder.map((category) => <TaskGroup key={category} category={category} tasks={visibleCompleted.filter((task) => task.mainCategory === category)} {...groupProps} />)}{!searching && earlierCompletedCount > 0 && <button onClick={() => setShowAllDone(!showAllDone)} className="mx-auto block rounded-lg border px-4 py-2 text-[13px] font-semibold text-stone-500">{showAllDone ? "只显示最近 30 天" : "显示更早已完成任务"}</button>}</div>}</section>}
  </main>;
}

// 子分组内手动顺序：与今日页 taskSort 的组内规则一致（sortOrder → createdAt），拖拽后两处顺序同步
const manualOrder = (a: Task, b: Task) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || a.createdAt.localeCompare(b.createdAt);

type GroupProps = Props & { selected: Set<string>; selecting: boolean; onToggle: (id: string) => void; onSelectGroup: (ids: string[]) => void };

function TaskGroup({ category, tasks, selected, selecting, onToggle, onSelectGroup, reorderable, onReorder, ...props }: GroupProps & { category: MainCategory; tasks: Task[]; reorderable?: boolean; onReorder?: (ids: string[]) => Promise<void> }) {
  if (!tasks.length) return null;
  const standardOptions = SUB_CATEGORY_OPTIONS[category];
  const subgroupOptions = category === "temporary" ? ["travel", "leisure", "examCompetition", "other"].map((value) => standardOptions.find((option) => option.value === value)!).filter(Boolean) : standardOptions;
  const knownValues = new Set(subgroupOptions.map((option) => option.value));
  const customValues = [...new Set(tasks.filter((task) => !knownValues.has(task.subCategory)).map((task) => task.subCategory))];
  // 按学科（兴趣班按项目、其他安排按类型）分组；课外的上课和作业放同一组，有时间的课排在前面
  const groups = [
    ...subgroupOptions.map((option) => ({ value: option.value, label: option.label })),
    ...customValues.map((value) => ({ value, label: subCategoryLabel(category, value) })),
  ].map((group) => ({ ...group, tasks: tasks.filter((task) => task.subCategory === group.value) })).filter((group) => group.tasks.length);
  return <section className="surface overflow-visible"><header className="flex items-center gap-2 rounded-t-lg border-b border-ink/10 bg-white px-4 py-3"><h2 className="text-base font-bold text-ink">{MAIN_CATEGORY_META[category].label}</h2><span className="text-[13px] tabular-nums text-muted">{tasks.length}</span>{selecting && <button onClick={() => onSelectGroup(tasks.map((task) => task.id))} className="ml-auto min-h-9 text-[13px] font-semibold text-primary">{tasks.every((task) => selected.has(task.id)) ? "取消本组" : "全选本组"}</button>}</header><div className="divide-y divide-ink/[0.07]">{groups.map((subgroup) => <SortableSubgroup key={subgroup.value} label={subgroup.label} tasks={subgroup.tasks} reorderable={reorderable} onReorder={onReorder} renderRow={(task, dragHandle) => <TaskRow key={task.id} task={task} selected={selected.has(task.id)} selecting={selecting} onToggle={() => onToggle(task.id)} dragHandle={dragHandle} {...props} />} />)}</div></section>;
}

// 组内拖拽排序（与今日页同一套 useSortableList：只从手柄拖、其他行实时让位、松手立即生效）。
// 手柄只在电脑（精确指针）上显示；能排序的区域里只有一条的组放同宽占位，保证每行右侧对齐
const HANDLE_SLOT = "hidden h-9 w-8 shrink-0 [@media(pointer:fine)]:flex";
function SortableSubgroup({ label, tasks, reorderable, onReorder, renderRow }: { label: string; tasks: Task[]; reorderable?: boolean; onReorder?: (ids: string[]) => Promise<void>; renderRow: (task: Task, dragHandle?: ReactNode) => ReactNode }) {
  const timedFirst = (a: Task, b: Task) => Number(!(a.startTime ?? a.time)) - Number(!(b.startTime ?? b.time));
  const ordered = [...tasks].sort((a, b) => timedFirst(a, b) || manualOrder(a, b));
  const canSort = !!reorderable && !!onReorder && ordered.length > 1;
  const list = useSortableList(ordered.map((task) => task.id), (ids) => onReorder?.(ids), canSort);
  const byId = new Map(ordered.map((task) => [task.id, task]));
  return <section className="overflow-visible"><GroupHeading label={label} dot={SUBJECT_DOT[taskSubjectGroup(tasks[0])]} count={tasks.length} />{list.order.map((id) => {
    const task = byId.get(id);
    if (!task) return null;
    if (!canSort) return <div key={id}>{renderRow(task, reorderable ? <span aria-hidden className={HANDLE_SLOT} /> : undefined)}</div>;
    const item = list.itemProps(id);
    const handle = (
      <button type="button" aria-label={`拖动调整“${task.title || "这项任务"}”的顺序`} title="按住拖动调整顺序" {...list.handleProps(id)}
        className={`${HANDLE_SLOT} items-center justify-center rounded-md text-stone-300 hover:bg-stone-100 hover:text-muted`}>
        <GripVertical aria-hidden className="h-4 w-4" />
      </button>
    );
    return <div key={id} ref={item.ref} style={item.style}>{renderRow(task, handle)}</div>;
  })}</section>;
}

function TaskRow({ task, selected, selecting, onToggle, onCopy, onEdit, onDelete, onEnd, onExtend, dragHandle }: Props & { task: Task; selected: boolean; selecting: boolean; onToggle: () => void; dragHandle?: ReactNode }) {
  const [menu, setMenu] = useState(false);
  const [menuAbove, setMenuAbove] = useState(false);
  const finished = ["done", "cancelled"].includes(task.status);
  // 重复任务的小项按天算，这里显示今天的进度
  const shownItems = isOccurrenceSchedule(task) ? checklistOnDay(task.checklistItems, todayKey()) : task.checklistItems;
  const checklist = shownItems?.length ? ` · 小项${isOccurrenceSchedule(task) ? "（今天）" : ""} ${shownItems.filter((item) => item.done).length}/${shownItems.length}` : "";
  const toggleMenu = (button: HTMLButtonElement) => {
    if (!menu) {
      const bounds = button.getBoundingClientRect();
      const spaceBelow = window.innerHeight - bounds.bottom;
      setMenuAbove(spaceBelow < 220 && bounds.top > spaceBelow);
    }
    setMenu(!menu);
  };
  return <div onClick={selecting ? onToggle : undefined} className={`relative ${menu ? "z-40" : ""} flex items-center gap-2.5 px-3 py-2.5 sm:px-4 ${selecting ? "cursor-pointer" : ""} ${selected ? "bg-mint/50" : finished ? "bg-stone-50/40 text-stone-400" : "bg-white"}`}>
    {selecting && <input type="checkbox" checked={selected} onChange={onToggle} onClick={(event) => event.stopPropagation()} aria-label={`选择 ${task.title}`} className="h-5 w-5 shrink-0 rounded accent-primary" />}
    <div className="min-w-0 flex-1">
      <p className="flex min-w-0 items-center gap-2"><span className={`min-w-0 truncate text-base font-semibold leading-6 ${finished ? "line-through" : "text-ink"}`}>{taskShortName(task)}</span>{formatTime(task) && <span className="shrink-0 rounded bg-ink/[0.05] px-1.5 text-[13px] font-medium leading-6 tabular-nums text-muted">{formatTime(task)}</span>}</p>
      <p className="truncate text-[13px] text-muted">{timeLabel(task)}{checklist}</p>
    </div>
    {!selecting && dragHandle}
    {!selecting && <div className="relative"><button onClick={(event) => toggleMenu(event.currentTarget)} aria-label="任务操作" className="rounded-lg p-2 text-muted hover:bg-stone-100 hover:text-ink"><MoreHorizontal className="h-4 w-4" /></button>{menu && <div className={`absolute right-0 ${menuAbove ? "bottom-9" : "top-9"} z-50 max-h-[calc(100dvh-6rem)] w-48 overflow-y-auto rounded-lg border border-ink/10 bg-white p-1.5 text-sm text-ink shadow-card`}><button onClick={() => { onCopy(task); setMenu(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 hover:bg-stone-50"><Copy className="h-4 w-4" />复制</button><button onClick={() => { onEdit(task); setMenu(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 hover:bg-stone-50"><Pencil className="h-4 w-4" />编辑</button>{canEndRecurring(task) && !finished && <button onClick={() => { onEnd(task); setMenu(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-amber-700 hover:bg-amber-50"><CalendarX className="h-4 w-4" />今天起不再安排</button>}{canExtendRecurring(task) && !finished && <button onClick={() => { onExtend(task); setMenu(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-primary hover:bg-mint"><CalendarPlus className="h-4 w-4" />继续安排</button>}<button onClick={() => { onDelete(task); setMenu(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" />删除</button></div>}</div>}
  </div>;
}

export function PlanPeriodManager({ periods, currentHoliday, onChanged, notify, embedded = false }: { periods: PlanPeriod[]; currentHoliday?: PlanPeriod; onChanged: () => void; notify: (text: string) => void; embedded?: boolean }) {
  const [open, setOpen] = useState(embedded);
  const [draft, setDraft] = useState({ name: "", startDate: todayKey(), endDate: todayKey() });
  // 修改已有假期：把它填进上面同一行输入框里改（原先是三个浏览器弹框手输 YYYY-MM-DD）
  const [editingId, setEditingId] = useState<string | null>(null);
  const saveEdit = async () => { if (!editingId) return; if (!draft.name.trim() || !draft.startDate || !draft.endDate || draft.startDate > draft.endDate) return notify("请填写正确的假期名称和日期"); await getRepository().updatePlanPeriod(editingId, { name: draft.name.trim(), startDate: draft.startDate, endDate: draft.endDate }); setEditingId(null); setDraft({ name: "", startDate: todayKey(), endDate: todayKey() }); onChanged(); notify("假期已修改"); };
  const cancelEdit = () => { setEditingId(null); setDraft({ name: "", startDate: todayKey(), endDate: todayKey() }); };
  const add = async () => { if (!draft.name.trim() || draft.startDate > draft.endDate) return notify("请填写正确的假期名称和日期"); await getRepository().createPlanPeriod({ ...draft, type: "holiday", name: draft.name.trim(), isActive: true }); setDraft({ ...draft, name: "" }); onChanged(); notify("假期已添加"); };
  return <section className={embedded ? "" : "rounded-2xl border border-stone-100 bg-white p-4 shadow-sm"}><div className={embedded ? "hidden" : "flex items-center justify-between"}><div><h2 className="font-semibold">假期设置</h2><p className="mt-1 text-[13px] text-stone-400">当前：{currentHoliday?.name ?? "平时"}；只需维护假期，其他日期自动视为平时</p></div><button onClick={() => setOpen(!open)} className="rounded-lg bg-sage-50 px-3 py-1.5 text-[13px] font-medium text-sage-700">{open ? "收起" : "管理假期"}</button></div>{open && <div className="mt-4"><div className="grid gap-2 sm:grid-cols-4"><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="例如：2026暑假" className="rounded-lg border px-3 py-2 text-sm" /><input type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} className="rounded-lg border px-2 py-2 text-sm" /><input type="date" value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} className="rounded-lg border px-2 py-2 text-sm" />{editingId ? <div className="flex gap-2"><button onClick={saveEdit} className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white">保存修改</button><button onClick={cancelEdit} className="rounded-lg border px-3 py-2 text-sm text-muted">取消</button></div> : <button onClick={add} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white">添加假期</button>}</div><div className="mt-3 space-y-2">{periods.map((period) => <div key={period.id} className="flex items-center gap-3 rounded-lg bg-stone-50 px-3 py-2 text-[13px]"><span className="font-medium">{period.name}</span><span className="text-stone-400">{period.startDate} 至 {period.endDate}</span><button onClick={async () => { await getRepository().updatePlanPeriod(period.id, { isActive: !period.isActive }); onChanged(); }} className={`ml-auto rounded-full px-2 py-0.5 ${period.isActive ? "bg-stone-200 text-stone-500" : "bg-emerald-50 text-emerald-700"}`}>{period.isActive ? "停用" : "启用"}</button><button onClick={() => { setEditingId(period.id); setDraft({ name: period.name, startDate: period.startDate, endDate: period.endDate }); }} className={editingId === period.id ? "font-semibold text-primary" : "text-sage-700"}>{editingId === period.id ? "修改中" : "修改"}</button><button onClick={async () => { if (!confirm(`删除假期“${period.name}”？关联任务会改为全部阶段。`)) return; await getRepository().removePlanPeriod(period.id); onChanged(); }} className="text-rose-500">删除</button></div>)}</div></div>}</section>;
}

type CourseDraft = {
  name: string; mainCategory: MainCategory; subCategory: string; isClass: boolean;
  status: CourseStatus; startDate: string; endDate: string; weekdays: number[]; startTime: string; endTime: string;
};
const emptyCourseDraft = (): CourseDraft => ({ name: "", mainCategory: "extraHomework", subCategory: "chinese", isClass: true, status: "active", startDate: "", endDate: "", weekdays: [], startTime: "", endTime: "" });

export function CourseManager({ courses, onChanged, notify, embedded = false }: { courses: Course[]; onChanged: () => void; notify: (text: string) => void; embedded?: boolean }) {
  const [open, setOpen] = useState(embedded);
  const [draft, setDraft] = useState<CourseDraft>(emptyCourseDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [customCategories, setCustomCategories] = useState<CustomTaskCategories>({});
  useEffect(() => { if (open) void loadCustomTaskCategories().then(setCustomCategories); }, [open]);
  const subOptions = [...SUB_CATEGORY_OPTIONS[draft.mainCategory], ...(draft.mainCategory === "readingPlan" ? [] : customCategories[draft.mainCategory] ?? [])];
  if (draft.subCategory && !subOptions.some((item) => item.value === draft.subCategory)) {
    subOptions.push({ value: draft.subCategory, label: subCategoryLabel(draft.mainCategory, draft.subCategory) });
  }
  const set = <K extends keyof CourseDraft>(key: K, value: CourseDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const reset = () => { setDraft(emptyCourseDraft()); setEditingId(null); };
  // 切换分类后二级类型置空、必须手动选：不能静默落到第一项（曾把"跳绳课"默默存成"兴趣班·钢琴课"）
  const changeMain = (mainCategory: MainCategory) => setDraft((current) => ({ ...current, mainCategory, subCategory: "" }));
  const toggleDay = (day: number) => setDraft((current) => ({ ...current, weekdays: current.weekdays.includes(day) ? current.weekdays.filter((d) => d !== day) : [...current.weekdays, day] }));

  const buildInput = (d: CourseDraft) => ({
    name: d.name.trim(), mainCategory: d.mainCategory, subCategory: d.subCategory,
    extraContentType: (d.mainCategory === "extraHomework" ? (d.isClass ? "class" : "homework") : d.mainCategory === "interestClass" ? interestContentType(d.isClass) : undefined) as ExtraContentType | undefined,
    isClass: d.isClass, status: d.status,
    startDate: d.startDate || undefined, endDate: d.endDate || undefined,
    schedule: (d.weekdays.length || d.startTime || d.endTime) ? { weekdays: d.weekdays.length ? d.weekdays : undefined, startTime: d.startTime || undefined, endTime: d.endTime || undefined } : undefined,
    sortOrder: courses.length,
  });

  const save = async () => {
    if (!draft.name.trim()) return notify("请填写课程名称");
    if (!isValidSubCategory(draft.mainCategory, draft.subCategory)) return notify("请选择二级类型");
    if (draft.startDate && draft.endDate && draft.startDate > draft.endDate) return notify("起止日期不正确");
    if (editingId) { const { sortOrder: _s, ...changes } = buildInput(draft); await getRepository().updateCourse(editingId, changes); notify("课程已更新"); }
    else { await getRepository().createCourse(buildInput(draft)); notify("课程已添加"); }
    reset(); onChanged();
  };
  const startEdit = (course: Course) => {
    setEditingId(course.id);
    setDraft({ name: course.name, mainCategory: course.mainCategory, subCategory: course.subCategory, isClass: course.isClass, status: course.status, startDate: course.startDate ?? "", endDate: course.endDate ?? "", weekdays: course.schedule?.weekdays ?? [], startTime: course.schedule?.startTime ?? "", endTime: course.schedule?.endTime ?? "" });
    setOpen(true);
  };
  const cycleStatus = async (course: Course) => {
    const next: Record<CourseStatus, CourseStatus> = { active: "ended", ended: "planned", planned: "active" };
    await getRepository().updateCourse(course.id, { status: next[course.status] }); onChanged();
  };
  const remove = async (course: Course) => { if (!confirm(`删除课程“${course.name}”？历史任务保留，仅解除课程绑定。`)) return; await getRepository().removeCourse(course.id); if (editingId === course.id) reset(); onChanged(); };

  const grouped = COURSE_MAIN_OPTIONS.map((opt) => ({ ...opt, items: courses.filter((c) => c.mainCategory === opt.value) })).filter((g) => g.items.length);
  const field = "rounded-lg border px-3 py-2 text-sm";

  return <section className={embedded ? "" : "rounded-2xl border border-stone-100 bg-white p-4 shadow-sm"}>
    <div className={embedded ? "hidden" : "flex items-center justify-between"}><div><h2 className="font-semibold">课程管理</h2><p className="mt-1 text-[13px] text-stone-400">维护会变动的课程（游泳课、FCE 等）；结课的课程新建任务时不再出现，历史任务保留</p></div><button onClick={() => { setOpen(!open); if (open) reset(); }} className="rounded-lg bg-sage-50 px-3 py-1.5 text-[13px] font-medium text-sage-700">{open ? "收起" : "管理课程"}</button></div>
    {open && <div className="mt-4">
      <div className="rounded-xl border border-stone-100 bg-stone-50/50 p-3">
        <p className="mb-2 text-[13px] font-semibold text-stone-500">{editingId ? "编辑课程" : "新增课程"}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="课程名称，如 游泳课 / FCE精讲" className={field} />
          <select value={draft.mainCategory} onChange={(e) => changeMain(e.target.value as MainCategory)} className={field}>{COURSE_MAIN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
          <select value={draft.subCategory} onChange={(e) => set("subCategory", e.target.value)} className={field}><option value="" disabled>请选择二级类型</option>{subOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
          <select value={draft.status} onChange={(e) => set("status", e.target.value as CourseStatus)} className={field}>{(Object.keys(COURSE_STATUS_META) as CourseStatus[]).map((s) => <option key={s} value={s}>{COURSE_STATUS_META[s].label}</option>)}</select>
          <label className="flex items-center gap-2 text-sm text-stone-600"><input type="checkbox" checked={draft.isClass} onChange={(e) => set("isClass", e.target.checked)} className="h-4 w-4 rounded" />算作“上课”（钢琴练习等不勾）</label>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="text-[13px] text-stone-500">起始日期（可空）<input type="date" value={draft.startDate} onChange={(e) => set("startDate", e.target.value)} className={`mt-1 w-full ${field}`} /></label><label className="text-[13px] text-stone-500">结束日期（可空＝长期）<input type="date" value={draft.endDate} onChange={(e) => set("endDate", e.target.value)} className={`mt-1 w-full ${field}`} /></label></div>
        <div className="mt-2"><p className="mb-1.5 text-[13px] text-stone-500">固定上课星期（可选，仅作默认带出）</p><div className="flex flex-wrap gap-2">{[1, 2, 3, 4, 5, 6, 0].map((day) => <button key={day} type="button" onClick={() => toggleDay(day)} className={`rounded-lg px-2.5 py-1.5 text-[13px] ${draft.weekdays.includes(day) ? "bg-primary text-white" : "bg-stone-100 text-stone-500"}`}>{WEEKDAY_LABELS[day].replace("周", "")}</button>)}</div></div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="text-[13px] text-stone-500">开始时间（可空）<input type="time" value={draft.startTime} onChange={(e) => set("startTime", e.target.value)} className={`mt-1 w-full ${field}`} /></label><label className="text-[13px] text-stone-500">结束时间（可空）<input type="time" value={draft.endTime} onChange={(e) => set("endTime", e.target.value)} className={`mt-1 w-full ${field}`} /></label></div>
        <div className="mt-3 flex gap-2"><button onClick={save} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white">{editingId ? "保存修改" : "添加课程"}</button>{editingId && <button onClick={reset} className="rounded-lg border px-4 py-2 text-sm text-stone-500">取消编辑</button>}</div>
      </div>
      <div className="mt-4 space-y-4">{grouped.map((group) => <div key={group.value}><p className="mb-2 text-[13px] font-semibold text-stone-500">{group.label}</p><div className="space-y-2">{group.items.map((course) => <div key={course.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-stone-50 px-3 py-2 text-[13px]"><span className="font-medium">{course.name}</span><span className="text-stone-400">{subCategoryLabel(course.mainCategory, course.subCategory)}{course.isClass ? "·上课" : ""}</span>{(course.schedule?.weekdays?.length || course.schedule?.startTime) ? <span className="text-stone-400">{courseScheduleText(course)}</span> : null}{(course.startDate || course.endDate) ? <span className="text-stone-400">{course.startDate ?? "…"}~{course.endDate ?? "长期"}</span> : null}<button onClick={() => cycleStatus(course)} className={`ml-auto rounded-full px-2 py-0.5 ${COURSE_STATUS_META[course.status].className}`}>{COURSE_STATUS_META[course.status].label}</button><button onClick={() => startEdit(course)} className="text-sage-700">修改</button><button onClick={() => remove(course)} className="text-rose-500">删除</button></div>)}</div></div>)}{!courses.length && <p className="text-[13px] text-stone-400">还没有课程，添加第一门吧。</p>}</div>
    </div>}
  </section>;
}

const courseScheduleText = (course: Course) => { const days = course.schedule?.weekdays?.length ? `每周${weekdayText(course.schedule.weekdays)}` : ""; const time = course.schedule?.startTime ? `${course.schedule.startTime}${course.schedule.endTime ? `-${course.schedule.endTime}` : ""}` : ""; return [days, time].filter(Boolean).join("｜"); };

function timeLabel(task: Task) { if (task.timeType === "weeklyTimes") return `每周 ${task.weeklyQuota?.targetCount ?? 1} ${task.weeklyQuota?.unit ?? "次"}｜${fmtDate(task.startDate)} 起${task.endDate ? `，到 ${fmtDate(task.endDate)}` : ""}`; if (task.timeType === "weekGoal") return `${task.weeklyQuota?.isWeeklyRecurring ? "每周执行｜" : ""}本周目标${task.weekStart ? `｜${fmtDate(task.weekStart)} 至 ${fmtDate(getWeekEndKey(task.weekStart))}` : ""}`; if (task.timeType === "assignmentWindow") return `作业周期：${fmtDate(task.assignmentWindow?.startDate)}～${fmtDate(task.assignmentWindow?.endDate)}`; if (task.timeType === "dateRange") return `${fmtDate(task.startDate)}～${fmtDate(task.endDate)}`; if (task.timeType === "recurring" && task.schedulePattern === "specificDates") return `指定日期 ${formatSpecificDates(task.specificDates ?? [])}`; if (task.timeType === "recurring" && task.schedulePattern === "dailyRecurring") return `每日重复｜${fmtDate(task.recurrence?.startDate)} 至 ${task.recurrence?.endDate ? fmtDate(task.recurrence.endDate) : "长期"}`; if (task.timeType === "recurring" && task.schedulePattern === "dateRangeDaily") return `${fmtDate(task.startDate)}～${fmtDate(task.endDate)} 每天`; if (task.timeType === "recurring" && task.schedulePattern === "dateRangeWeekdays") return `${fmtDate(task.startDate)}～${fmtDate(task.endDate)}｜每周${weekdayText(task.rangeWeekdays)}`; if (task.timeType === "recurring") return `每周${weekdayText(task.recurrence?.weekdays)}｜${fmtDate(task.recurrence?.startDate)} 至 ${task.recurrence?.endDate ? fmtDate(task.recurrence.endDate) : "长期"}`; return task.date ? fmtDate(task.date) : "未设置日期"; }
const weekdayText = (days?: number[]) => [1, 2, 3, 4, 5, 6, 0].filter((day) => days?.includes(day)).map((day) => WEEKDAY_LABELS[day].replace("周", "")).join("");
const formatTime = (task: Task) => { const start = task.startTime ?? task.time; return start ? `${start}${task.endTime ? `-${task.endTime}` : ""}` : ""; };
