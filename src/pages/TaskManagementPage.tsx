import { CalendarPlus, CalendarX, ChevronDown, Copy, GripVertical, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { taskRepository } from "../data/taskRepository";
import { getRepository } from "../data/repositoryProvider";
import { loadCustomTaskCategories, type CustomTaskCategories } from "../data/appSettingsRepository";
import type { Course, CourseStatus, ExtraContentType, MainCategory, PlanPeriod, Task } from "../types/task";
import { fmtDate, formatSpecificDates, getWeekEndKey, todayKey } from "../utils/date";
import { COURSE_MAIN_OPTIONS, COURSE_STATUS_META, MAIN_CATEGORY_META, SUB_CATEGORY_OPTIONS, WEEKDAY_LABELS, canEndRecurring, canExtendRecurring, interestContentType, isCourseTask, isEndedRecurring, isValidSubCategory, subCategoryLabel, taskShortName } from "../utils/taskMeta";
import { taskSubjectGroup, type TaskSubjectGroup } from "../utils/taskGrouping";

interface Props { refreshKey: number; onRefresh: () => void; notify: (text: string) => void; onEdit: (task: Task) => void; onDelete: (task: Task) => void; onEnd: (task: Task) => void; onExtend: (task: Task) => void; onCopy: (task: Task) => void; }
const order: MainCategory[] = ["school", "extraHomework", "interestClass", "temporary"];
const GROUP_TONES: Record<TaskSubjectGroup, { accent: string; heading: string; title: string }> = {
  chinese: { accent: "#D96A52", heading: "bg-[#FFF0EA]", title: "text-[#B64E39]" },
  math: { accent: "#5868C8", heading: "bg-[#EEF0FF]", title: "text-[#4056B5]" },
  english: { accent: "#9364C7", heading: "bg-[#F5EDFF]", title: "text-[#7546AE]" },
  other: { accent: "#738078", heading: "bg-[#EFF2F0]", title: "text-[#536159]" },
};

export function TaskManagementPage(props: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [periods, setPeriods] = useState<PlanPeriod[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [filter, setFilter] = useState<"all" | "current" | "regular" | "holiday">("current");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showDone, setShowDone] = useState(false);
  const [showAllDone, setShowAllDone] = useState(false);
  const [showEnded, setShowEnded] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const reload = () => Promise.all([taskRepository.listAll(), taskRepository.listPlanPeriods(), getRepository().listCourses()]).then(([items, stages, courseList]) => { setTasks(items); setPeriods(stages); setCourses(courseList); setSelected(new Set()); });
  useEffect(() => { reload(); }, [props.refreshKey]);
  const holidays = periods.filter((period) => period.type === "holiday");
  const currentHoliday = holidays.find((period) => period.isActive && todayKey() >= period.startDate && todayKey() <= period.endDate);
  const filtered = useMemo(() => tasks.filter((task) => {
    const boundHoliday = !!task.planPeriodId && holidays.some((period) => period.id === task.planPeriodId);
    if (filter === "all") return true;
    if (filter === "regular") return !boundHoliday;
    if (filter === "holiday") return boundHoliday;
    return currentHoliday ? task.planPeriodId === currentHoliday.id : !boundHoliday;
  }), [tasks, periods, filter, currentHoliday?.id]);
  const notFinished = filtered.filter((task) => !["done", "cancelled"].includes(task.status));
  // 「结束」≠「完成」：结束只改 recurrence.endDate，occurrence 类任务本体 status 按 R1 恒为
  // todo/cancelled，永远进不了"已完成"分组——不单独摘出来会一直卡在待办列表里（2026-07-20 用户反馈）
  const pending = notFinished.filter((task) => !isEndedRecurring(task));
  const ended = notFinished.filter((task) => isEndedRecurring(task));
  const completed = filtered.filter((task) => ["done", "cancelled"].includes(task.status));
  const completedCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const recentCompleted = completed.filter((task) => (task.completedAt ?? task.updatedAt) >= completedCutoff);
  const visibleCompleted = showAllDone ? completed : recentCompleted;
  const earlierCompletedCount = completed.length - recentCompleted.length;
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const selectIds = (ids: string[]) => setSelected((current) => { const next = new Set(current); const all = ids.every((id) => next.has(id)); ids.forEach((id) => all ? next.delete(id) : next.add(id)); return next; });
  const batchDelete = async () => {
    if (!selected.size || !confirm(`确定删除已选的 ${selected.size} 项任务吗？任务会保留在本地记录中。`)) return;
    const count = await getRepository().batchRemove([...selected]);
    await reload(); props.onRefresh(); props.notify(`已删除 ${count} 项任务`);
  };
  return <main className="task-management mx-auto w-full max-w-6xl px-3 pb-content pt-4 sm:px-7 sm:pt-6 lg:px-10">
    <header className="page-header"><h1 className="page-title shrink-0">任务管理</h1>{selected.size > 0 && <button onClick={batchDelete} className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white"><Trash2 className="h-4 w-4" />删除已选（{selected.size}）</button>}</header>
    <div className="mb-5 flex flex-wrap items-center gap-1 border-b border-ink/10">{(["all", "current", "regular", "holiday"] as const).map((value) => <button key={value} onClick={() => setFilter(value)} className={`border-b-2 px-3 py-2.5 text-xs font-semibold ${filter === value ? "border-alert text-ink" : "border-transparent text-muted hover:text-ink"}`}>{value === "current" ? `当前阶段 · ${currentHoliday ? "假期" : "平时"}` : { all: "全部", regular: "平时", holiday: "假期" }[value]}</button>)}<span className="ml-2 hidden text-xs text-stone-400 sm:inline">今天：{currentHoliday?.name ?? "平时"}</span></div>
    <div className="space-y-5">{order.map((category) => <TaskGroup key={category} category={category} sortable onReorder={async (ids) => { await getRepository().reorderTasks(ids); await reload(); props.onRefresh(); }} tasks={pending.filter((task) => task.mainCategory === category)} selected={selected} onToggle={toggle} onSelectGroup={selectIds} {...props} />)}</div>
    {ended.length > 0 && <section className="mt-6 rounded-lg border border-stone-100 bg-white p-3 opacity-75 shadow-card"><button onClick={() => setShowEnded(!showEnded)} className="flex w-full items-center justify-between px-1 py-2 text-sm font-semibold text-stone-500">已结束的重复任务 · {ended.length}<ChevronDown className={`h-4 w-4 transition ${showEnded ? "rotate-180" : ""}`} /></button>{showEnded && <div className="mt-2 space-y-4">{order.map((category) => <TaskGroup key={category} category={category} tasks={ended.filter((task) => task.mainCategory === category)} selected={selected} onToggle={toggle} onSelectGroup={selectIds} {...props} />)}</div>}</section>}
    {completed.length > 0 && <section className="mt-6 rounded-lg border border-stone-100 bg-white p-3 opacity-75 shadow-card"><button onClick={() => setShowDone(!showDone)} className="flex w-full items-center justify-between px-1 py-2 text-sm font-semibold text-stone-500">已完成任务 · {visibleCompleted.length}{!showAllDone && earlierCompletedCount > 0 ? `（另有 ${earlierCompletedCount} 项更早记录）` : ""}<ChevronDown className={`h-4 w-4 transition ${showDone ? "rotate-180" : ""}`} /></button>{showDone && <div className="mt-2 space-y-4">{order.map((category) => <TaskGroup key={category} category={category} tasks={visibleCompleted.filter((task) => task.mainCategory === category)} selected={selected} onToggle={toggle} onSelectGroup={selectIds} {...props} />)}{earlierCompletedCount > 0 && <button onClick={() => setShowAllDone(!showAllDone)} className="mx-auto block rounded-lg border px-4 py-2 text-xs font-semibold text-stone-500">{showAllDone ? "只显示最近 30 天" : "显示更早已完成任务"}</button>}</div>}</section>}
    <div className="mt-6 border-t border-ink/10 pt-3"><button onClick={() => setShowSetup(!showSetup)} className="flex w-full items-center justify-between py-2 text-left"><span><span className="block text-sm font-bold text-ink">课程与假期资料</span><span className="mt-0.5 block text-xs text-muted">低频维护项，默认收起</span></span><ChevronDown className={`h-4 w-4 text-muted transition ${showSetup ? "rotate-180" : ""}`} /></button>{showSetup && <div className="mt-3 space-y-4"><PlanPeriodManager periods={holidays} currentHoliday={currentHoliday} onChanged={() => { reload(); props.onRefresh(); }} notify={props.notify} /><CourseManager courses={courses} onChanged={() => { reload(); props.onRefresh(); }} notify={props.notify} /></div>}</div>
  </main>;
}

// 子分组内手动顺序：与今日页 taskSort 的组内规则一致（sortOrder → createdAt），拖拽后两处顺序同步
const manualOrder = (a: Task, b: Task) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || a.createdAt.localeCompare(b.createdAt);

function TaskGroup({ category, tasks, selected, onToggle, onSelectGroup, sortable, onReorder, ...props }: Props & { category: MainCategory; tasks: Task[]; selected: Set<string>; onToggle: (id: string) => void; onSelectGroup: (ids: string[]) => void; sortable?: boolean; onReorder?: (ids: string[]) => Promise<void> }) {
  if (!tasks.length) return null;
  const standardOptions = SUB_CATEGORY_OPTIONS[category];
  const subgroupOptions = category === "temporary" ? ["travel", "leisure", "examCompetition", "other"].map((value) => standardOptions.find((option) => option.value === value)!).filter(Boolean) : standardOptions;
  const knownValues = new Set(subgroupOptions.map((option) => option.value));
  const customOptions = [...new Set(tasks.filter((task) => !knownValues.has(task.subCategory)).map((task) => task.subCategory))];
  const groups = [
    ...subgroupOptions.flatMap((option) => {
      const matching = tasks.filter((task) => task.subCategory === option.value);
      if (category !== "extraHomework") return [{ value: option.value, label: category === "school" ? `${option.label}作业` : option.label, tasks: matching }];
      const classes = matching.filter(isCourseTask);
      const homework = matching.filter((task) => !isCourseTask(task));
      return [
        { value: `${option.value}-class`, label: `${option.label}上课`, tasks: classes },
        { value: `${option.value}-homework`, label: `${option.label}作业`, tasks: homework },
      ];
    }),
    ...customOptions.flatMap((value) => {
      const label = subCategoryLabel(category, value);
      const matching = tasks.filter((task) => task.subCategory === value);
      if (category !== "extraHomework") return [{ value, label, tasks: matching }];
      return [
        { value: `${value}-class`, label: `${label}上课`, tasks: matching.filter(isCourseTask) },
        { value: `${value}-homework`, label: `${label}作业`, tasks: matching.filter((task) => !isCourseTask(task)) },
      ];
    }),
  ].filter((group) => group.tasks.length);
  return <section className="surface overflow-visible"><header className="flex items-center gap-2 rounded-t-lg border-b border-ink/10 bg-white px-4 py-2.5"><span className={`h-2.5 w-2.5 rounded-full ${MAIN_CATEGORY_META[category].dot}`} /><h2 className="text-sm font-bold text-ink">{MAIN_CATEGORY_META[category].label}</h2><span className="text-xs text-muted">{tasks.length}</span><button onClick={() => onSelectGroup(tasks.map((task) => task.id))} className="ml-auto text-xs text-muted hover:text-ink">{tasks.every((task) => selected.has(task.id)) ? "取消本组" : "选择本组"}</button></header><div className="divide-y divide-ink/10">{groups.map((subgroup) => <SortableSubgroup key={subgroup.value} label={subgroup.label} tasks={subgroup.tasks} sortable={sortable} onReorder={onReorder} renderRow={(task) => <TaskRow key={task.id} task={task} selected={selected.has(task.id)} onToggle={() => onToggle(task.id)} sortable={sortable && subgroup.tasks.length > 1} {...props} />} />)}</div></section>;
}

function SortableSubgroup({ label, tasks, sortable, onReorder, renderRow }: { label: string; tasks: Task[]; sortable?: boolean; onReorder?: (ids: string[]) => Promise<void>; renderRow: (task: Task) => ReactNode }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const ordered = [...tasks].sort(manualOrder);
  const drop = async (targetId: string) => {
    if (!sortable || !onReorder || !dragId || dragId === targetId) return;
    const ids = ordered.map((task) => task.id);
    const fromIdx = ids.indexOf(dragId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, dragId);
    await onReorder(ids);
  };
  const tone = GROUP_TONES[taskSubjectGroup(tasks[0])];
  return <section className="overflow-visible border-l-4" style={{ borderLeftColor: tone.accent }}><h3 className={`flex items-center px-3 py-2.5 text-sm font-bold sm:px-4 ${tone.heading}`}><span className={tone.title}>{label}</span><span className="ml-auto text-[10px] font-semibold tabular-nums text-muted">{tasks.length}</span></h3>{ordered.map((task) => sortable && tasks.length > 1 ? <div
    key={task.id}
    draggable
    onDragStart={() => setDragId(task.id)}
    onDragEnd={() => { setDragId(null); setOverId(null); }}
    onDragOver={(e) => { e.preventDefault(); setOverId(task.id); }}
    onDrop={(e) => { e.preventDefault(); drop(task.id); setDragId(null); setOverId(null); }}
    className={`transition-all ${dragId === task.id ? "opacity-40" : ""} ${overId === task.id && dragId !== task.id ? "border-t-2 border-primary" : ""}`}
  >{renderRow(task)}</div> : renderRow(task))}</section>;
}

function TaskRow({ task, selected, onToggle, onCopy, onEdit, onDelete, onEnd, onExtend, sortable }: Props & { task: Task; selected: boolean; onToggle: () => void; sortable?: boolean }) {
  const [menu, setMenu] = useState(false);
  const [menuAbove, setMenuAbove] = useState(false);
  const finished = ["done", "cancelled"].includes(task.status);
  const checklist = task.checklistItems?.length ? ` · 小项 ${task.checklistItems.filter((item) => item.done).length}/${task.checklistItems.length}` : "";
  const toggleMenu = (button: HTMLButtonElement) => {
    if (!menu) {
      const bounds = button.getBoundingClientRect();
      const spaceBelow = window.innerHeight - bounds.bottom;
      setMenuAbove(spaceBelow < 220 && bounds.top > spaceBelow);
    }
    setMenu(!menu);
  };
  return <div className={`relative ${menu ? "z-40" : ""} flex items-center gap-2 border-b border-ink/[0.07] px-3 py-2.5 last:border-0 sm:px-4 ${finished ? "bg-stone-50/40 text-stone-400" : "bg-white"}`}>{sortable && <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-stone-300 active:cursor-grabbing" />}<input type="checkbox" checked={selected} onChange={onToggle} aria-label={`选择 ${task.title}`} className="h-4 w-4 rounded" /><div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-2">{formatTime(task) && <span className="shrink-0 rounded bg-ink/[0.06] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted">{formatTime(task)}</span>}<p className={`min-w-0 truncate text-sm font-semibold ${finished ? "line-through" : "text-ink"}`}>{taskShortName(task)}</p></div><p className="mt-1 truncate text-[11px] text-muted">{timeLabel(task)}{checklist}</p></div><div className="relative"><button onClick={(event) => toggleMenu(event.currentTarget)} aria-label="任务操作" className="rounded-lg p-2 text-muted hover:bg-stone-100 hover:text-ink"><MoreHorizontal className="h-4 w-4" /></button>{menu && <div className={`absolute right-0 ${menuAbove ? "bottom-9" : "top-9"} z-50 max-h-[calc(100dvh-6rem)] w-40 overflow-y-auto rounded-lg border border-ink/10 bg-white p-1.5 text-sm text-ink shadow-card`}><button onClick={() => { onCopy(task); setMenu(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 hover:bg-stone-50"><Copy className="h-4 w-4" />复制</button><button onClick={() => { onEdit(task); setMenu(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 hover:bg-stone-50"><Pencil className="h-4 w-4" />编辑</button>{canEndRecurring(task) && !finished && <button onClick={() => { onEnd(task); setMenu(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-amber-700 hover:bg-amber-50"><CalendarX className="h-4 w-4" />结束</button>}{canExtendRecurring(task) && !finished && <button onClick={() => { onExtend(task); setMenu(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-primary hover:bg-mint"><CalendarPlus className="h-4 w-4" />延长</button>}<button onClick={() => { onDelete(task); setMenu(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" />删除</button></div>}</div></div>;
}

function PlanPeriodManager({ periods, currentHoliday, onChanged, notify }: { periods: PlanPeriod[]; currentHoliday?: PlanPeriod; onChanged: () => void; notify: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ name: "", startDate: todayKey(), endDate: todayKey() });
  const add = async () => { if (!draft.name.trim() || draft.startDate > draft.endDate) return notify("请填写正确的假期名称和日期"); await getRepository().createPlanPeriod({ ...draft, type: "holiday", name: draft.name.trim(), isActive: true }); setDraft({ ...draft, name: "" }); onChanged(); notify("假期已添加"); };
  return <section className="rounded-2xl border border-stone-100 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="font-semibold">假期设置</h2><p className="mt-1 text-xs text-stone-400">当前：{currentHoliday?.name ?? "平时"}；只需维护假期，其他日期自动视为平时</p></div><button onClick={() => setOpen(!open)} className="rounded-lg bg-sage-50 px-3 py-1.5 text-xs font-medium text-sage-700">{open ? "收起" : "管理假期"}</button></div>{open && <div className="mt-4"><div className="grid gap-2 sm:grid-cols-4"><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="例如：2026暑假" className="rounded-lg border px-3 py-2 text-sm" /><input type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} className="rounded-lg border px-2 py-2 text-sm" /><input type="date" value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} className="rounded-lg border px-2 py-2 text-sm" /><button onClick={add} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white">添加假期</button></div><div className="mt-3 space-y-2">{periods.map((period) => <div key={period.id} className="flex items-center gap-3 rounded-lg bg-stone-50 px-3 py-2 text-xs"><span className="font-medium">{period.name}</span><span className="text-stone-400">{period.startDate} 至 {period.endDate}</span><button onClick={async () => { await getRepository().updatePlanPeriod(period.id, { isActive: !period.isActive }); onChanged(); }} className={`ml-auto rounded-full px-2 py-0.5 ${period.isActive ? "bg-stone-200 text-stone-500" : "bg-emerald-50 text-emerald-700"}`}>{period.isActive ? "停用" : "启用"}</button><button onClick={async () => { const name = prompt("假期名称", period.name)?.trim(); if (!name) return; const startDate = prompt("开始日期 YYYY-MM-DD", period.startDate); const endDate = prompt("结束日期 YYYY-MM-DD", period.endDate); if (!startDate || !endDate || startDate > endDate) return notify("日期范围不正确"); await getRepository().updatePlanPeriod(period.id, { name, startDate, endDate }); onChanged(); }} className="text-sage-700">修改</button><button onClick={async () => { if (!confirm(`删除假期“${period.name}”？关联任务会改为全部阶段。`)) return; await getRepository().removePlanPeriod(period.id); onChanged(); }} className="text-rose-500">删除</button></div>)}</div></div>}</section>;
}

type CourseDraft = {
  name: string; mainCategory: MainCategory; subCategory: string; isClass: boolean;
  status: CourseStatus; startDate: string; endDate: string; weekdays: number[]; startTime: string; endTime: string;
};
const emptyCourseDraft = (): CourseDraft => ({ name: "", mainCategory: "extraHomework", subCategory: "chinese", isClass: true, status: "active", startDate: "", endDate: "", weekdays: [], startTime: "", endTime: "" });

function CourseManager({ courses, onChanged, notify }: { courses: Course[]; onChanged: () => void; notify: (text: string) => void }) {
  const [open, setOpen] = useState(false);
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

  return <section className="rounded-2xl border border-stone-100 bg-white p-4 shadow-sm">
    <div className="flex items-center justify-between"><div><h2 className="font-semibold">课程管理</h2><p className="mt-1 text-xs text-stone-400">维护会变动的课程（游泳课、FCE 等）；结课的课程新建任务时不再出现，历史任务保留</p></div><button onClick={() => { setOpen(!open); if (open) reset(); }} className="rounded-lg bg-sage-50 px-3 py-1.5 text-xs font-medium text-sage-700">{open ? "收起" : "管理课程"}</button></div>
    {open && <div className="mt-4">
      <div className="rounded-xl border border-stone-100 bg-stone-50/50 p-3">
        <p className="mb-2 text-xs font-semibold text-stone-500">{editingId ? "编辑课程" : "新增课程"}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="课程名称，如 游泳课 / FCE精讲" className={field} />
          <select value={draft.mainCategory} onChange={(e) => changeMain(e.target.value as MainCategory)} className={field}>{COURSE_MAIN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
          <select value={draft.subCategory} onChange={(e) => set("subCategory", e.target.value)} className={field}><option value="" disabled>请选择二级类型</option>{subOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
          <select value={draft.status} onChange={(e) => set("status", e.target.value as CourseStatus)} className={field}>{(Object.keys(COURSE_STATUS_META) as CourseStatus[]).map((s) => <option key={s} value={s}>{COURSE_STATUS_META[s].label}</option>)}</select>
          <label className="flex items-center gap-2 text-sm text-stone-600"><input type="checkbox" checked={draft.isClass} onChange={(e) => set("isClass", e.target.checked)} className="h-4 w-4 rounded" />算作“上课”（钢琴练习等不勾）</label>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="text-xs text-stone-500">起始日期（可空）<input type="date" value={draft.startDate} onChange={(e) => set("startDate", e.target.value)} className={`mt-1 w-full ${field}`} /></label><label className="text-xs text-stone-500">结束日期（可空＝长期）<input type="date" value={draft.endDate} onChange={(e) => set("endDate", e.target.value)} className={`mt-1 w-full ${field}`} /></label></div>
        <div className="mt-2"><p className="mb-1.5 text-xs text-stone-500">固定上课星期（可选，仅作默认带出）</p><div className="flex flex-wrap gap-2">{[1, 2, 3, 4, 5, 6, 0].map((day) => <button key={day} type="button" onClick={() => toggleDay(day)} className={`rounded-lg px-2.5 py-1.5 text-xs ${draft.weekdays.includes(day) ? "bg-primary text-white" : "bg-stone-100 text-stone-500"}`}>{WEEKDAY_LABELS[day].replace("周", "")}</button>)}</div></div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="text-xs text-stone-500">开始时间（可空）<input type="time" value={draft.startTime} onChange={(e) => set("startTime", e.target.value)} className={`mt-1 w-full ${field}`} /></label><label className="text-xs text-stone-500">结束时间（可空）<input type="time" value={draft.endTime} onChange={(e) => set("endTime", e.target.value)} className={`mt-1 w-full ${field}`} /></label></div>
        <div className="mt-3 flex gap-2"><button onClick={save} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white">{editingId ? "保存修改" : "添加课程"}</button>{editingId && <button onClick={reset} className="rounded-lg border px-4 py-2 text-sm text-stone-500">取消编辑</button>}</div>
      </div>
      <div className="mt-4 space-y-4">{grouped.map((group) => <div key={group.value}><p className="mb-2 text-xs font-semibold text-stone-500">{group.label}</p><div className="space-y-2">{group.items.map((course) => <div key={course.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-stone-50 px-3 py-2 text-xs"><span className="font-medium">{course.name}</span><span className="text-stone-400">{subCategoryLabel(course.mainCategory, course.subCategory)}{course.isClass ? "·上课" : ""}</span>{(course.schedule?.weekdays?.length || course.schedule?.startTime) ? <span className="text-stone-400">{courseScheduleText(course)}</span> : null}{(course.startDate || course.endDate) ? <span className="text-stone-400">{course.startDate ?? "…"}~{course.endDate ?? "长期"}</span> : null}<button onClick={() => cycleStatus(course)} className={`ml-auto rounded-full px-2 py-0.5 ${COURSE_STATUS_META[course.status].className}`}>{COURSE_STATUS_META[course.status].label}</button><button onClick={() => startEdit(course)} className="text-sage-700">修改</button><button onClick={() => remove(course)} className="text-rose-500">删除</button></div>)}</div></div>)}{!courses.length && <p className="text-xs text-stone-400">还没有课程，添加第一门吧。</p>}</div>
    </div>}
  </section>;
}

const courseScheduleText = (course: Course) => { const days = course.schedule?.weekdays?.length ? `每周${weekdayText(course.schedule.weekdays)}` : ""; const time = course.schedule?.startTime ? `${course.schedule.startTime}${course.schedule.endTime ? `-${course.schedule.endTime}` : ""}` : ""; return [days, time].filter(Boolean).join("｜"); };

function timeLabel(task: Task) { if (task.timeType === "weekGoal") return `${task.weeklyQuota?.isWeeklyRecurring ? "每周执行｜" : ""}本周目标${task.weekStart ? `｜${fmtDate(task.weekStart)} 至 ${fmtDate(getWeekEndKey(task.weekStart))}` : ""}`; if (task.timeType === "assignmentWindow") return `作业周期：${fmtDate(task.assignmentWindow?.startDate)}～${fmtDate(task.assignmentWindow?.endDate)}`; if (task.timeType === "dateRange") return `${fmtDate(task.startDate)}～${fmtDate(task.endDate)}`; if (task.timeType === "recurring" && task.schedulePattern === "specificDates") return `指定日期 ${formatSpecificDates(task.specificDates ?? [])}`; if (task.timeType === "recurring" && task.schedulePattern === "dailyRecurring") return `每日重复｜${fmtDate(task.recurrence?.startDate)} 至 ${task.recurrence?.endDate ? fmtDate(task.recurrence.endDate) : "长期"}`; if (task.timeType === "recurring" && task.schedulePattern === "dateRangeDaily") return `${fmtDate(task.startDate)}～${fmtDate(task.endDate)} 每天`; if (task.timeType === "recurring" && task.schedulePattern === "dateRangeWeekdays") return `${fmtDate(task.startDate)}～${fmtDate(task.endDate)}｜每周${weekdayText(task.rangeWeekdays)}`; if (task.timeType === "recurring") return `每周${weekdayText(task.recurrence?.weekdays)}｜${fmtDate(task.recurrence?.startDate)} 至 ${task.recurrence?.endDate ? fmtDate(task.recurrence.endDate) : "长期"}`; return task.date ? fmtDate(task.date) : "未设置日期"; }
const weekdayText = (days?: number[]) => [1, 2, 3, 4, 5, 6, 0].filter((day) => days?.includes(day)).map((day) => WEEKDAY_LABELS[day].replace("周", "")).join("");
const formatTime = (task: Task) => { const start = task.startTime ?? task.time; return start ? `${start}${task.endTime ? `-${task.endTime}` : ""}` : ""; };
