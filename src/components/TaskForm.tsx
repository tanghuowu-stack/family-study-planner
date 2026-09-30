import { ArrowDown, ArrowUp, ChevronDown, Plus, Trash2, X } from "lucide-react";
import { addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { useEffect, useState, type FormEvent } from "react";
import { taskRepository } from "../data/taskRepository";
import { getRepository } from "../data/repositoryProvider";
import { loadCustomTaskCategories, saveCustomTaskCategories, type CustomTaskCategories } from "../data/appSettingsRepository";
import type { Course, ExtraContentType, MainCategory, PlanPeriod, SchedulePattern, Task, TaskDisplay, TaskDraft, TaskStatus, TaskTimeType, WeeklyQuota } from "../types/task";
import { fromDateKey, getWeekStartKey, todayKey, toDateKey } from "../utils/date";
import { EXTRA_CONTENT_OPTIONS_SIMPLE, MAIN_CATEGORY_META, STATUS_META, SUB_CATEGORY_OPTIONS, TIME_TYPE_META, WEEKDAY_LABELS, courseOptionLabel, customSubCategoryValue, defaultSortOrder, interestContentType, isCourseTask, isCustomSubCategory, isOccurrenceSchedule, isValidSubCategory, subCategoryLabel } from "../utils/taskMeta";

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
    const sub = (SUB_CATEGORY_OPTIONS[main].some((item) => item.value === saved.subCategory) || isCustomSubCategory(saved.subCategory ?? "")) ? saved.subCategory! : SUB_CATEGORY_OPTIONS[main][0].value;
    const reading = main === "readingPlan";
    const timeType = reading ? "weekGoal" : (["singleDate", "dateRange", "weekGoal", "assignmentWindow", "recurring"].includes(saved.timeType ?? "") ? saved.timeType! : "singleDate");
    const extraContentType = main === "extraHomework" ? saved.extraContentType ?? "homework"
      : main === "interestClass" && (sub === "otherInterest" || isCustomSubCategory(sub)) ? interestContentType(saved.extraContentType === "class") : undefined;
    const schedulePattern = reading ? "singleDate" : saved.schedulePattern ?? (timeType === "recurring" ? "weeklyRecurring" : "singleDate");
    return {
      ...base, mainCategory: main, subCategory: sub, title: defaultTitle(main, sub, extraContentType), timeType,
      schedulePattern,
      rolloverMode: saved.rolloverMode ?? base.rolloverMode, allowRollover: saved.allowRollover ?? base.allowRollover,
      childVisible: saved.childVisible ?? true, planPeriodId: saved.planPeriodId, applicablePeriodType: saved.applicablePeriodType ?? (saved.planPeriodId ? "holiday" : "all"),
      extraContentType,
      calendarVisibility: forceCalendarVisible({ mainCategory: main, subCategory: sub, extraContentType }) ? "show" : saved.calendarVisibility ?? "show",
      weekStart: timeType === "weekGoal" ? getWeekStartKey(date) : undefined,
      recurrence: timeType === "recurring"
        ? schedulePattern === "weeklyRecurring" ? { frequency: "weekly", weekdays: [new Date(`${date}T00:00:00`).getDay()], startDate: date }
        : schedulePattern === "dailyRecurring" ? { frequency: "daily", startDate: date }
        : undefined
        : undefined,
      weeklyQuota: reading ? { enabled: true, targetCount: 1, unit: "本", isWeeklyRecurring: true, allowAutoDistribute: true, allowRollover: true } : undefined,
    };
  } catch { return base; }
}

// R3：编辑入口可能传入 TaskDisplay（今日清单里的行），它的 status 已被覆盖成当天单日状态，
// 且带着 occurrenceDate 等运行时展示字段——这些一律不得进入保存的草稿（数据层写入口还有一道兜底清洗）。
const strip = (task: Task): TaskDraft => { const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, occurrenceDate: _od, occurrenceStatus: _os, overrideDate: _ovd, overrideNote: _ovn, rolledFromDate: _rf, ...draft } = task as Task & Partial<TaskDisplay>; return { ...draft, date: normalizeDate(draft.date), startDate: normalizeDate(draft.startDate), endDate: normalizeDate(draft.endDate), weekStart: normalizeDate(draft.weekStart), recurrence: draft.recurrence ? { ...draft.recurrence, startDate: normalizeDate(draft.recurrence.startDate)!, endDate: normalizeDate(draft.recurrence.endDate) } : undefined, specificDates: draft.specificDates?.map((date) => normalizeDate(date)!).filter(Boolean) }; };

