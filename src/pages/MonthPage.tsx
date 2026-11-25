import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { zhCN } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSwipe } from "../hooks/useSwipe";
import { taskRepository } from "../data/taskRepository";
import { getCalendarAnnotation } from "../data/calendarAnnotations";
import type { TaskDisplay } from "../types/task";
import { fromDateKey, toDateKey, todayKey } from "../utils/date";
import { subCategoryLabel } from "../utils/taskMeta";
import { taskSubjectGroup } from "../utils/taskGrouping";
import { NEUTRAL_DOT, SUBJECT_DOT } from "../components/GroupHeading";

export function MonthPage({ date, refreshKey, onDateChange, onOpenDay, onAddTask, tabs }: { date: string; refreshKey: number; onDateChange: (date: string) => void; onOpenDay: (date: string) => void; onAddTask: (date: string) => void; tabs?: ReactNode }) {
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

  const today = todayKey();
  const monthLabels = useMemo(() => gridDates.filter((key) => key.slice(0, 7) === monthKey).flatMap((key) => calendarLabels(items[key] ?? [])), [items, monthKey]);
  const upcomingCount = useMemo(() => gridDates.filter((key) => key.slice(0, 7) === monthKey && key >= today).reduce((sum, key) => sum + calendarLabels(items[key] ?? []).filter((label) => !label.done).length, 0), [items, monthKey, today]);
  const isThisMonth = monthKey === today.slice(0, 7);

  /*
   * 月历（2026-11-25 用户："把月历整个页面重新再设计一下"）：
   * - 表头：大号"11月"+ 灰色年份，右侧圆形 ‹ › 和"今天"胶囊；下面一行灰字概览（本月 N 项安排 · 还有 N 项没到 / 没做）。
   * - 星期一行浅色小字（周末玫红），不再用黑色横条；格子之间 1px 细线，整体圆角白卡。
   * - 今天：整个格子浅绿底 + 顶部 3px 主色条，日期数字主色粗体，不再给数字单独加色块。
   * - 周末两列浅暖底；不是本月的日子只显示淡色日期，不列安排。
   * - 做完的安排灰字、色点变淡，不划线（原来过去的日子满屏删除线）；没做的正文色，时间在前面灰色小字。
   */
  return (
    <main className="fit-tablet mx-auto w-full max-w-7xl overflow-x-hidden px-3 pb-content pt-4 sm:px-7 sm:pt-6 lg:px-10">
      {tabs}
      <header className="mb-3 flex shrink-0 items-end justify-between gap-3 sm:mb-4">
        <div className="min-w-0">
          <h1 className="flex items-baseline gap-2 text-ink"><span className="text-[30px] font-bold leading-9 tracking-tight sm:text-[36px] sm:leading-10">{format(monthDate, "M月")}</span><span className="text-[17px] font-semibold text-muted sm:text-xl">{format(monthDate, "yyyy")}</span></h1>
          <p className="mt-1 text-[13px] text-muted">{isThisMonth ? "本月" : "这个月"} {monthLabels.length} 项安排{isThisMonth && upcomingCount > 0 && ` · 今天起还有 ${upcomingCount} 项`}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {!isThisMonth && <button onClick={() => onDateChange(today)} className="min-h-11 rounded-full bg-primary px-4 text-sm font-bold text-white hover:bg-[#256a4d]">回到本月</button>}
          <button onClick={() => move(-1)} aria-label={`上一月：${format(addMonths(monthDate, -1), "yyyy年M月")}`} className="flex h-11 w-11 items-center justify-center rounded-full border border-ink/10 bg-white text-ink hover:bg-stone-50"><ChevronLeft className="h-5 w-5" /></button>
          <button onClick={() => move(1)} aria-label={`下一月：${format(addMonths(monthDate, 1), "yyyy年M月")}`} className="flex h-11 w-11 items-center justify-center rounded-full border border-ink/10 bg-white text-ink hover:bg-stone-50"><ChevronRight className="h-5 w-5" /></button>
        </div>
      </header>

      <div ref={swipeRef} className="fit-fill flex flex-col overflow-hidden rounded-xl border border-ink/[0.08] bg-white shadow-[0_1px_2px_rgba(32,41,37,0.04),0_12px_32px_-20px_rgba(32,41,37,0.25)]">
        <div className="grid grid-cols-7 border-b border-ink/[0.08]">
          {["一", "二", "三", "四", "五", "六", "日"].map((day, index) => (
            <div key={day} className={`py-2.5 text-center text-[12px] font-semibold tracking-wide sm:py-3 sm:text-[13px] ${index >= 5 ? "bg-[#F6ECE4] text-alert" : "text-muted"}`}><span className="hidden sm:inline">周</span>{day}</div>
          ))}
        </div>
        <div className="grid flex-1 grid-cols-7 gap-px bg-ink/[0.06]" style={{ gridTemplateRows: `repeat(${gridDates.length / 7}, minmax(0, 1fr))` }}>
          {gridDates.map((key, index) => {
            const tasks = items[key] ?? [];
            const labels = calendarLabels(tasks);
            const annotation = getCalendarAnnotation(key);
            const annotations = [...annotation.solarTerms, ...annotation.festivals];
            const isSelected = selectedDay === key;
            const inMonth = isSameMonth(fromDateKey(key), monthDate);
            const isToday = key === today;
            const weekend = index % 7 >= 5;
            const past = key < today;
            // 周末两列明显的暖色底 + 玫红日期（2026-11-25 用户：周六日和平时看不出区别）
            const bg = !inMonth ? (weekend ? "bg-[#F7F1EC]" : "bg-[#FAF9F7]") : isToday ? "bg-[#E9F3ED]" : isSelected ? "bg-mint/60" : weekend ? "bg-[#FBF3EC]" : "bg-white";
            return (
              <button
                key={key}
                onClick={() => handleDayClick(key)}
                aria-current={isToday ? "date" : undefined}
                aria-label={`${format(fromDateKey(key), "M月d日")}${labels.length ? `，${labels.length} 项安排` : ""}`}
                className={`relative flex min-h-[3.75rem] flex-col overflow-hidden p-1.5 text-left align-top transition-colors sm:min-h-[5.5rem] sm:p-2 desk:min-h-[7.5rem] desk:p-2.5 ${bg} ${inMonth && !isToday ? "hover:bg-mint/30" : ""} ${isSelected ? "ring-2 ring-inset ring-primary/40" : ""}`}
              >
                {isToday && <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-primary" />}
                <div className="flex min-w-0 items-center gap-1">
                  <span className={`text-[14px] leading-6 tabular-nums sm:text-[15px] ${!inMonth ? "text-stone-300" : isToday ? "font-bold text-primary" : weekend ? `font-semibold ${past ? "text-alert/60" : "text-alert"}` : past ? "font-medium text-muted" : "font-semibold text-ink"}`}>{fromDateKey(key).getDate()}</span>
                  {isToday && <span className="hidden text-[12px] font-semibold text-primary sm:inline">今天</span>}
                  {inMonth && annotation.holidayStatus && (
                    <span className={`rounded px-1 text-[11px] font-bold leading-4 sm:text-[12px] ${annotation.holidayStatus === "休" ? "bg-rose-50 text-rose-700" : "bg-blue-50 text-blue-700"}`}>{annotation.holidayStatus}</span>
                  )}
                  {inMonth && annotations.length > 0 && <span className="ml-auto hidden min-w-0 truncate text-[12px] font-medium text-amber-700 sm:inline">{annotations.join("·")}</span>}
                </div>

                {/* 手机：格子太窄放不下文字，色点（做完的变淡），点开在下方看详情 */}
                {inMonth && labels.length > 0 && (
                  <div className="mt-auto flex flex-wrap items-center gap-[3px] pb-0.5 sm:hidden" aria-hidden>
                    {labels.slice(0, 6).map((label) => <span key={`${label.type}:${label.text}`} className={`h-1.5 w-1.5 rounded-full ${label.done ? "opacity-30" : ""}`} style={{ backgroundColor: label.dot }} />)}
                  </div>
                )}

                {/* 电脑 / iPad：色点 + 时间 + 名称 */}
                {inMonth && <div className="mt-1 hidden min-h-0 space-y-[3px] overflow-hidden sm:block">
                  {labels.slice(0, 4).map((label) => (
                    <div key={`${label.type}:${label.text}`} title={label.time ? `${label.time} ${label.name}` : label.name} className={`flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] ${label.done ? "text-stone-400" : "text-ink"}`}>
                      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${label.done ? "opacity-40" : ""}`} style={{ backgroundColor: label.dot }} />
                      <span className="min-w-0 truncate">{label.time && <span className={`mr-1 hidden tabular-nums lg:inline ${label.done ? "" : "text-muted"}`}>{label.time}</span>}{label.name}</span>
                    </div>
                  ))}
                  {labels.length > 4 && <div className="pl-3 text-[12px] font-medium text-muted">+{labels.length - 4} 项</div>}
                </div>}
              </button>
            );
          })}
        </div>
      </div>

      {/* 手机：点某天在下面展开 */}
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
    <div className="surface mt-3 overflow-hidden sm:hidden">
      <div className="flex items-center gap-2 border-b border-ink/[0.07] px-4 py-3">
        <span className="text-[17px] font-bold text-ink">{d.getMonth() + 1}月{d.getDate()}日</span>
        <span className="text-[13px] text-muted">{format(d, "EEEE", { locale: zhCN }).replace("星期", "周")}</span>
        {annotations.length > 0 && <span className="text-[13px] text-amber-700">{annotations.join("·")}</span>}
        {annotation.holidayStatus && <span className={`rounded px-1.5 py-0.5 text-[12px] font-bold ${annotation.holidayStatus === "休" ? "bg-rose-50 text-rose-700" : "bg-blue-50 text-blue-700"}`}>{annotation.holidayStatus}</span>}
        <button onClick={onClose} aria-label="收起" className="ml-auto flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-stone-100"><X className="h-5 w-5" /></button>
      </div>
      {labels.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted">这天没有安排</p>
      ) : (
        <ul className="divide-y divide-ink/[0.06] px-4">
          {labels.map((label) => (
            <li key={`${label.type}:${label.text}`} className={`flex min-h-12 items-center gap-3 text-[15px] ${label.done ? "text-stone-400" : "text-ink"}`}>
              <span className="w-11 shrink-0 text-[13px] tabular-nums text-muted">{label.time ?? "全天"}</span>
              <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${label.done ? "opacity-40" : ""}`} style={{ backgroundColor: label.dot }} />
              <span className="min-w-0 flex-1 truncate">{label.name}</span>
              {label.done && <span className="text-[12px] text-stone-400">已完成</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-2 gap-2 border-t border-ink/[0.07] p-3">
        <button onClick={() => onAddTask(day)} className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-alert text-sm font-semibold text-white"><Plus className="h-4 w-4" />新建任务</button>
        <button onClick={() => onOpenDay(day)} className="min-h-11 rounded-lg border border-ink/10 bg-white text-sm font-semibold text-primary">打开这一天</button>
      </div>
    </div>
  );
}

/**
 * 月历格子里的标签（2026-11-14 统一视觉）：白底 + 学科色点，与今日页、任务管理页同一套 SUBJECT_DOT；
 * 兴趣班、其他安排用中性灰点。原先按"奥数/大增/剑桥/钢琴/游泳…"各给一种底色，一屏十来种颜色。
 */
function calendarLabels(tasks: TaskDisplay[]) {
  const labels: { text: string; name: string; type: string; dot: string; done: boolean; time?: string }[] = [];
  const seen = new Set<string>();
  tasks.forEach((task) => {
    const name = task.title.trim() || subCategoryLabel(task.mainCategory, task.subCategory);
    if (seen.has(name)) return;
    seen.add(name);
    const subject = taskSubjectGroup(task);
    const dot = task.mainCategory === "interestClass" || task.mainCategory === "temporary" || subject === "other" ? NEUTRAL_DOT : SUBJECT_DOT[subject];
    const done = task.status === "done";
    labels.push({ text: `${name}${done ? " ✓" : ""}`, name, type: task.subCategory, dot, done, time: task.startTime ?? task.time });
  });
  return labels;
}
