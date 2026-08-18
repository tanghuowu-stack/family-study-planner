import { CalendarPlus, CalendarX, ChevronDown, Copy, GripVertical, Pencil, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { taskRepository } from "../data/taskRepository";
import { getRepository } from "../data/repositoryProvider";
import type { Course, CourseStatus, ExtraContentType, MainCategory, PlanPeriod, Task } from "../types/task";
import { fmtDate, formatSpecificDates, getWeekEndKey, todayKey } from "../utils/date";
import { COURSE_MAIN_OPTIONS, COURSE_STATUS_META, MAIN_CATEGORY_META, SUB_CATEGORY_OPTIONS, WEEKDAY_LABELS, canEndRecurring, canExtendRecurring, extraContentLabel, isCourseTask, isEndedRecurring, subCategoryLabel, taskShortName } from "../utils/taskMeta";

interface Props { refreshKey: number; onRefresh: () => void; notify: (text: string) => void; onEdit: (task: Task) => void; onDelete: (task: Task) => void; onEnd: (task: Task) => void; onExtend: (task: Task) => void; onCopy: (task: Task) => void; }
const order: MainCategory[] = ["school", "extraHomework", "interestClass", "temporary"];

export function TaskManagementPage(props: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [periods, setPeriods] = useState<PlanPeriod[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [filter, setFilter] = useState<"all" | "current" | "regular" | "holiday">("current");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showDone, setShowDone] = useState(false);
  const [showAllDone, setShowAllDone] = useState(false);
  const [showEnded, setShowEnded] = useState(false);
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
  return <main className="mx-auto w-full max-w-6xl px-4 pb-content pt-6 sm:px-6">
    <div className="mb-5 grid grid-cols-[1fr_auto_1fr] items-end gap-3"><span /><div className="text-center"><p className="text-xs font-semibold tracking-widest text-sage-700">TASKS</p><h1 className="mt-1 text-2xl font-semibold">任务管理</h1></div>{selected.size > 0 ? <button onClick={batchDelete} className="inline-flex items-center gap-2 justify-self-end rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white"><Trash2 className="h-4 w-4" />删除已选（{selected.size}）</button> : <span />}</div>
    <div className="mb-4 mt-6 flex flex-wrap items-center gap-2">{(["all", "current", "regular", "holiday"] as const).map((value) => <button key={value} onClick={() => setFilter(value)} className={`rounded-full px-3 py-1.5 text-xs ${filter === value ? "bg-primary text-white" : "bg-white text-stone-500"}`}>{value === "current" ? `当前阶段（${currentHoliday ? "假期" : "平时"}）` : { all: "全部", regular: "平时", holiday: "假期" }[value]}</button>)}<span className="text-xs text-stone-400">今天：{currentHoliday?.name ?? "平时"}</span><button onClick={() => selectIds(filtered.map((task) => task.id))} className="ml-auto rounded-full border bg-white px-3 py-1.5 text-xs text-stone-500">{filtered.length && filtered.every((task) => selected.has(task.id)) ? "取消全选当前筛选" : "全选当前筛选"}</button></div>
    <div className="space-y-5">{order.map((category) => <TaskGroup key={category} category={category} sortable onReorder={async (ids) => { await getRepository().reorderTasks(ids); await reload(); props.onRefresh(); }} tasks={pending.filter((task) => task.mainCategory === category)} periods={periods} selected={selected} onToggle={toggle} onSelectGroup={selectIds} {...props} />)}</div>
    {ended.length > 0 && <section className="mt-6 rounded-2xl border border-stone-100 bg-white p-3 opacity-75 shadow-card"><button onClick={() => setShowEnded(!showEnded)} className="flex w-full items-center justify-between px-1 py-2 text-sm font-semibold text-stone-500">已结束的重复任务 · {ended.length}<ChevronDown className={`h-4 w-4 transition ${showEnded ? "rotate-180" : ""}`} /></button>{showEnded && <div className="mt-2 space-y-4">{order.map((category) => <TaskGroup key={category} category={category} tasks={ended.filter((task) => task.mainCategory === category)} periods={periods} selected={selected} onToggle={toggle} onSelectGroup={selectIds} {...props} />)}</div>}</section>}
    {completed.length > 0 && <section className="mt-6 rounded-2xl border border-stone-100 bg-white p-3 opacity-75 shadow-card"><button onClick={() => setShowDone(!showDone)} className="flex w-full items-center justify-between px-1 py-2 text-sm font-semibold text-stone-500">已完成任务 · {visibleCompleted.length}{!showAllDone && earlierCompletedCount > 0 ? `（另有 ${earlierCompletedCount} 项更早记录）` : ""}<ChevronDown className={`h-4 w-4 transition ${showDone ? "rotate-180" : ""}`} /></button>{showDone && <div className="mt-2 space-y-4">{order.map((category) => <TaskGroup key={category} category={category} tasks={visibleCompleted.filter((task) => task.mainCategory === category)} periods={periods} selected={selected} onToggle={toggle} onSelectGroup={selectIds} {...props} />)}{earlierCompletedCount > 0 && <button onClick={() => setShowAllDone(!showAllDone)} className="mx-auto block rounded-xl border px-4 py-2 text-xs font-semibold text-stone-500">{showAllDone ? "只显示最近 30 天" : "显示更早已完成任务"}</button>}</div>}</section>}
    <div className="mt-8 space-y-4"><PlanPeriodManager periods={holidays} currentHoliday={currentHoliday} onChanged={() => { reload(); props.onRefresh(); }} notify={props.notify} /><CourseManager courses={courses} onChanged={() => { reload(); props.onRefresh(); }} notify={props.notify} /></div>
  </main>;
}

// 子分组内手动顺序：与今日页 taskSort 的组内规则一致（sortOrder → createdAt），拖拽后两处顺序同步
const manualOrder = (a: Task, b: Task) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || a.createdAt.localeCompare(b.createdAt);

function TaskGroup({ category, tasks, periods, selected, onToggle, onSelectGroup, sortable, onReorder, ...props }: Props & { category: MainCategory; tasks: Task[]; periods: PlanPeriod[]; selected: Set<string>; onToggle: (id: string) => void; onSelectGroup: (ids: string[]) => void; sortable?: boolean; onReorder?: (ids: string[]) => Promise<void> }) {
  if (!tasks.length) return null;
  const standardOptions = SUB_CATEGORY_OPTIONS[category];
  const subgroupOptions = category === "temporary" ? ["travel", "leisure", "examCompetition", "other"].map((value) => standardOptions.find((option) => option.value === value)!).filter(Boolean) : standardOptions;
  const knownValues = new Set(subgroupOptions.map((option) => option.value));
  const groups = [...subgroupOptions.map((option) => ({ ...option, tasks: tasks.filter((task) => task.subCategory === option.value) })), { value: "legacyOther", label: "其他", tasks: tasks.filter((task) => !knownValues.has(task.subCategory)) }].filter((group) => group.tasks.length);
  return <section className="overflow-hidden rounded-2xl border border-stone-100 bg-white shadow-card"><header className="flex items-center gap-2 border-b bg-stone-50/60 px-4 py-3"><span className={`h-2.5 w-2.5 rounded-full ${MAIN_CATEGORY_META[category].dot}`} /><h2 className="font-semibold">{MAIN_CATEGORY_META[category].label}</h2><span className="text-xs text-stone-400">{tasks.length}</span><button onClick={() => onSelectGroup(tasks.map((task) => task.id))} className="ml-auto text-xs text-sage-700">{tasks.every((task) => selected.has(task.id)) ? "取消本组" : "选择本组"}</button></header><div className="space-y-3 p-3">{groups.map((subgroup) => <SortableSubgroup key={subgroup.value} label={subgroup.label} tasks={subgroup.tasks} sortable={sortable} onReorder={onReorder} renderRow={(task) => <TaskRow key={task.id} task={task} periods={periods} selected={selected.has(task.id)} onToggle={() => onToggle(task.id)} sortable={sortable && subgroup.tasks.length > 1} {...props} />} />)}</div></section>;
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
  return <section className="overflow-hidden rounded-xl border border-stone-100"><h3 className="bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-600">{label} · {tasks.length}</h3>{ordered.map((task) => sortable && tasks.length > 1 ? <div
    key={task.id}
    draggable
    onDragStart={() => setDragId(task.id)}
    onDragEnd={() => { setDragId(null); setOverId(null); }}
    onDragOver={(e) => { e.preventDefault(); setOverId(task.id); }}
    onDrop={(e) => { e.preventDefault(); drop(task.id); setDragId(null); setOverId(null); }}
    className={`transition-all ${dragId === task.id ? "opacity-40" : ""} ${overId === task.id && dragId !== task.id ? "border-t-2 border-primary" : ""}`}
  >{renderRow(task)}</div> : renderRow(task))}</section>;
}

function TaskRow({ task, periods, selected, onToggle, onCopy, onEdit, onDelete, onEnd, onExtend, sortable }: Props & { task: Task; periods: PlanPeriod[]; selected: boolean; onToggle: () => void; sortable?: boolean }) {
  const period = periods.find((item) => item.id === task.planPeriodId);
  const finished = ["done", "cancelled"].includes(task.status);
  return <div className={`flex items-center gap-2 border-b px-4 py-3 last:border-0 ${finished ? "bg-stone-50/40 text-stone-400" : ""}`}>{sortable && <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-stone-300 active:cursor-grabbing" />}<input type="checkbox" checked={selected} onChange={onToggle} aria-label={`选择 ${task.title}`} className="h-4 w-4 rounded" /><div className="min-w-0 flex-1"><p className={`truncate text-sm font-medium ${finished ? "line-through" : ""}`}>{taskShortName(task)}</p><div className={`mt-1 flex flex-wrap items-center gap-1.5 text-[11px] ${finished ? "text-stone-400" : "text-stone-500"}`}><span className={`rounded px-1.5 py-0.5 ${finished ? "bg-stone-100 text-stone-400" : subjectTagClass(task)}`}>{subCategoryLabel(task.mainCategory, task.subCategory)}</span>{task.mainCategory === "extraHomework" && <span className={`rounded px-1.5 py-0.5 ${finished ? "bg-stone-200 text-stone-400" : contentTagClass(task)}`}>{extraContentLabel(task.extraContentType)}</span>}{task.mainCategory === "interestClass" && isCourseTask(task) && <span className={`rounded px-1.5 py-0.5 font-semibold ${finished ? "bg-stone-200 text-stone-400" : "bg-mint text-primary"}`}>上课</span>}{task.applicablePeriodType === "regular" && <span className="rounded bg-stone-100 px-1.5 py-0.5">平时</span>}{period && <span className="rounded bg-sage-50 px-1.5 py-0.5 text-sage-700">假期·{period.name}</span>}<span>{timeLabel(task)}</span>{formatTime(task) && <span>｜{formatTime(task)}</span>}{task.calendarVisibility === "hide" && <span>｜不显示月计划</span>}{task.rolloverMode === "skipIfMissed" && <span>｜过期自动跳过</span>}</div>{task.checklistItems?.length ? <p className="mt-1 text-[11px] text-stone-400">小项 {task.checklistItems.filter((item) => item.done).length}/{task.checklistItems.length}</p> : null}</div><button onClick={() => onCopy(task)} aria-label="复制" className="rounded-lg p-2 text-stone-500 hover:bg-stone-50"><Copy className="h-4 w-4" /></button><button onClick={() => onEdit(task)} aria-label="编辑" className="rounded-lg p-2 text-stone-500 hover:bg-stone-50"><Pencil className="h-4 w-4" /></button>{canEndRecurring(task) && !finished && <button onClick={() => onEnd(task)} aria-label="结束" title="结束：今天起不再排期，保留历史与打卡月历" className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-medium text-amber-700 hover:bg-amber-50"><CalendarX className="h-4 w-4" />结束</button>}{canExtendRecurring(task) && !finished && <button onClick={() => onExtend(task)} aria-label="延长" title="延长周期：改结束日期继续排期，本体与历史都不受影响" className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-medium text-primary hover:bg-mint"><CalendarPlus className="h-4 w-4" />延长</button>}<button onClick={() => onDelete(task)} aria-label="删除" className="rounded-lg p-2 text-rose-500 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button></div>;
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
  const subOptions = SUB_CATEGORY_OPTIONS[draft.mainCategory];
  const set = <K extends keyof CourseDraft>(key: K, value: CourseDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const reset = () => { setDraft(emptyCourseDraft()); setEditingId(null); };
  const changeMain = (mainCategory: MainCategory) => setDraft((current) => ({ ...current, mainCategory, subCategory: SUB_CATEGORY_OPTIONS[mainCategory][0].value }));
  const toggleDay = (day: number) => setDraft((current) => ({ ...current, weekdays: current.weekdays.includes(day) ? current.weekdays.filter((d) => d !== day) : [...current.weekdays, day] }));

  const buildInput = (d: CourseDraft) => ({
    name: d.name.trim(), mainCategory: d.mainCategory, subCategory: d.subCategory,
    extraContentType: (d.mainCategory === "extraHomework" ? (d.isClass ? "class" : "homework") : undefined) as ExtraContentType | undefined,
    isClass: d.isClass, status: d.status,
    startDate: d.startDate || undefined, endDate: d.endDate || undefined,
    schedule: (d.weekdays.length || d.startTime || d.endTime) ? { weekdays: d.weekdays.length ? d.weekdays : undefined, startTime: d.startTime || undefined, endTime: d.endTime || undefined } : undefined,
    sortOrder: courses.length,
  });

  const save = async () => {
    if (!draft.name.trim()) return notify("请填写课程名称");
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
          <select value={draft.subCategory} onChange={(e) => set("subCategory", e.target.value)} className={field}>{subOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
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
const formatTime = (task: Task) => { const start = task.startTime ?? task.time; return start ? `${start}${task.endTime ? `-${task.endTime}` : ""}${task.estimatedMinutes ? `｜预计${task.estimatedMinutes}分钟` : ""}` : ""; };
function subjectTagClass(task: Task) { if (task.mainCategory === "readingPlan") return "bg-cyan-50 text-cyan-700"; if (task.mainCategory === "interestClass") return task.subCategory === "swimming" ? "bg-teal-50 text-teal-700" : task.subCategory === "rollerSkating" ? "bg-indigo-50 text-indigo-700" : "bg-fuchsia-50 text-fuchsia-700"; if (task.mainCategory === "temporary") return task.subCategory === "examCompetition" ? "bg-red-50 text-red-700" : task.subCategory === "travel" ? "bg-rose-50 text-rose-700" : "bg-stone-100 text-stone-600"; return task.subCategory === "chinese" ? "bg-pink-50 text-pink-700" : task.subCategory === "math" ? "bg-blue-50 text-blue-700" : task.subCategory === "english" ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-600"; }
function contentTagClass(task: Task) { return task.extraContentType === "class" ? "bg-mint text-primary" : task.extraContentType === "homework" ? "bg-orange-50 text-orange-700" : task.extraContentType === "practice" ? "bg-indigo-50 text-indigo-700" : task.extraContentType === "dictation" ? "bg-violet-50 text-violet-700" : task.extraContentType === "recitation" ? "bg-amber-50 text-amber-800" : "bg-stone-100 text-stone-600"; }