export function TaskForm({ task, initialDate = todayKey(), onClose, onSave }: Props) {
  const [draft, setDraft] = useState<TaskDraft>(task ? strip(task) : newDraft(initialDate));
  const [periods, setPeriods] = useState<PlanPeriod[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [titleTouched, setTitleTouched] = useState(!!task?.title);
  const [periodTouched, setPeriodTouched] = useState(!!task?.id);
  const [calendarVisibilityTouched, setCalendarVisibilityTouched] = useState(!!task);
  const [autoBoundHint, setAutoBoundHint] = useState("");
  const [customCategories, setCustomCategories] = useState<CustomTaskCategories>({});
  const [addingCategory, setAddingCategory] = useState(false);
  const [customCategoryName, setCustomCategoryName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingConflict, setPendingConflict] = useState<TaskDraft>();
  const [conflictTitle, setConflictTitle] = useState("");
  const [showMore, setShowMore] = useState(false);
  const set = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const input = "mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/10";
  const detailInput = "mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/10";
  const label = "text-xs font-bold uppercase tracking-wide text-muted";

  useEffect(() => { taskRepository.listPlanPeriods().then(setPeriods); getRepository().listCourses().then(setCourses); loadCustomTaskCategories().then(setCustomCategories); const handler = (event: KeyboardEvent) => event.key === "Escape" && onClose(); window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, [onClose]);
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
      // 兴趣班课程：课程勾了"算作上课"，绑定的任务就记为上课（钢琴/游泳/轮滑不依赖这个标记也算上课）
      extraContentType: course.mainCategory === "extraHomework" ? (course.isClass ? "class" : (["class", "homework"].includes(course.extraContentType ?? "") ? course.extraContentType : "homework"))
        : course.mainCategory === "interestClass" ? interestContentType(course.isClass) : undefined,
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
    // 切换分类后二级类型置空、必须手动选择，不静默落到第一项（选中后由 changeSub 补齐标题/顺延/排序）
    const subCategory = "";
    const reading = mainCategory === "readingPlan";
    const auto = mainCategory === "extraHomework" || reading;
    setAddingCategory(false);
    setCustomCategoryName("");
    setDraft((current) => ({
      ...current, mainCategory, subCategory, courseId: undefined, title: titleTouched ? current.title : "",
      timeType: reading ? "weekGoal" : current.timeType, weekStart: reading ? getWeekStartKey(initialDate) : current.weekStart,
      schedulePattern: reading ? "singleDate" : current.schedulePattern, specificDates: reading ? undefined : current.specificDates,
      weeklyQuota: reading ? { enabled: true, targetCount: 1, unit: "本", isWeeklyRecurring: true, allowAutoDistribute: true, allowRollover: true } : undefined,
      extraContentType: mainCategory === "extraHomework" ? "homework" : undefined,
      rolloverMode: auto ? "autoNextDay" : "keepOverdue", allowRollover: auto, sortOrder: defaultSortOrder(mainCategory, subCategory),
    }));
  };
  const changeSub = (subCategory: string) => {
    const auto = draft.mainCategory === "extraHomework" || draft.mainCategory === "readingPlan" || subCategory === "pianoPractice";
    const isReading = draft.mainCategory === "extraHomework" && subCategory === "reading";
    setDraft((current) => ({
      ...current, subCategory, courseId: undefined,
      // 兴趣班：只有"其他兴趣班"用任务级"算作上课"标记（默认勾上）；换到其他二级类型必须清掉，
      // 否则钢琴练习会带着残留的 class 标记被算成上课
      extraContentType: isReading ? undefined
        : draft.mainCategory === "extraHomework" ? (current.extraContentType ?? "homework")
        : draft.mainCategory === "interestClass" ? (["otherInterest"].includes(subCategory) || isCustomSubCategory(subCategory) ? interestContentType(true) : undefined)
        : current.extraContentType,
      title: isReading ? "" : (titleTouched ? current.title : defaultTitle(current.mainCategory, subCategory, current.extraContentType)),
      rolloverMode: auto ? "autoNextDay" : "keepOverdue", allowRollover: auto,
      sortOrder: defaultSortOrder(current.mainCategory, subCategory),
    }));
    if (isReading) setTitleTouched(false);
  };
  const changeExtraContent = (extraContentType: ExtraContentType) => {
    setDraft((current) => ({ ...current, extraContentType }));
  };
  const addCustomCategory = async () => {
    const label = customCategoryName.trim();
    if (!label || draft.mainCategory === "readingPlan") return;
    const existing = customCategories[draft.mainCategory] ?? [];
    const staticDuplicate = SUB_CATEGORY_OPTIONS[draft.mainCategory].some((item) => item.label === label);
    if (staticDuplicate || existing.some((item) => item.label === label)) return setError("这个分类已经存在");
    const item = { value: customSubCategoryValue(label), label };
    const next = { ...customCategories, [draft.mainCategory]: [...existing, item] };
    setCustomCategories(next);
    setCustomCategoryName("");
    setAddingCategory(false);
    changeSub(item.value);
    try { await saveCustomTaskCategories(next); } catch (reason) { setError(reason instanceof Error ? reason.message : "保存自定义分类失败"); }
  };
  const changeTimeType = (timeType: TaskTimeType) => setDraft((current) => ({
    ...current, timeType,
    schedulePattern: timeType === "recurring" ? current.schedulePattern === "singleDate" ? "weeklyRecurring" : current.schedulePattern : "singleDate",
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
    // 切换分类后未选二级类型（空值）一律拦下；编辑历史任务时放行旧版遗留的二级类型值，避免连改都改不了
    if (!draft.subCategory || (!task && !isValidSubCategory(draft.mainCategory, draft.subCategory))) return setError("请选择二级类型");
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

  const reading = draft.mainCategory === "readingPlan";
  const homework = draft.mainCategory === "school" || draft.mainCategory === "extraHomework";
  const recurring = draft.timeType === "recurring";
  const customSubCategories = draft.mainCategory === "readingPlan" ? [] : customCategories[draft.mainCategory] ?? [];
  const subCategoryOptions = [...SUB_CATEGORY_OPTIONS[draft.mainCategory], ...customSubCategories];
  if (draft.subCategory && !subCategoryOptions.some((item) => item.value === draft.subCategory)) {
    subCategoryOptions.push({ value: draft.subCategory, label: subCategoryLabel(draft.mainCategory, draft.subCategory) });
  }
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 backdrop-blur-sm sm:items-center sm:p-5" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form onSubmit={submit} className="max-h-[96vh] w-full max-w-2xl overflow-y-auto rounded-t-lg bg-paper shadow-2xl sm:rounded-lg">
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-ink px-5 py-4 text-white sm:px-7"><h2 className="text-xl font-bold">{task ? "编辑任务" : "添加任务"}</h2><button type="button" aria-label="关闭" onClick={onClose} className="rounded-lg bg-white/10 p-2 text-white/70 hover:bg-white/15 hover:text-white"><X className="h-5 w-5" /></button></header>
    <div className="space-y-5 px-5 py-6 sm:px-7 sm:py-7">

      {/* ── 快速区 ── */}
      {selectableCourses.length > 0 && <label className={label}>关联课程<select value={draft.courseId ?? ""} onChange={(e) => selectCourse(e.target.value)} className={input}><option value="">不关联</option>{selectableCourses.map((course) => <option key={course.id} value={course.id}>{courseOptionLabel(course, selectableCourses)}</option>)}</select></label>}

      <div><p className={label}>分类</p><div className="mt-2 grid grid-cols-4 gap-1.5">{Object.entries(MAIN_CATEGORY_META).filter(([value]) => value !== "readingPlan").map(([value, meta]) => <button key={value} type="button" onClick={() => changeMain(value as MainCategory)} className={`min-w-0 rounded-lg border px-2 py-2 text-xs font-semibold transition-all ${draft.mainCategory === value ? "border-primary bg-primary text-white" : "border-ink/10 bg-white text-muted hover:border-primary/30 hover:text-ink"}`}>{meta.label}</button>)}</div><div className="mt-2 flex flex-wrap items-center gap-1.5">{subCategoryOptions.map((item) => <button key={item.value} type="button" onClick={() => changeSub(item.value)} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${draft.subCategory === item.value ? "bg-ink text-white" : "bg-white text-muted ring-1 ring-inset ring-ink/10 hover:text-ink"}`}>{item.label}</button>)}{draft.mainCategory !== "readingPlan" && <button type="button" aria-label="添加自定义分类" title="添加自定义分类" onClick={() => { setAddingCategory(true); setError(""); }} className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-dashed border-primary/40 bg-white text-primary hover:bg-primary/5"><Plus className="h-4 w-4" /></button>}</div>{addingCategory && <div className="mt-2 flex max-w-sm items-center gap-1.5"><input autoFocus value={customCategoryName} onChange={(event) => setCustomCategoryName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addCustomCategory(); } }} placeholder="例如：跳绳课" className="min-w-0 flex-1 rounded-md border border-primary/30 bg-white px-3 py-1.5 text-sm outline-none focus:border-primary" /><button type="button" onClick={() => void addCustomCategory()} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white">添加</button><button type="button" aria-label="取消添加分类" onClick={() => { setAddingCategory(false); setCustomCategoryName(""); }} className="rounded p-1.5 text-muted hover:bg-white"><X className="h-4 w-4" /></button></div>}</div>

      {draft.mainCategory === "interestClass" && (draft.subCategory === "otherInterest" || isCustomSubCategory(draft.subCategory)) && <label className="flex items-center gap-2 text-sm text-stone-600"><input type="checkbox" checked={draft.extraContentType === "class"} onChange={(e) => set("extraContentType", interestContentType(e.target.checked))} className="h-4 w-4 rounded" />算作上课</label>}

      {draft.mainCategory === "extraHomework" && draft.subCategory !== "reading" && <div><p className={label}>内容</p><div className="mt-2 flex gap-1.5">{EXTRA_CONTENT_OPTIONS_SIMPLE.map((item) => <button key={item.value} type="button" onClick={() => changeExtraContent(item.value)} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${draft.extraContentType === item.value ? "bg-primary text-white" : "bg-white text-muted ring-1 ring-inset ring-ink/10"}`}>{item.label}</button>)}</div></div>}

      <label className={label}>任务标题{draft.mainCategory === "interestClass" || (draft.mainCategory === "extraHomework" && draft.subCategory === "reading") ? "（可选）" : " *"}<input autoFocus value={draft.title} onChange={(e) => { setTitleTouched(true); setDraft((current) => ({ ...current, title: e.target.value })); }} className={input} placeholder={draft.mainCategory === "interestClass" || (draft.mainCategory === "extraHomework" && draft.subCategory === "reading") ? "可留空，填写时用于补充具体内容" : "输入具体任务内容"} /></label>

      {homework && <div className="border-y border-ink/10 py-2.5"><div className="flex items-center justify-between"><div><p className="text-sm font-semibold text-ink">任务小项</p>{!draft.checklistItems?.length && <p className="mt-0.5 text-[11px] text-muted">把一项作业拆成几步完成</p>}</div><button type="button" onClick={addChecklist} className="inline-flex items-center gap-1 rounded-md bg-ink px-2.5 py-1.5 text-xs font-semibold text-white"><Plus className="h-3.5 w-3.5" />添加小项</button></div>{!!draft.checklistItems?.length && <div className="mt-2 space-y-1.5">{draft.checklistItems.map((item, index) => <div key={item.id} className="flex items-center gap-1.5"><input value={item.title} onChange={(e) => set("checklistItems", draft.checklistItems?.map((value) => value.id === item.id ? { ...value, title: e.target.value } : value))} className="min-w-0 flex-1 rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm" placeholder="小项内容" /><button type="button" aria-label="上移" title="上移" onClick={() => moveChecklist(index, -1)} className="p-1 text-muted"><ArrowUp className="h-4 w-4" /></button><button type="button" aria-label="下移" title="下移" onClick={() => moveChecklist(index, 1)} className="p-1 text-muted"><ArrowDown className="h-4 w-4" /></button><button type="button" aria-label="删除小项" title="删除小项" onClick={() => set("checklistItems", draft.checklistItems?.filter((value) => value.id !== item.id))} className="p-1"><Trash2 className="h-4 w-4 text-rose-400" /></button></div>)}</div>}</div>}

      <div><p className={label}>未完成时</p><div className="mt-2 grid grid-cols-3 gap-1.5">{([['autoNextDay', '顺延'], ['skipIfMissed', '跳过'], ['keepOverdue', '标记逾期']] as const).map(([value, text]) => <button key={value} type="button" onClick={() => { set("rolloverMode", value); set("allowRollover", value === "autoNextDay"); }} className={`rounded-md border px-2 py-2 text-xs font-semibold transition-colors ${draft.rolloverMode === value ? "border-primary bg-primary text-white" : "border-ink/10 bg-white text-muted hover:border-primary/30 hover:text-ink"}`}>{text}</button>)}</div></div>

      {!reading && <div><p className={label}>安排</p><div className="mt-2 grid grid-cols-3 gap-1.5">{(["singleDate", "dateRange", "recurring"] as TaskTimeType[]).map((value) => <button key={value} type="button" onClick={() => { changeTimeType(value); if (value !== "singleDate") setShowMore(true); }} className={`rounded-md px-2 py-2 text-xs font-semibold ${draft.timeType === value ? "bg-ink text-white" : "bg-white text-muted ring-1 ring-inset ring-ink/10"}`}>{value === "singleDate" ? "单日" : value === "dateRange" ? "日期段" : "重复"}</button>)}</div></div>}

      {draft.timeType === "singleDate" && <DateField title="日期" value={draft.date} onChange={(value) => set("date", value)} input={input} label={label} required quick />}

      {/* ── 更多设置折叠区 ── */}
      <button type="button" onClick={() => setShowMore((v) => !v)} className="flex w-full items-center justify-between border-y border-ink/10 px-1 py-2.5 text-sm font-semibold text-ink"><span>详细设置</span><ChevronDown className={`h-4 w-4 text-muted transition-transform ${showMore ? "rotate-180" : ""}`} /></button>

      {showMore && <div className="space-y-2 rounded-lg border border-ink/10 bg-white/65 p-2.5 sm:p-3">
        {!reading && task && ["weekGoal", "assignmentWindow"].includes(task.timeType) && <label className={label}>任务类型<select value={draft.timeType} onChange={(e) => changeTimeType(e.target.value as TaskTimeType)} className={input}>{(["singleDate", "dateRange", "recurring", task.timeType] as TaskTimeType[]).filter((value, index, values) => values.indexOf(value) === index).map((value) => <option key={value} value={value}>{value === "recurring" ? "固定重复" : TIME_TYPE_META[value]}</option>)}</select></label>}
        {reading && <div className="rounded-xl bg-cyan-50 px-4 py-3 text-sm font-medium text-cyan-800">每周目标（周一到周日任意完成，不绑定固定星期）</div>}
        {draft.timeType === "dateRange" && <DateRange draft={draft} set={set} input={detailInput} label={label} />}
        {draft.timeType === "weekGoal" && <DateField title="首次执行周" value={draft.weekStart} onChange={(value) => set("weekStart", value)} input={detailInput} label={label} required />}
        {draft.timeType === "assignmentWindow" && <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 p-2.5"><p className="mb-1.5 text-sm font-semibold">课后作业周期</p><div className="grid gap-2 sm:grid-cols-3"><DateField title="来源课程" value={draft.assignmentWindow?.sourceClassDate} onChange={(value) => set("assignmentWindow", { ...draft.assignmentWindow!, sourceClassDate: value })} input={detailInput} label={label} /><DateField title="开始" value={draft.assignmentWindow?.startDate} onChange={(value) => set("assignmentWindow", { ...draft.assignmentWindow!, startDate: value })} input={detailInput} label={label} /><DateField title="截止" value={draft.assignmentWindow?.endDate} onChange={(value) => set("assignmentWindow", { ...draft.assignmentWindow!, endDate: value })} input={detailInput} label={label} /></div></div>}
        {recurring && <div className="rounded-lg border border-violet-100 bg-violet-50/40 p-2.5"><div className={`grid gap-2 ${["dailyRecurring", "weeklyRecurring"].includes(draft.schedulePattern ?? "") ? "sm:grid-cols-3" : ""}`}><label className={label}>安排方式<select value={draft.schedulePattern ?? "weeklyRecurring"} onChange={(e) => changePattern(e.target.value as SchedulePattern)} className={detailInput}><option value="dailyRecurring">每日重复</option><option value="weeklyRecurring">每周固定</option><option value="specificDates">指定日期列表</option><option value="dateRangeDaily">日期范围内每天</option><option value="dateRangeWeekdays">日期范围内按星期</option></select></label>{["dailyRecurring", "weeklyRecurring"].includes(draft.schedulePattern ?? "") && <><DateField title="开始日期" value={draft.recurrence?.startDate} onChange={(value) => set("recurrence", { ...draft.recurrence!, startDate: value })} input={detailInput} label={label} /><DateField title="结束日期（可空）" value={draft.recurrence?.endDate} onChange={(value) => set("recurrence", { ...draft.recurrence!, endDate: value || undefined })} input={detailInput} label={label} /></>}</div>{draft.schedulePattern === "weeklyRecurring" && <WeekdayPicker values={draft.recurrence?.weekdays ?? []} onToggle={(day) => toggleDays(day, "recurrence")} />}{draft.schedulePattern === "specificDates" && <MultiDatePicker values={draft.specificDates ?? []} onChange={(values) => set("specificDates", values)} initialDate={initialDate} />}{["dateRangeDaily", "dateRangeWeekdays"].includes(draft.schedulePattern ?? "") && <DateRange draft={draft} set={set} input={detailInput} label={label} />}{draft.schedulePattern === "dateRangeWeekdays" && <WeekdayPicker values={draft.rangeWeekdays ?? []} onToggle={(day) => toggleDays(day, "rangeWeekdays")} title="范围内星期" />}</div>}
        {reading && <div className="rounded-lg border border-cyan-100 bg-cyan-50/40 p-3"><div className="grid grid-cols-2 gap-2"><label className={label}>每周目标<input type="number" min="1" value={draft.weeklyQuota?.targetCount ?? 1} onChange={(e) => updateQuota({ targetCount: Number(e.target.value) || 1 })} className={input} /></label><label className={label}>单位<select value={draft.weeklyQuota?.unit ?? "本"} onChange={(e) => updateQuota({ unit: e.target.value as WeeklyQuota["unit"] })} className={input}>{["本", "页", "分钟", "次", "篇"].map((unit) => <option key={unit}>{unit}</option>)}</select></label></div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm"><Check label="每周执行" checked={draft.weeklyQuota?.isWeeklyRecurring ?? true} onChange={(value) => updateQuota({ isWeeklyRecurring: value })} /><Check label="允许下发到每天" checked={draft.weeklyQuota?.allowAutoDistribute ?? true} onChange={(value) => updateQuota({ allowAutoDistribute: value })} /><Check label="当周可顺延" checked={draft.weeklyQuota?.allowRollover ?? true} onChange={(value) => { updateQuota({ allowRollover: value }); set("allowRollover", value); }} /></div></div>}
        {!reading && ["weekGoal", "assignmentWindow"].includes(draft.timeType) && <div className="rounded-lg border bg-white p-3"><p className="mb-2 text-sm font-semibold">自动分配设置</p><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><NumberField label="总量" value={draft.totalAmount} onChange={(value) => set("totalAmount", value)} input={input} /><label className={label}>单位<input value={draft.amountUnit ?? ""} onChange={(e) => set("amountUnit", e.target.value)} className={input} /></label><NumberField label="分几次" value={draft.splitCount} onChange={(value) => set("splitCount", value)} input={input} /><NumberField label="每次数量" value={draft.amountPerSession} onChange={(value) => set("amountPerSession", value)} input={input} /></div><WeekdayPicker values={draft.allowedWeekdays ?? []} onToggle={(day) => toggleDays(day, "allowedWeekdays")} title="可安排星期（不选表示每天）" /></div>}
        <div className="grid items-start gap-2 lg:grid-cols-[minmax(180px,0.8fr)_minmax(260px,1.2fr)]"><label className={label}>适用阶段<select value={draft.applicablePeriodType === "regular" ? "regular" : draft.planPeriodId ?? "all"} onChange={(e) => { const value = e.target.value; setPeriodTouched(true); setAutoBoundHint(""); setDraft((current) => ({ ...current, applicablePeriodType: value === "all" ? "all" : value === "regular" ? "regular" : "holiday", planPeriodId: value === "all" || value === "regular" ? undefined : value })); }} className={detailInput}><option value="all">全部阶段</option><option value="regular">平时（假期外自动适用）</option>{periods.filter((period) => period.type === "holiday").map((period) => <option key={period.id} value={period.id}>{period.name}</option>)}</select>{autoBoundHint && <div className="mt-1 text-xs normal-case tracking-normal text-sage-600">{autoBoundHint}</div>}</label>
        <div className="grid grid-cols-[36px_minmax(132px,1fr)_24px] items-center gap-x-2 gap-y-1.5 rounded-md bg-ink/[0.035] px-3 py-2"><span className="col-span-3 text-xs font-bold text-muted">时间（可选）</span><label htmlFor="task-start-time" className="text-xs font-medium text-muted">开始</label><input id="task-start-time" aria-label="开始时间" type="time" value={draft.startTime ?? ""} onChange={(event) => set("startTime", event.target.value || undefined)} className="w-full rounded-md border border-ink/15 bg-white px-2.5 py-1.5 text-sm text-ink outline-none focus:border-primary" />{draft.startTime ? <button type="button" aria-label="清除开始时间" title="清除开始时间" onClick={() => set("startTime", undefined)} className="rounded p-1 text-muted hover:bg-white hover:text-ink"><X className="h-3.5 w-3.5" /></button> : <span />}<label htmlFor="task-end-time" className="text-xs font-medium text-muted">结束</label><input id="task-end-time" aria-label="结束时间" type="time" value={draft.endTime ?? ""} onChange={(event) => set("endTime", event.target.value || undefined)} className="w-full rounded-md border border-ink/15 bg-white px-2.5 py-1.5 text-sm text-ink outline-none focus:border-primary" />{draft.endTime ? <button type="button" aria-label="清除结束时间" title="清除结束时间" onClick={() => set("endTime", undefined)} className="rounded p-1 text-muted hover:bg-white hover:text-ink"><X className="h-3.5 w-3.5" /></button> : <span />}</div></div>
        <label className={label}>备注<textarea rows={1} value={draft.note ?? ""} onChange={(e) => set("note", e.target.value)} className="mt-1.5 min-h-11 w-full resize-y rounded-md border border-ink/15 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none focus:border-primary" /></label>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-ink/10 pt-3"><Check label="显示在今日清单" checked={draft.childVisible} onChange={(value) => set("childVisible", value)} /><Check label="在月计划中显示" checked={draft.calendarVisibility !== "hide"} onChange={(value) => { setCalendarVisibilityTouched(true); setDraft((current) => ({ ...current, calendarVisibility: value ? "show" : "hide", ...(!value ? { rolloverMode: "skipIfMissed" as const, allowRollover: false } : {}) })); }} />{!isOccurrenceSchedule(draft) &&<label className={label}>状态<select value={draft.status} onChange={(e) => set("status", e.target.value as TaskStatus)} className="ml-2 rounded-md border px-2 py-1 text-xs normal-case tracking-normal">{Object.entries(STATUS_META).filter(([value]) => value !== "overdue").map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label>}</div>
      </div>}

      {pendingConflict && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><p>该时间与已有任务"{conflictTitle}"重叠，是否仍然添加？</p><div className="mt-3 flex gap-2"><button type="button" onClick={() => setPendingConflict(undefined)} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5">返回修改</button><button type="button" onClick={async () => { setSaving(true); try { await onSave(pendingConflict, true); onClose(); } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); setSaving(false); } }} className="rounded-lg bg-primary px-3 py-1.5 font-semibold text-white">仍然添加</button></div></div>}
      {error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
    </div>
    <footer className="sticky bottom-0 flex justify-end gap-3 border-t border-ink/10 bg-paper/95 px-5 py-4 backdrop-blur"><button type="button" onClick={onClose} className="rounded-lg px-5 py-2.5 text-sm text-muted">取消</button><button disabled={saving} className="rounded-lg bg-alert px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "保存中…" : "保存任务"}</button></footer>
  </form></div>;
}

function DateRange({ draft, set, input, label }: { draft: TaskDraft; set: <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => void; input: string; label: string }) { return <div className="grid grid-cols-2 gap-2"><DateField title="开始日期" value={draft.startDate} onChange={(value) => set("startDate", value)} input={input} label={label} /><DateField title="结束日期" value={draft.endDate} onChange={(value) => set("endDate", value)} input={input} label={label} /></div>; }
function MultiDatePicker({ values, onChange, initialDate }: { values: string[]; onChange: (values: string[]) => void; initialDate: string }) {
  const [month, setMonth] = useState(fromDateKey(values[0] ?? initialDate));
  const [cursor, setCursor] = useState(values.at(-1) ?? initialDate);
  const [advanced, setAdvanced] = useState("");
  const days = eachDayOfInterval({ start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }) });
  const toggle = (key: string) => { setCursor(key); onChange(values.includes(key) ? values.filter((value) => value !== key) : [...values, key].sort()); };
  const moveCursor = (days: number) => { const next = toDateKey(addDays(fromDateKey(cursor), days)); const nextValues = values.includes(cursor) ? [...values.filter((value) => value !== cursor), next].sort() : values; setCursor(next); setMonth(fromDateKey(next)); onChange([...new Set(nextValues)]); };
  const parseAdvanced = () => { const parsed = advanced.split(/[\s,，;；]+/).map((value) => value.trim().replaceAll("/", "-")).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)); onChange([...new Set([...values, ...parsed])].sort()); setAdvanced(""); };
  return <div className="mt-2 rounded-lg border border-violet-100 bg-white p-3"><div className="flex items-center justify-between"><button type="button" onClick={() => setMonth(addMonths(month, -1))} className="rounded-lg px-3 py-1 text-sm">‹</button><span className="text-sm font-semibold">{format(month, "yyyy年M月")}</span><button type="button" onClick={() => setMonth(addMonths(month, 1))} className="rounded-lg px-3 py-1 text-sm">›</button></div><div className="mt-2 grid grid-cols-7 gap-1">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day} className="py-1 text-center text-[10px] text-stone-400">{day}</span>)}{days.map((day) => { const key = toDateKey(day); const selected = values.includes(key); return <button type="button" key={key} aria-label={`选择日期 ${key}`} onClick={() => toggle(key)} className={`rounded-lg py-1.5 text-xs ${selected ? "bg-violet-600 text-white" : key === cursor ? "ring-1 ring-violet-400" : isSameMonth(day, month) ? "hover:bg-violet-50" : "text-stone-300"}`}>{day.getDate()}</button>; })}</div><div className="mt-2 flex items-center justify-between rounded-lg bg-violet-50/60 p-1.5 text-xs"><button type="button" onClick={() => moveCursor(-1)} className="rounded-md bg-white px-3 py-1.5">前一天</button><span className="text-violet-700">{cursor}</span><button type="button" onClick={() => moveCursor(1)} className="rounded-md bg-white px-3 py-1.5">后一天</button></div>{values.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{values.map((value) => <button type="button" key={value} onClick={() => toggle(value)} className="rounded-full bg-violet-50 px-2 py-1 text-[11px] text-violet-700">{value} ×</button>)}</div>}<details className="mt-2"><summary className="cursor-pointer text-xs text-stone-400">粘贴输入 / 高级输入</summary><div className="mt-2 flex gap-2"><textarea value={advanced} onChange={(e) => setAdvanced(e.target.value)} placeholder="支持逗号、分号、空格或换行" className="min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-xs" /><button type="button" onClick={parseAdvanced} className="rounded-lg bg-stone-100 px-3 text-xs">添加</button></div></details></div>;
}
function DateField({ title, value, onChange, input, label, required, quick = false }: { title: string; value?: string; onChange: (value: string) => void; input: string; label: string; required?: boolean; quick?: boolean }) { return <label className={label}>{title}<input required={required} type="date" value={value ?? ""} onChange={(event) => onChange(event.target.value)} className={input} />{quick && <span className="mt-1.5 flex gap-1.5"><button type="button" onClick={() => onChange(todayKey())} className="rounded-md bg-stone-100 px-3 py-1.5 text-xs text-stone-600">今天</button><button type="button" onClick={() => onChange(toDateKey(addDays(fromDateKey(todayKey()), 1)))} className="rounded-md bg-stone-100 px-3 py-1.5 text-xs text-stone-600">明天</button></span>}</label>; }
function WeekdayPicker({ values, onToggle, title = "重复星期" }: { values: number[]; onToggle: (day: number) => void; title?: string }) { return <div className="mt-2"><p className="mb-1.5 text-xs text-stone-500">{title}</p><div className="flex flex-wrap gap-1.5">{[1, 2, 3, 4, 5, 6, 0].map((day) => <button type="button" key={day} onClick={() => onToggle(day)} className={`rounded-md px-2.5 py-1.5 text-xs ${values.includes(day) ? "bg-primary text-white" : "bg-stone-100 text-stone-500"}`}>{WEEKDAY_LABELS[day].replace("周", "")}</button>)}</div></div>; }
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
