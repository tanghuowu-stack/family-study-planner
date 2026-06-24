import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { taskRepository } from "../data/taskRepository";
import { getCalendarAnnotation } from "../data/calendarAnnotations";
import type { TaskDisplay } from "../types/task";
import { fromDateKey, toDateKey, todayKey } from "../utils/date";
import { subCategoryLabel } from "../utils/taskMeta";

export function MonthPage({ date, refreshKey, onDateChange, onOpenDay }: { date: string; refreshKey: number; onDateChange: (date: string) => void; onOpenDay: (date: string) => void }) {
  const monthDate = fromDateKey(date);
  const monthKey = date.slice(0, 7);
  const gridDates = useMemo(() => eachDayOfInterval({ start: startOfWeek(startOfMonth(monthDate), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(monthDate), { weekStartsOn: 1 }) }).map(toDateKey), [monthKey]);
  const [items, setItems] = useState<Record<string, TaskDisplay[]>>({});
  useEffect(() => { Promise.all(gridDates.map((key) => taskRepository.getTasksForDate(key, { forCalendar: true }))).then((values) => setItems(Object.fromEntries(gridDates.map((key, index) => [key, values[index]])))); }, [gridDates.join(","), refreshKey]);
  const move = (months: number) => onDateChange(toDateKey(addMonths(monthDate, months)));
  return <main className="mx-auto w-full max-w-7xl px-3 pb-28 pt-6 sm:px-6">
    <div className="mb-5 text-center"><p className="text-xs font-semibold tracking-widest text-sage-700">MONTH</p><h1 className="mt-1 text-3xl font-semibold text-ink sm:text-4xl">{format(monthDate, "yyyy年M月")}</h1></div>
    <div className="mb-5 grid grid-cols-3 rounded-2xl border border-stone-100 bg-white p-1.5 text-sm"><button onClick={() => move(-1)} className="rounded-xl px-2 py-2 text-stone-500 hover:bg-stone-50">← 上一月</button><button onClick={() => onDateChange(todayKey())} className="rounded-xl px-2 py-2 font-medium text-sage-700 hover:bg-sage-50">回到本月</button><button onClick={() => move(1)} className="rounded-xl px-2 py-2 text-stone-500 hover:bg-stone-50">下一月 →</button></div>
    <div className="grid grid-cols-7 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-card">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <div key={day} className="border-b bg-stone-50 px-2 py-2 text-center text-xs font-semibold text-stone-500">周{day}</div>)}{gridDates.map((key) => { const tasks = items[key] ?? []; const labels = calendarLabels(tasks); const annotation = getCalendarAnnotation(key); const annotations = [...annotation.solarTerms, ...annotation.festivals]; return <button key={key} onClick={() => onOpenDay(key)} className={`min-h-24 border-b border-r p-1.5 text-left align-top sm:min-h-28 sm:p-2 ${!isSameMonth(fromDateKey(key), monthDate) ? "bg-stone-50/70 text-stone-300" : "hover:bg-sage-50/30"}`}><div className="flex min-w-0 items-center gap-1"><span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${key === todayKey() ? "bg-ink text-white" : ""}`}>{fromDateKey(key).getDate()}</span>{annotation.holidayStatus && <span className={`rounded px-1 py-0.5 text-[9px] font-bold ${annotation.holidayStatus === "休" ? "bg-rose-50 text-rose-700" : "bg-blue-50 text-blue-700"}`}>{annotation.holidayStatus}</span>}</div>{annotations.length > 0 && <div className="mt-0.5 truncate text-[9px] font-medium text-amber-700 sm:text-[10px]">{annotations.join("·")}</div>}<div className="mt-1 space-y-1">{labels.slice(0, 5).map((label) => <div key={`${label.type}:${label.text}`} className={`truncate rounded border px-1.5 py-0.5 text-[10px] sm:text-xs ${labelClass(label.type)}`}>{label.text}</div>)}{labels.length > 5 && <div className="px-1 text-[10px] text-stone-400 sm:text-xs">+{labels.length - 5}</div>}</div></button>; })}</div></main>;
}

function calendarLabels(tasks: TaskDisplay[]) {
  const labels: { text: string; type: string }[] = [];
  const seen = new Set<string>();
  tasks.forEach((task) => {
    const name = task.title.trim() || subCategoryLabel(task.mainCategory, task.subCategory);
    if (seen.has(name)) return; seen.add(name);
    const type = task.mainCategory === "extraHomework" ? /奥数/.test(task.title) ? "aoshu" : /语文|大增/.test(task.title) ? "dazeng" : /FCE|英语|剑桥/.test(task.title) ? "cambridge" : "extra" : task.subCategory;
    labels.push({ text: `${name}${task.status === "done" ? " ✓" : ""}`, type });
  });
  return labels;
}

function labelClass(type: string) {
  const styles: Record<string, string> = {
    school: "border-blue-100 bg-blue-50 text-blue-700", extra: "border-orange-100 bg-orange-50 text-orange-700", reading: "border-emerald-100 bg-emerald-50 text-emerald-700",
    aoshu: "border-violet-100 bg-violet-50 text-violet-700", dazeng: "border-amber-100 bg-amber-50 text-amber-800", cambridge: "border-cyan-100 bg-cyan-50 text-cyan-700",
    piano: "border-fuchsia-100 bg-fuchsia-50 text-fuchsia-700", pianoPractice: "border-fuchsia-100 bg-fuchsia-50 text-fuchsia-700", swimming: "border-teal-100 bg-teal-50 text-teal-700",
    rollerSkating: "border-indigo-100 bg-indigo-50 text-indigo-700", travel: "border-rose-100 bg-rose-50 text-rose-700", leisure: "border-sage-100 bg-sage-50 text-sage-700", examCompetition: "border-red-100 bg-red-50 text-red-700",
  };
  return styles[type] ?? "border-stone-200 bg-stone-50 text-stone-600";
}
