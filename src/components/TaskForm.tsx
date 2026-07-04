import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { useEffect, useState, type FormEvent } from "react";
import { taskRepository } from "../data/taskRepository";
import { getRepository } from "../data/repositoryProvider";
import type { Course, ExtraContentType, MainCategory, PlanPeriod, RolloverMode, SchedulePattern, Task, TaskDraft, TaskStatus, TaskTimeType, WeeklyQuota } from "../types/task";
import { fromDateKey, getWeekStartKey, todayKey, toDateKey } from "../utils/date";
import { EXTRA_CONTENT_OPTIONS_SIMPLE, MAIN_CATEGORY_META, ROLLOVER_META, STATUS_META, SUB_CATEGORY_OPTIONS, TIME_TYPE_META, WEEKDAY_LABELS, defaultSortOrder, isCourseTask } from "../utils/taskMeta";

// "事项"分类或"上课"内容类型默认在月计划中显示，不受上次使用偏好影响
const forceCalendarVisible = (draft: Pick<TaskDraft, "mainCategory" | "subCategory" | "extraContentType">) =>
  draft.mainCategory === "temporary" || isCourseTask(draft);

interface Props { task?: Task; initialDate?: string; onClose: () => void; onSave: (draft: TaskDraft, force?: boolean) => Promise<void>; }
const PREF_KEY = "familyPlanner.taskFormPreferences.v1";

const defaults = (date: string): TaskDraft => ({
  title: "", mainCategory: "school", subCategory: "chinese", timeType: "singleDate", schedulePattern: "singleDate", date, calendarVisibility: "show",
  status: "todo", rolloverMode: "keepOverdue", allowRollover: false, childVisible: true, sortOrder: 0,
});

function newDraft(date: string): TaskDraft {
  const base = defaults(date);
  try {
    const saved = JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}") as Partial<TaskDraft>;
    const main = saved.mainCategory && saved.mainCategory !== "readingPlan" && MAIN_CATEGORY_META[saved.mainCategory] ? saved.mainCategory : base.mainCategory;
    const sub = SUB_CATEGORY_OPTIONS[main].some((item) => item.value === saved.subCategory) ? saved.subCategory! : SUB_CATEGORY_OPTIONS[main][0].value;
    const reading = main === "readingPlan";
    const timeType = reading ? "weekGoal" : (["singleDate", "dateRange", "weekGoal", "assignmentWindow", "recurring"].includes(saved.timeType ?? "") ? saved.timeType! : "singleDate");
    const extraContentType = main === "extraHomework" ? saved.extraContentType ?? "homework" : undefined;
    return {
      ...base, mainCategory: main, subCategory: sub, title: defaultTitle(main, sub, extraContentType), timeType,
      schedulePattern: reading ? "singleDate" : saved.schedulePattern ?? (timeType === "recurring" ? "weeklyRecurring" : "singleDate"),
      rolloverMode: saved.rolloverMode ?? base.rolloverMode, allowRollover: saved.allowRollover ?? base.allowRollover,
      childVisible: saved.childVisible ?? true, planPeriodId: saved.planPeriodId, applicablePeriodType: saved.applicablePeriodType ?? (saved.planPeriodId ? "holiday" : "all"),
      extraContentType,
      calendarVisibility: forceCalendarVisible({ mainCategory: main, subCategory: sub, extraContentType }) ? "show" : saved.calendarVisibility ?? "show",
      weekStart: timeType === "weekGoal" ? getWeekStartKey(date) : undefined,
      recurrence: timeType === "recurring" ? { frequency: "weekly", weekdays: [new Date(`${date}T00:00:00`).getDay()], startDate: date } : undefined,
      weeklyQuota: reading ? { enabled: true, targetCount: 1, unit: "本", isWeeklyRecurring: true, allowAutoDistribute: true, allowRollover: true } : undefined,
    };
  } catch { return base; }
}

const strip = (task: Task): TaskDraft => { const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...draft } = task; return { ...draft, date: normalizeDate(draft.date), startDate: normalizeDate(draft.startDate), endDate: normalizeDate(draft.endDate), weekStart: normalizeDate(draft.weekStart), recurrence: draft.recurrence ? { ...draft.recurrence, startDate: normalizeDate(draft.recurrence.startDate)!, endDate: normalizeDate(draft.recurrence.endDate) } : undefined, specificDates: draft.specificDates?.map((date) => normalizeDate(date)!).filter(Boolean) }; };

