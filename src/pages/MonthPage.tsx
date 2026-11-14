import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSwipe } from "../hooks/useSwipe";
import { taskRepository } from "../data/taskRepository";
import { getCalendarAnnotation } from "../data/calendarAnnotations";
import type { TaskDisplay } from "../types/task";
import { fromDateKey, toDateKey, todayKey } from "../utils/date";
import { subCategoryLabel } from "../utils/taskMeta";
import { taskSubjectGroup } from "../utils/taskGrouping";
import { NEUTRAL_DOT, SUBJECT_DOT } from "../components/GroupHeading";
import { WeekReviewStrip } from "../components/WeekReviewStrip";

export function MonthPage({ date, refreshKey, onDateChange, onOpenDay, onAddTask }: { date: string; refreshKey: number; onDateChange: (date: string) => void; onOpenDay: (date: string) => void; onAddTask: (date: string) => void }) {
  const monthDate = fromDateKey(date);
  const monthKey = date.slice(0, 7);
  const gridDates = useMemo(() => eachDayOfInterval({ start: startOfWeek(startOfMonth(monthDate), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(monthDate), { weekStartsOn: 1 }) }).map(toDateKey), [monthKey]);
  const [items, setItems] = useState<Record<string, TaskDisplay[]>>({});
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  useEffect(() => {
    Promise.all(gridDates.map((key) => taskRepository.getTasksForDate(key, { forCalendar: true }))).then((values) =>
      setItems(Object.fromEntries(gridDates.map((key, index) => [key, values[index]]))),
    );
  }, [gridDates.join(","), refreshKey]);

  // Clear expanded panel when navigating months
  useEffect(() => { setSelectedDay(null); }, [monthKey]);

  const move = (months: number) => onDateChange(toDateKey(addMonths(monthDate, months)));

  const swipeRef = useSwipe<HTMLDivElement>(
    () => move(1),   // left swipe → next month
    () => move(-1),  // right swipe → prev month
  );

  const handleDayClick = (key: string) => {
    if (window.innerWidth < 640) {
      setSelectedDay(key === selectedDay ? null : key);
    } else {
      onOpenDay(key);
    }
  };

  return (
    <main className="mx-auto w-full max-w-7xl overflow-x-hidden px-3 pb-content pt-4 sm:px-7 sm:pt-6 lg:px-10">
      <header className="page-header">
        <h1 className="page-title shrink-0">{format(monthDate, "yyyy年M月")}</h1>
        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-ink/10 bg-white p-1">
          <button onClick={() => move(-1)} aria-label={`上一月：${format(addMonths(monthDate, -1), "yyyy年M月")}`} className="flex h-8 w-8 items-center justify-center rounded-md text-sm font-semibold text-muted hover:bg-stone-100 hover:text-ink sm:h-10 sm:w-auto sm:min-w-20 sm:gap-1 sm:px-3"><ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5" /><span className="hidden sm:inline">{format(addMonths(monthDate, -1), "M月")}</span></button>
          <button onClick={() => onDateChange(todayKey())} className="h-8 min-w-12 rounded-md bg-primary/10 px-2 text-sm font-bold text-primary hover:bg-primary/15 sm:h-10 sm:min-w-20 sm:px-4 sm:text-base">本月</button>
          <button onClick={() => move(1)} aria-label={`下一月：${format(addMonths(monthDate, 1), "yyyy年M月")}`} className="flex h-8 w-8 items-center justify-center rounded-md text-sm font-semibold text-muted hover:bg-stone-100 hover:text-ink sm:h-10 sm:w-auto sm:min-w-20 sm:gap-1 sm:px-3"><span className="hidden sm:inline">{format(addMonths(monthDate, 1), "M月")}</span><ChevronRight className="h-4 w-4 sm:h-5 sm:w-5" /></button>
        </div>
      </header>

      <WeekReviewStrip refreshKey={refreshKey} onOpenDay={onOpenDay} />

      <div ref={swipeRef} className="grid grid-cols-7 overflow-hidden rounded-lg border border-ink/15 bg-white shadow-card">
        {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
          <div key={day} className="border-b border-ink/10 bg-ink px-2 py-2.5 text-center text-[13px] font-semibold text-white/70"><span className="hidden sm:inline">周</span>{day}</div>
        ))}
        {gridDates.map((key) => {
          const tasks = items[key] ?? [];
          const labels = calendarLabels(tasks);
          const annotation = getCalendarAnnotation(key);
          const annotations = [...annotation.solarTerms, ...annotation.festivals];
          const isSelected = selectedDay === key;

          return (
            <button
              key={key}
              onClick={() => handleDayClick(key)}
              className={`min-h-20 border-b border-r border-ink/[0.08] p-1.5 text-left align-top sm:min-h-28 sm:p-2.5 ${
                !isSameMonth(fromDateKey(key), monthDate)
                  ? "bg-stone-50/70 text-stone-300 opacity-65"
                  : isSelected
                  ? "bg-mint/70"
                  : "hover:bg-mint/25"
              }`}
            >
              {/* Date number row */}
              <div className="flex min-w-0 items-center gap-0.5 sm:gap-1">
                <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[13px] font-semibold ${key === todayKey() ? "bg-alert text-white" : ""}`}>
                  {fromDateKey(key).getDate()}
                </span>
                {annotation.holidayStatus && (
                  <span className={`hidden rounded px-1 text-[13px] font-bold leading-5 sm:inline ${annotation.holidayStatus === "休" ? "bg-rose-50 text-rose-700" : "bg-blue-50 text-blue-700"}`}>
                    {annotation.holidayStatus}
                  </span>
                )}
              </div>

              {/* Solar term / festival — desktop only */}
              {annotations.length > 0 && (
                <div className="mt-0.5 hidden truncate text-[13px] font-medium text-amber-700 sm:block">{annotations.join("·")}</div>
              )}

              {/* 手机：格子太窄放不下文字（原先截成"整理明/天"这类半句），改为色点 + 件数，点开在下方看详情 */}
              {labels.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-0.5 sm:hidden" aria-label={`${labels.length} 项安排`}>
                  {labels.slice(0, 4).map((label) => <span key={`${label.type}:${label.text}`} className={`h-1.5 w-1.5 rounded-full ${label.done ? "opacity-40" : ""}`} style={{ backgroundColor: label.dot }} />)}
                  <span className="ml-0.5 text-[13px] font-semibold leading-none tabular-nums text-muted">{labels.length}</span>
                </div>
              )}

              {/* Desktop: text label pills */}
              <div className="mt-1 hidden space-y-1 sm:block">
                {labels.slice(0, 5).map((label) => (
                  <div key={`${label.type}:${label.text}`} className={`flex min-w-0 items-center gap-1.5 rounded border border-ink/10 bg-white px-1.5 py-0.5 text-[13px] ${label.done ? "text-muted line-through" : "text-ink"}`}>
                    <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: label.dot }} />
                    <span className="truncate">{label.name}</span>
                  </div>
                ))}
                {labels.length > 5 && <div className="px-1 text-[13px] text-muted">+{labels.length - 5}</div>}
              </div>
            </button>
          );
        })}
      </div>

      {/* Mobile expanded day panel */}
      {selectedDay && (
        <DayPanel
          day={selectedDay}
          tasks={items[selectedDay] ?? []}
          onOpenDay={onOpenDay}
          onAddTask={onAddTask}
          onClose={() => setSelectedDay(null)}
        />
      )}
    </main>
  );
}

function DayPanel({ day, tasks, onOpenDay, onAddTask, onClose }: { day: string; tasks: TaskDisplay[]; onOpenDay: (d: string) => void; onAddTask: (d: string) => void; onClose: () => void }) {
  const labels = calendarLabels(tasks);
  const annotation = getCalendarAnnotation(day);
  const annotations = [...annotation.solarTerms, ...annotation.festivals];
  const d = fromDateKey(day);

  return (
      <div className="surface mt-3 p-4 sm:hidden">
      <div className="flex items-start justify-between">
        <div>
          <span className="font-semibold text-ink">
            {d.getMonth() + 1}月{d.getDate()}日
          </span>
          {annotations.length > 0 && (
            <span className="ml-2 text-[13px] text-amber-700">{annotations.join("·")}</span>
          )}
          {annotation.holidayStatus && (
            <span className={`ml-2 rounded px-1.5 py-0.5 text-[13px] font-bold ${annotation.holidayStatus === "休" ? "bg-rose-50 text-rose-700" : "bg-blue-50 text-blue-700"}`}>
              {annotation.holidayStatus}
            </span>
          )}
        </div>
        <button onClick={onClose} className="rounded-lg p-1 text-stone-400 hover:bg-stone-50">
          <X className="h-4 w-4" />
        </button>
      </div>

      {labels.length === 0 ? (
        <p className="mt-3 text-sm text-stone-400">今日暂无任务</p>
      ) : (
        <div className="mt-3 space-y-2">
          {labels.map((label) => (
            <div key={`${label.type}:${label.text}`} className={`flex min-h-11 items-center gap-2 rounded-lg border border-ink/10 bg-white px-3 text-[15px] ${label.done ? "text-muted line-through" : "text-ink"}`}>
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: label.dot }} />
              <span className="flex-1">{label.name}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          onClick={() => onAddTask(day)}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-alert py-2.5 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" />新建任务
        </button>
        <button
          onClick={() => onOpenDay(day)}
          className="rounded-lg border border-ink/10 bg-white py-2.5 text-sm font-semibold text-primary"
        >
          查看当日页 →
        </button>
      </div>
    </div>
  );
}

/**
 * 月历格子里的标签（2026-11-14 统一视觉）：白底 + 学科色点，与今日页、任务管理页同一套 SUBJECT_DOT；
 * 兴趣班、其他安排用中性灰点。原先按"奥数/大增/剑桥/钢琴/游泳…"各给一种底色，一屏十来种颜色。
 */
function calendarLabels(tasks: TaskDisplay[]) {
  const labels: { text: string; name: string; type: string; dot: string; done: boolean }[] = [];
  const seen = new Set<string>();
  tasks.forEach((task) => {
    const name = task.title.trim() || subCategoryLabel(task.mainCategory, task.subCategory);
    if (seen.has(name)) return;
    seen.add(name);
    const subject = taskSubjectGroup(task);
    const dot = task.mainCategory === "interestClass" || task.mainCategory === "temporary" || subject === "other" ? NEUTRAL_DOT : SUBJECT_DOT[subject];
    const done = task.status === "done";
    labels.push({ text: `${name}${done ? " ✓" : ""}`, name, type: task.subCategory, dot, done });
  });
  return labels;
}