export function TaskForm({ task, initialDate = todayKey(), onClose, onSave }: Props) {
  const [draft, setDraft] = useState<TaskDraft>(task ? strip(task) : newDraft(initialDate));
  const [periods, setPeriods] = useState<PlanPeriod[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [titleTouched, setTitleTouched] = useState(!!task?.title);
  const [periodTouched, setPeriodTouched] = useState(!!task?.id);
  const [calendarVisibilityTouched, setCalendarVisibilityTouched] = useState(!!task);
  const [autoBoundHint, setAutoBoundHint] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingConflict, setPendingConflict] = useState<TaskDraft>();
  const [conflictTitle, setConflictTitle] = useState("");
  const [showMore, setShowMore] = useState(!!task);
  const set = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const input = "mt-1.5 w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-sage-500 focus:ring-2 focus:ring-sage-100";
  const label = "text-sm font-medium text-stone-600";

  useEffect(() => { taskRepository.listPlanPeriods().then(setPeriods); getRepository().listCourses().then(setCourses); const handler = (event: KeyboardEvent) => event.key === "Escape" && onClose(); window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, [onClose]);
  useEffect(() => { if (!calendarVisibilityTouched && forceCalendarVisible(draft) && draft.calendarVisibility !== "show") set("calendarVisibility", "show"); }, [draft.mainCategory, draft.subCategory, draft.extraContentType, calendarVisibilityTouched]);

  // 可选课程：进行中且在有效期内；编辑时始终保留已绑定的课程，避免结课后选项消失
  const selectableCourses = courses.filter((course) => {
    if (course.id === draft.courseId) return true;
    if (course.status !== "active") return false;
    const today = todayKey();
    if (course.startDate && course.startDate > today) return false;
    if (course.endDate && course.endDate < today) return false;
    return true;
  });
  // 选课后带出分类/上课/时间，并记录 courseId；选"不关联"则清除绑定
  const selectCourse = (courseId: string) => {
    if (!courseId) return set("courseId", undefined);
    const course = courses.find((item) => item.id === courseId);
    if (!course) return;
    setTitleTouched(true);
    setDraft((current) => ({
      ...current,
      courseId,
      mainCategory: course.mainCategory,
      subCategory: course.subCategory,
      extraContentType: course.mainCategory === "extraHomework" ? (course.isClass ? "class" : (["class", "homework"].includes(course.extraContentType ?? "") ? course.extraContentType : "homework")) : undefined,
      title: current.title.trim() ? current.title : course.name,
      sortOrder: defaultSortOrder(course.mainCategory, course.subCategory),
      startTime: course.schedule?.startTime ?? current.startTime,
      endTime: course.schedule?.endTime ?? current.endTime,
    }));
  };

  useEffect(() => {
    if (periodTouched || !periods.length) return;
    const holidays = periods.filter((p) => p.type === "holiday");
    if (!holidays.length) return;

    let targetHolidayId: string | undefined = undefined;
    let valid = false;
    let hint = "";

    if (draft.timeType === "singleDate" && draft.date) {
      const holiday = holidays.find((p) => draft.date! >= p.startDate && draft.date! <= p.endDate);
      if (holiday) { targetHolidayId = holiday.id; valid = true; hint = `已根据日期自动归属：${holiday.name}`; }
      else { valid = true; hint = ""; }
    } else if (draft.timeType === "recurring" && draft.schedulePattern === "specificDates" && draft.specificDates?.length) {
      const matchedHolidays = draft.specificDates.map((date) => holidays.find((p) => date >= p.startDate && date <= p.endDate));
      const first = matchedHolidays[0];
      const allSame = matchedHolidays.every((h) => h?.id === first?.id);
      if (allSame && first) { targetHolidayId = first.id; valid = true; hint = `已根据日期自动归属：${first.name}`; }
      else if (!allSame) { hint = "日期跨越平时和假期，请手动选择阶段"; }
      else { valid = true; hint = ""; }
    } else if ((draft.timeType === "dateRange" || (draft.timeType === "recurring" && ["dateRangeDaily", "dateRangeWeekdays"].includes(draft.schedulePattern ?? ""))) && draft.startDate && draft.endDate) {
      const startHoliday = holidays.find((p) => draft.startDate! >= p.startDate && draft.startDate! <= p.endDate);
      const endHoliday = holidays.find((p) => draft.endDate! >= p.startDate && draft.endDate! <= p.endDate);
      if (startHoliday && startHoliday.id === endHoliday?.id) { targetHolidayId = startHoliday.id; valid = true; hint = `已根据日期自动归属：${startHoliday.name}`; }
      else {
        const spansHoliday = holidays.some(h => draft.startDate! <= h.endDate && draft.endDate! >= h.startDate);
        if (startHoliday || endHoliday || spansHoliday) {
          hint = "日期跨越平时和假期，请手动选择阶段";
        } else {
          valid = true; hint = "";
        }
      }
    } else if (draft.timeType === "recurring" && ["dailyRecurring", "weeklyRecurring"].includes(draft.schedulePattern ?? "") && draft.recurrence?.startDate && draft.recurrence?.endDate) {
      const startHoliday = holidays.find((p) => draft.recurrence!.startDate! >= p.startDate && draft.recurrence!.startDate! <= p.endDate);
      const endHoliday = holidays.find((p) => draft.recurrence!.endDate! >= p.startDate && draft.recurrence!.endDate! <= p.endDate);
      if (startHoliday && startHoliday.id === endHoliday?.id) { targetHolidayId = startHoliday.id; valid = true; hint = `已根据日期自动归属：${startHoliday.name}`; }
      else {
        const spansHoliday = holidays.some(h => draft.recurrence!.startDate! <= h.endDate && draft.recurrence!.endDate! >= h.startDate);
        if (startHoliday || endHoliday || spansHoliday) {
          hint = "日期跨越平时和假期，请手动选择阶段";
        } else {
          valid = true; hint = "";
        }
      }
    } else if (draft.timeType === "weekGoal" && draft.weekStart) {
      const wStart = draft.weekStart;
      const wEnd = toDateKey(endOfWeek(fromDateKey(wStart), { weekStartsOn: 1 }));
      const startHoliday = holidays.find((p) => wStart >= p.startDate && wStart <= p.endDate);
      const endHoliday = holidays.find((p) => wEnd >= p.startDate && wEnd <= p.endDate);
      if (startHoliday && startHoliday.id === endHoliday?.id) { targetHolidayId = startHoliday.id; valid = true; hint = `已根据日期自动归属：${startHoliday.name}`; }
      else if (startHoliday || endHoliday) { hint = "日期跨越平时和假期，请手动选择阶段"; }
      else { valid = true; hint = ""; }
    } else if (draft.timeType === "assignmentWindow" && draft.assignmentWindow?.startDate && draft.assignmentWindow?.endDate) {
      const wStart = draft.assignmentWindow.startDate;
      const wEnd = draft.assignmentWindow.endDate;
      const startHoliday = holidays.find((p) => wStart >= p.startDate && wStart <= p.endDate);
      const endHoliday = holidays.find((p) => wEnd >= p.startDate && wEnd <= p.endDate);
      if (startHoliday && startHoliday.id === endHoliday?.id) { targetHolidayId = startHoliday.id; valid = true; hint = `已根据日期自动归属：${startHoliday.name}`; }
      else if (startHoliday || endHoliday) { hint = "日期跨越平时和假期，请手动选择阶段"; }
      else { valid = true; hint = ""; }
    }

    setAutoBoundHint(hint);
    if (valid) {
      setDraft((current) => {
        const nextPeriodId = targetHolidayId ?? undefined;
        let nextType = current.applicablePeriodType;
        if (targetHolidayId) nextType = "holiday";
        else if (current.applicablePeriodType === "holiday") nextType = "regular";
        if (current.planPeriodId === nextPeriodId && current.applicablePeriodType === nextType) return current;
        return { ...current, planPeriodId: nextPeriodId, applicablePeriodType: nextType };
      });
    }
  }, [draft.timeType, draft.schedulePattern, draft.date, draft.startDate, draft.endDate, draft.specificDates, draft.weekStart, draft.assignmentWindow, draft.recurrence, periods, periodTouched]);

  const changeMain = (mainCategory: MainCategory) => {
    const subCategory = SUB_CATEGORY_OPTIONS[mainCategory][0].value;
    const reading = mainCategory === "readingPlan";
    const auto = mainCategory === "extraHomework" || reading || subCategory === "pianoPractice";
    setDraft((current) => ({
      ...current, mainCategory, subCategory, courseId: undefined, title: titleTouched ? current.title : defaultTitle(mainCategory, subCategory, mainCategory === "extraHomework" ? "homework" : undefined),
      timeType: reading ? "weekGoal" : current.timeType, weekStart: reading ? getWeekStartKey(initialDate) : current.weekStart,
      schedulePattern: reading ? "singleDate" : current.schedulePattern, specificDates: reading ? undefined : current.specificDates,
      weeklyQuota: reading ? { enabled: true, targetCount: 1, unit: "本", isWeeklyRecurring: true, allowAutoDistribute: true, allowRollover: true } : undefined,
      extraContentType: mainCategory === "extraHomework" && subCategory !== "reading" ? "homework" : undefined,
      rolloverMode: auto ? "autoNextDay" : "keepOverdue", allowRollover: auto, sortOrder: defaultSortOrder(mainCategory, subCategory),
    }));
  };
  const changeSub = (subCategory: string) => {
    const auto = draft.mainCategory === "extraHomework" || draft.mainCategory === "readingPlan" || subCategory === "pianoPractice";
    const isReading = draft.mainCategory === "extraHomework" && subCategory === "reading";
    setDraft((current) => ({
      ...current, subCategory, courseId: undefined,
      extraContentType: isReading ? undefined : (draft.mainCategory === "extraHomework" ? (current.extraContentType ?? "homework") : current.extraContentType),
      title: isReading ? "" : (titleTouched ? current.title : defaultTitle(current.mainCategory, subCategory, current.extraContentType)),
      rolloverMode: auto ? "autoNextDay" : "keepOverdue", allowRollover: auto,
      sortOrder: defaultSortOrder(current.mainCategory, subCategory),
    }));
    if (isReading) setTitleTouched(false);
  };
  const changeExtraContent = (extraContentType: ExtraContentType) => {
    setDraft((current) => ({ ...current, extraContentType }));
  };
  const changeTimeType = (timeType: TaskTimeType) => setDraft((current) => ({
    ...current, timeType,
    schedulePattern: timeType === "recurring" ? current.schedulePattern === "singleDate" ? "weeklyRecurring" : current.schedulePattern : timeType === "dateRange" ? "dateRangeDaily" : "singleDate",
    date: timeType === "singleDate" ? current.date ?? initialDate : undefined,
    startDate: ["dateRange", "recurring"].includes(timeType) ? current.startDate ?? initialDate : undefined,
    endDate: ["dateRange", "recurring"].includes(timeType) ? current.endDate ?? initialDate : undefined,
    weekStart: timeType === "weekGoal" ? current.weekStart ?? getWeekStartKey(initialDate) : undefined,
    assignmentWindow: timeType === "assignmentWindow" ? current.assignmentWindow ?? { startDate: initialDate, endDate: initialDate } : undefined,
    recurrence: timeType === "recurring" ? current.recurrence ?? { frequency: "weekly", weekdays: [new Date(`${initialDate}T00:00:00`).getDay()], startDate: initialDate } : undefined,
  }));
  const changePattern = (schedulePattern: SchedulePattern) => setDraft((current) => ({
    ...current, schedulePattern,
    recurrence: schedulePattern === "weeklyRecurring" ? current.recurrence ?? { frequency: "weekly", weekdays: [1], startDate: initialDate } : schedulePattern === "dailyRecurring" ? { frequency: "daily", startDate: current.recurrence?.startDate ?? initialDate, endDate: current.recurrence?.endDate } : undefined,
    specificDates: schedulePattern === "specificDates" ? current.specificDates ?? [initialDate] : undefined,
    startDate: ["dateRangeDaily", "dateRangeWeekdays"].includes(schedulePattern) ? current.startDate ?? initialDate : current.startDate,
    endDate: ["dateRangeDaily", "dateRangeWeekdays"].includes(schedulePattern) ? current.endDate ?? initialDate : current.endDate,
  }));
  const toggleDays = (day: number, field: "allowedWeekdays" | "recurrence" | "rangeWeekdays") => {
    const values = field === "recurrence" ? draft.recurrence?.weekdays ?? [] : field === "rangeWeekdays" ? draft.rangeWeekdays ?? [] : draft.allowedWeekdays ?? [];
    const next = values.includes(day) ? values.filter((item) => item !== day) : [...values, day];
    if (field === "recurrence") set("recurrence", { ...draft.recurrence!, weekdays: next }); else set(field, next);
  };
  const updateQuota = (changes: Partial<WeeklyQuota>) => set("weeklyQuota", { enabled: true, targetCount: 1, unit: "本", isWeeklyRecurring: true, allowAutoDistribute: true, allowRollover: true, ...draft.weeklyQuota, ...changes });
  const addChecklist = () => set("checklistItems", [...(draft.checklistItems ?? []), { id: crypto.randomUUID(), title: "", done: false, sortOrder: draft.checklistItems?.length ?? 0 }]);
  const moveChecklist = (index: number, direction: -1 | 1) => { const items = [...(draft.checklistItems ?? [])]; const target = index + direction; if (target < 0 || target >= items.length) return; [items[index], items[target]] = [items[target], items[index]]; set("checklistItems", items.map((item, order) => ({ ...item, sortOrder: order }))); };

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError("");
    if (!draft.title.trim() && draft.mainCategory !== "interestClass" && !(draft.mainCategory === "extraHomework" && draft.subCategory === "reading")) return setError("请填写任务标题");
    if (draft.endTime && (!draft.startTime || draft.endTime <= draft.startTime)) return setError("结束时间必须晚于开始时间");
    if ((draft.timeType === "dateRange" || (draft.timeType === "recurring" && ["dateRangeDaily", "dateRangeWeekdays"].includes(draft.schedulePattern ?? ""))) && (!draft.startDate || !draft.endDate || draft.startDate > draft.endDate)) return setError("日期范围不正确");
    if (draft.timeType === "recurring" && draft.schedulePattern === "specificDates" && !draft.specificDates?.length) return setError("请至少填写一个指定日期");
    if (draft.timeType === "recurring" && draft.schedulePattern === "weeklyRecurring" && !draft.recurrence?.weekdays?.length) return setError("请至少选择一个重复星期");
    if (draft.timeType === "assignmentWindow" && (!draft.assignmentWindow?.startDate || !draft.assignmentWindow.endDate || draft.assignmentWindow.startDate > draft.assignmentWindow.endDate)) return setError("作业周期不正确");
    setSaving(true);
    const normalizedWeek = normalizeDate(draft.weekStart);
    const cleaned = { ...draft, title: draft.title.trim(), checklistItems: draft.checklistItems?.filter((item) => item.title.trim()).map((item, index) => ({ ...item, title: item.title.trim(), sortOrder: index })), weekStart: normalizedWeek ? getWeekStartKey(normalizedWeek) : undefined };
    try {
      await onSave(cleaned);
      if (!task) localStorage.setItem(PREF_KEY, JSON.stringify({ mainCategory: draft.mainCategory, subCategory: draft.subCategory, extraContentType: draft.extraContentType, timeType: draft.timeType, schedulePattern: draft.schedulePattern, rolloverMode: draft.rolloverMode, allowRollover: draft.allowRollover, childVisible: draft.childVisible, calendarVisibility: draft.calendarVisibility, planPeriodId: draft.planPeriodId, applicablePeriodType: draft.applicablePeriodType }));
      onClose();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "保存失败";
      if (message.startsWith("TIME_CONFLICT:")) { setPendingConflict(cleaned); setConflictTitle(message.slice("TIME_CONFLICT:".length)); setError(""); }
      else setError(message);
      setSaving(false);
    }
  };

  // 切换到非单日类型时自动展开更多设置
  useEffect(() => { if (draft.timeType !== 'singleDate') setShowMore(true); }, [draft.timeType]);

  const reading = draft.mainCategory === "readingPlan";
  const homework = draft.mainCategory === "school" || draft.mainCategory === "extraHomework";
  const recurring = draft.timeType === "recurring";
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 backdrop-blur-sm sm:items-center sm:p-5" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form onSubmit={submit} className="max-h-[95vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-paper shadow-2xl sm:rounded-3xl">
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-paper/95 px-5 py-4 backdrop-blur sm:px-7"><div><p className="text-xs font-semibold tracking-widest text-sage-700">{task ? "编辑任务" : "新建任务"}</p><h2 className="mt-1 text-xl font-semibold">{task?.title ?? "添加一项安排"}</h2></div><button type="button" aria-label="关闭" onClick={onClose} className="rounded-full bg-white p-2 text-stone-500"><X className="h-5 w-5" /></button></header>
    <div className="space-y-5 px-5 py-6 sm:px-7">

      {/* ── 快速区 ── */}
      {selectableCourses.length > 0 && <label className={label}>选择课程（可选）<select value={draft.courseId ?? ""} onChange={(e) => selectCourse(e.target.value)} className={input}><option value="">不关联课程（自由输入）</option>{selectableCourses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select><span className="mt-1 block text-xs text-stone-400">选择课程会自动带出分类与上课时间；改动下方分类会解除绑定</span></label>}

      <div><p className={label}>分类</p><div className="mt-1.5 flex flex-wrap gap-2">{Object.entries(MAIN_CATEGORY_META).filter(([value]) => value !== "readingPlan").map(([value, meta]) => <button key={value} type="button" onClick={() => changeMain(value as MainCategory)} className={`rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${meta.className} ${draft.mainCategory === value ? "ring-2 ring-current shadow-sm" : "opacity-60 hover:opacity-90"}`}>{meta.label}</button>)}</div></div>

      <label className={label}>二级类型<select value={draft.subCategory} onChange={(e) => changeSub(e.target.value)} className={input}>{SUB_CATEGORY_OPTIONS[draft.mainCategory].map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>

      {draft.mainCategory === "extraHomework" && draft.subCategory !== "reading" && <label className={label}>内容类型<select value={draft.extraContentType ?? "homework"} onChange={(e) => changeExtraContent(e.target.value as ExtraContentType)} className={input}>{EXTRA_CONTENT_OPTIONS_SIMPLE.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>}

      <label className={label}>任务标题{draft.mainCategory === "interestClass" || (draft.mainCategory === "extraHomework" && draft.subCategory === "reading") ? "（可选）" : " *"}<input autoFocus value={draft.title} onChange={(e) => { setTitleTouched(true); setDraft((current) => ({ ...current, title: e.target.value })); }} className={input} placeholder={draft.mainCategory === "interestClass" || (draft.mainCategory === "extraHomework" && draft.subCategory === "reading") ? "可留空，填写时用于补充具体内容" : "输入具体任务内容"} /></label>

      {draft.timeType === "singleDate" && <DateField title="日期" value={draft.date} onChange={(value) => set("date", value)} input={input} label={label} required />}

      {/* ── 更多设置折叠区 ── */}
      <button type="button" onClick={() => setShowMore((v) => !v)} className="flex w-full items-center justify-between rounded-xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm font-medium text-stone-600 hover:bg-stone-100"><span>更多设置</span><span className="text-stone-400">{showMore ? "▴" : "▾"}</span></button>

      {showMore && <div className="space-y-5 rounded-2xl border border-stone-100 bg-stone-50/50 px-4 py-5">
        {!reading && <label className={label}>任务类型<select value={draft.timeType} onChange={(e) => changeTimeType(e.target.value as TaskTimeType)} className={input}>{(["singleDate", "dateRange", "recurring", ...(task && ["weekGoal", "assignmentWindow"].includes(task.timeType) ? [task.timeType] : [])] as TaskTimeType[]).filter((value, index, values) => values.indexOf(value) === index).map((value) => <option key={value} value={value}>{value === "recurring" ? "固定 / 集中课程" : TIME_TYPE_META[value]}</option>)}</select></label>}
        {reading && <div className="rounded-xl bg-cyan-50 px-4 py-3 text-sm font-medium text-cyan-800">每周目标（周一到周日任意完成，不绑定固定星期）</div>}
        {draft.timeType === "dateRange" && <DateRange draft={draft} set={set} input={input} label={label} />}
        {draft.timeType === "weekGoal" && <DateField title="首次执行周" value={draft.weekStart} onChange={(value) => set("weekStart", value)} input={input} label={label} required />}
        {draft.timeType === "assignmentWindow" && <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4"><p className="mb-3 text-sm font-semibold">课后作业周期</p><div className="grid gap-3 sm:grid-cols-3"><DateField title="来源课程" value={draft.assignmentWindow?.sourceClassDate} onChange={(value) => set("assignmentWindow", { ...draft.assignmentWindow!, sourceClassDate: value })} input={input} label={label} /><DateField title="开始" value={draft.assignmentWindow?.startDate} onChange={(value) => set("assignmentWindow", { ...draft.assignmentWindow!, startDate: value })} input={input} label={label} /><DateField title="截止" value={draft.assignmentWindow?.endDate} onChange={(value) => set("assignmentWindow", { ...draft.assignmentWindow!, endDate: value })} input={input} label={label} /></div></div>}
        {recurring && <div className="rounded-2xl border border-violet-100 bg-violet-50/40 p-4"><label className={label}>安排方式<select value={draft.schedulePattern ?? "weeklyRecurring"} onChange={(e) => changePattern(e.target.value as SchedulePattern)} className={input}><option value="dailyRecurring">每日重复</option><option value="weeklyRecurring">每周固定</option><option value="specificDates">指定日期列表</option><option value="dateRangeDaily">日期范围内每天</option><option value="dateRangeWeekdays">日期范围内按星期</option></select></label>{["dailyRecurring", "weeklyRecurring"].includes(draft.schedulePattern ?? "") && <><div className="grid grid-cols-2 gap-3"><DateField title="开始日期" value={draft.recurrence?.startDate} onChange={(value) => set("recurrence", { ...draft.recurrence!, startDate: value })} input={input} label={label} /><DateField title="结束日期（可空）" value={draft.recurrence?.endDate} onChange={(value) => set("recurrence", { ...draft.recurrence!, endDate: value || undefined })} input={input} label={label} /></div>{draft.schedulePattern === "weeklyRecurring" && <WeekdayPicker values={draft.recurrence?.weekdays ?? []} onToggle={(day) => toggleDays(day, "recurrence")} />}</>}{draft.schedulePattern === "specificDates" && <MultiDatePicker values={draft.specificDates ?? []} onChange={(values) => set("specificDates", values)} initialDate={initialDate} />}{["dateRangeDaily", "dateRangeWeekdays"].includes(draft.schedulePattern ?? "") && <DateRange draft={draft} set={set} input={input} label={label} />}{draft.schedulePattern === "dateRangeWeekdays" && <WeekdayPicker values={draft.rangeWeekdays ?? []} onToggle={(day) => toggleDays(day, "rangeWeekdays")} title="范围内星期" />}</div>}
        {reading && <div className="rounded-2xl border border-cyan-100 bg-cyan-50/40 p-4"><div className="grid grid-cols-2 gap-3"><label className={label}>每周目标<input type="number" min="1" value={draft.weeklyQuota?.targetCount ?? 1} onChange={(e) => updateQuota({ targetCount: Number(e.target.value) || 1 })} className={input} /></label><label className={label}>单位<select value={draft.weeklyQuota?.unit ?? "本"} onChange={(e) => updateQuota({ unit: e.target.value as WeeklyQuota["unit"] })} className={input}>{["本", "页", "分钟", "次", "篇"].map((unit) => <option key={unit}>{unit}</option>)}</select></label></div><div className="mt-3 grid gap-2 text-sm"><Check label="是否每周执行" checked={draft.weeklyQuota?.isWeeklyRecurring ?? true} onChange={(value) => updateQuota({ isWeeklyRecurring: value })} /><Check label="允许一键下发到每天" checked={draft.weeklyQuota?.allowAutoDistribute ?? true} onChange={(value) => updateQuota({ allowAutoDistribute: value })} /><Check label="未完成允许顺延（仅限当周）" checked={draft.weeklyQuota?.allowRollover ?? true} onChange={(value) => { updateQuota({ allowRollover: value }); set("allowRollover", value); }} /></div></div>}
        {!reading && ["weekGoal", "assignmentWindow"].includes(draft.timeType) && <div className="rounded-2xl border bg-white p-4"><p className="mb-3 text-sm font-semibold">自动分配设置</p><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><NumberField label="总量" value={draft.totalAmount} onChange={(value) => set("totalAmount", value)} input={input} /><label className={label}>单位<input value={draft.amountUnit ?? ""} onChange={(e) => set("amountUnit", e.target.value)} className={input} /></label><NumberField label="分几次" value={draft.splitCount} onChange={(value) => set("splitCount", value)} input={input} /><NumberField label="每次数量" value={draft.amountPerSession} onChange={(value) => set("amountPerSession", value)} input={input} /></div><WeekdayPicker values={draft.allowedWeekdays ?? []} onToggle={(day) => toggleDays(day, "allowedWeekdays")} title="可安排星期（不选表示每天）" /></div>}
        <div className="grid gap-4 sm:grid-cols-2"><label className={label}>适用阶段<select value={draft.applicablePeriodType === "regular" ? "regular" : draft.planPeriodId ?? "all"} onChange={(e) => { const value = e.target.value; setPeriodTouched(true); setAutoBoundHint(""); setDraft((current) => ({ ...current, applicablePeriodType: value === "all" ? "all" : value === "regular" ? "regular" : "holiday", planPeriodId: value === "all" || value === "regular" ? undefined : value })); }} className={input}><option value="all">全部阶段</option><option value="regular">平时（假期外自动适用）</option>{periods.filter((period) => period.type === "holiday").map((period) => <option key={period.id} value={period.id}>{period.name}</option>)}</select>{autoBoundHint && <div className="mt-1.5 text-xs text-sage-600">{autoBoundHint}</div>}</label><label className={label}>未完成处理<select value={draft.rolloverMode} onChange={(e) => { const mode = e.target.value as RolloverMode; set("rolloverMode", mode); set("allowRollover", mode === "autoNextDay"); }} className={input}>{Object.entries(ROLLOVER_META).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label></div>
        <div className="grid gap-4 sm:grid-cols-3"><label className={label}>开始时间（可选）<input type="time" value={draft.startTime ?? ""} onChange={(e) => { const startTime = e.target.value || undefined; setDraft((current) => ({ ...current, startTime, endTime: startTime && current.estimatedMinutes ? addMinutesToTime(startTime, current.estimatedMinutes) : current.endTime })); }} className={input} /></label><label className={label}>预计时长（分钟）<input type="number" min="1" step="1" inputMode="numeric" value={draft.estimatedMinutes ?? ""} onChange={(e) => { const raw = Number(e.target.value); const estimatedMinutes = Number.isInteger(raw) && raw > 0 ? raw : undefined; setDraft((current) => ({ ...current, estimatedMinutes, endTime: current.startTime && estimatedMinutes ? addMinutesToTime(current.startTime, estimatedMinutes) : current.endTime })); }} className={input} placeholder="任意正整数" /></label><label className={label}>结束时间（可选）<input type="time" value={draft.endTime ?? ""} onChange={(e) => set("endTime", e.target.value || undefined)} className={input} /></label></div>
        {homework && <div className="rounded-2xl border border-blue-100 bg-blue-50/30 p-4"><div className="mb-3 flex justify-between"><p className="text-sm font-semibold">任务小项</p><button type="button" onClick={addChecklist} className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs"><Plus className="h-3.5 w-3.5" />添加</button></div><div className="space-y-2">{draft.checklistItems?.map((item, index) => <div key={item.id} className="flex gap-2"><input value={item.title} onChange={(e) => set("checklistItems", draft.checklistItems?.map((value) => value.id === item.id ? { ...value, title: e.target.value } : value))} className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm" placeholder="小项内容" /><input type="number" min="1" step="1" inputMode="numeric" value={item.estimatedMinutes ?? ""} onChange={(e) => { const raw = parseInt(e.target.value, 10); set("checklistItems", draft.checklistItems?.map((value) => value.id === item.id ? { ...value, estimatedMinutes: raw > 0 ? raw : undefined } : value)); }} className="w-16 shrink-0 rounded-lg border px-2 py-2 text-center text-sm" placeholder="分钟" title="预估用时（分钟）" /><button type="button" onClick={() => moveChecklist(index, -1)}><ArrowUp className="h-4 w-4" /></button><button type="button" onClick={() => moveChecklist(index, 1)}><ArrowDown className="h-4 w-4" /></button><button type="button" onClick={() => set("checklistItems", draft.checklistItems?.filter((value) => value.id !== item.id))}><Trash2 className="h-4 w-4 text-rose-400" /></button></div>)}</div><p className="mt-2 text-[11px] text-stone-400">小项旁的数字框可填写预估用时（分钟，可选）</p></div>}
        <label className={label}>备注<textarea rows={2} value={draft.note ?? ""} onChange={(e) => set("note", e.target.value)} className={input} /></label>
        <div className="flex flex-wrap gap-4 rounded-2xl bg-white p-4"><Check label="显示在今日清单" checked={draft.childVisible} onChange={(value) => set("childVisible", value)} /><Check label="在月计划中显示" checked={draft.calendarVisibility !== "hide"} onChange={(value) => { setCalendarVisibilityTouched(true); setDraft((current) => ({ ...current, calendarVisibility: value ? "show" : "hide", ...(!value ? { rolloverMode: "skipIfMissed" as const, allowRollover: false } : {}) })); }} /><Check label="显示计时器" checked={draft.enableTimer === true} onChange={(value) => set("enableTimer", value)} /><label className={label}>状态<select value={draft.status} onChange={(e) => set("status", e.target.value as TaskStatus)} className="ml-2 rounded-lg border px-2 py-1">{Object.entries(STATUS_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label></div>
      </div>}

      {pendingConflict && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><p>该时间与已有任务"{conflictTitle}"重叠，是否仍然添加？</p><div className="mt-3 flex gap-2"><button type="button" onClick={() => setPendingConflict(undefined)} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5">返回修改</button><button type="button" onClick={async () => { setSaving(true); try { await onSave(pendingConflict, true); onClose(); } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); setSaving(false); } }} className="rounded-lg bg-primary px-3 py-1.5 font-semibold text-white">仍然添加</button></div></div>}
      {error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
    </div>
    <footer className="sticky bottom-0 flex justify-end gap-3 border-t bg-paper/95 px-5 py-4"><button type="button" onClick={onClose} className="rounded-xl px-5 py-2.5 text-sm">取消</button><button disabled={saving} className="rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "保存中…" : "保存任务"}</button></footer>
  </form></div>;
}

function DateRange({ draft, set, input, label }: { draft: TaskDraft; set: <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => void; input: string; label: string }) { return <div className="grid grid-cols-2 gap-3"><DateField title="开始日期" value={draft.startDate} onChange={(value) => set("startDate", value)} input={input} label={label} /><DateField title="结束日期" value={draft.endDate} onChange={(value) => set("endDate", value)} input={input} label={label} /></div>; }
function MultiDatePicker({ values, onChange, initialDate }: { values: string[]; onChange: (values: string[]) => void; initialDate: string }) {
  const [month, setMonth] = useState(fromDateKey(values[0] ?? initialDate));
  const [cursor, setCursor] = useState(values.at(-1) ?? initialDate);
  const [advanced, setAdvanced] = useState("");
  const days = eachDayOfInterval({ start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }) });
  const toggle = (key: string) => { setCursor(key); onChange(values.includes(key) ? values.filter((value) => value !== key) : [...values, key].sort()); };
  const moveCursor = (days: number) => { const next = toDateKey(addDays(fromDateKey(cursor), days)); const nextValues = values.includes(cursor) ? [...values.filter((value) => value !== cursor), next].sort() : values; setCursor(next); setMonth(fromDateKey(next)); onChange([...new Set(nextValues)]); };
  const parseAdvanced = () => { const parsed = advanced.split(/[\s,，;；]+/).map((value) => value.trim().replaceAll("/", "-")).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)); onChange([...new Set([...values, ...parsed])].sort()); setAdvanced(""); };
  return <div className="mt-4 rounded-xl border border-violet-100 bg-white p-3"><div className="flex items-center justify-between"><button type="button" onClick={() => setMonth(addMonths(month, -1))} className="rounded-lg px-3 py-1 text-sm">‹</button><span className="text-sm font-semibold">{format(month, "yyyy年M月")}</span><button type="button" onClick={() => setMonth(addMonths(month, 1))} className="rounded-lg px-3 py-1 text-sm">›</button></div><div className="mt-2 grid grid-cols-7 gap-1">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day} className="py-1 text-center text-[10px] text-stone-400">{day}</span>)}{days.map((day) => { const key = toDateKey(day); const selected = values.includes(key); return <button type="button" key={key} aria-label={`选择日期 ${key}`} onClick={() => toggle(key)} className={`rounded-lg py-1.5 text-xs ${selected ? "bg-violet-600 text-white" : key === cursor ? "ring-1 ring-violet-400" : isSameMonth(day, month) ? "hover:bg-violet-50" : "text-stone-300"}`}>{day.getDate()}</button>; })}</div><div className="mt-3 flex items-center justify-between rounded-lg bg-violet-50/60 p-1.5 text-xs"><button type="button" onClick={() => moveCursor(-1)} className="rounded-md bg-white px-3 py-1.5">前一天</button><span className="text-violet-700">{cursor}</span><button type="button" onClick={() => moveCursor(1)} className="rounded-md bg-white px-3 py-1.5">后一天</button></div>{values.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{values.map((value) => <button type="button" key={value} onClick={() => toggle(value)} className="rounded-full bg-violet-50 px-2 py-1 text-[11px] text-violet-700">{value} ×</button>)}</div>}<details className="mt-3"><summary className="cursor-pointer text-xs text-stone-400">粘贴输入 / 高级输入</summary><div className="mt-2 flex gap-2"><textarea value={advanced} onChange={(e) => setAdvanced(e.target.value)} placeholder="支持逗号、分号、空格或换行" className="min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-xs" /><button type="button" onClick={parseAdvanced} className="rounded-lg bg-stone-100 px-3 text-xs">添加</button></div></details></div>;
}
function DateField({ title, value, onChange, input, label, required }: { title: string; value?: string; onChange: (value: string) => void; input: string; label: string; required?: boolean }) { const move = (days: number) => onChange(toDateKey(addDays(fromDateKey(value || todayKey()), days))); return <label className={label}>{title}<input required={required} type="date" value={value ?? ""} onChange={(event) => onChange(event.target.value)} className={input} /><span className="mt-1.5 grid grid-cols-2 gap-2"><button type="button" onClick={() => move(-1)} className="rounded-lg bg-stone-100 px-2 py-1.5 text-xs text-stone-600">前一天</button><button type="button" onClick={() => move(1)} className="rounded-lg bg-stone-100 px-2 py-1.5 text-xs text-stone-600">后一天</button></span></label>; }
function WeekdayPicker({ values, onToggle, title = "重复星期" }: { values: number[]; onToggle: (day: number) => void; title?: string }) { return <div className="mt-3"><p className="mb-2 text-xs text-stone-500">{title}</p><div className="flex flex-wrap gap-2">{[1, 2, 3, 4, 5, 6, 0].map((day) => <button type="button" key={day} onClick={() => onToggle(day)} className={`rounded-lg px-2.5 py-1.5 text-xs ${values.includes(day) ? "bg-primary text-white" : "bg-stone-100 text-stone-500"}`}>{WEEKDAY_LABELS[day].replace("周", "")}</button>)}</div></div>; }
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-600"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded" />{label}</label>; }
function NumberField({ label, value, onChange, input }: { label: string; value?: number; onChange: (value?: number) => void; input: string }) { return <label className="text-sm font-medium text-stone-600">{label}<input type="number" min="1" value={value ?? ""} onChange={(e) => onChange(Number(e.target.value) || undefined)} className={input} /></label>; }
function defaultTitle(main: MainCategory, sub: string, extraContentType?: ExtraContentType) {
  if (main !== "extraHomework") return "";
  if (extraContentType === "class") return ({ chinese: "大增语文课", math: "奥数课", english: "FCE精讲" } as Record<string, string>)[sub] ?? "";
  if (sub === "english" && extraContentType === "dictation") return "英语听写";
  if (sub === "chinese" && extraContentType === "recitation") return "语文背诵";
  return "";
}
const normalizeDate = (value?: string) => value?.replaceAll("/", "-");
function addMinutesToTime(time: string, minutes: number) { const [hour, minute] = time.split(":").map(Number); const total = hour * 60 + minute + minutes; return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; }
