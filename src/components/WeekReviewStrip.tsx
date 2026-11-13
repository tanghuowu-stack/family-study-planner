import { addDays, format, parseISO } from "date-fns";
import { zhCN } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { getWeekReview, type WeekReview } from "../data/weekReview";
import { formatCompactDate, todayKey, toDateKey } from "../utils/date";
import { SUBJECT_DOT } from "./GroupHeading";

/**
 * 月视图顶部的"本周"条：7 天各自完成几件。默认只显示这一行；点某一天，下方展开那天还没完成的事
 * （未来的日子是还没做的安排），再点一次收起。展开区里点某件事或"打开这一天"进入那天的今日页。
 * 口径见 data/weekReview.ts：每件事只算一次，完成看现在的状态。
 */
export function WeekReviewStrip({ refreshKey, onOpenDay }: { refreshKey: number; onOpenDay: (date: string) => void }) {
  const [anchor, setAnchor] = useState(todayKey);
  const [review, setReview] = useState<WeekReview | null>(null);
  const [openDate, setOpenDate] = useState<string | null>(null);
  useEffect(() => { void getWeekReview(anchor).then(setReview); }, [anchor, refreshKey]);
  useEffect(() => { setOpenDate(null); }, [anchor]);
  if (!review) return null;

  const today = todayKey();
  const isThisWeek = today >= review.weekStart && today <= review.weekEnd;
  const counted = review.days.filter((day) => !day.isFuture);
  const done = counted.reduce((sum, day) => sum + day.done, 0);
  const total = counted.reduce((sum, day) => sum + day.total, 0);
  const shift = (days: number) => setAnchor(toDateKey(addDays(parseISO(review.weekStart), days)));
  const title = isThisWeek ? "本周" : review.weekEnd < today ? "那一周" : "下一周";
  const openDay = review.days.find((day) => day.date === openDate) ?? null;

  return (
    <section className="surface mb-4 overflow-hidden" aria-label="本周完成情况">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ink/10 px-3 py-3 sm:px-4">
        <h2 className="text-base font-bold text-ink">{title}</h2>
        <span className="text-[13px] text-muted">{formatCompactDate(review.weekStart)}–{formatCompactDate(review.weekEnd)}</span>
        {total > 0 && <span className="text-[13px] font-semibold text-ink">已完成 {done}/{total}</span>}
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => shift(-7)} aria-label="上一周" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-stone-100 hover:text-ink"><ChevronLeft className="h-4 w-4" /></button>
          {!isThisWeek && <button onClick={() => setAnchor(today)} className="h-9 rounded-lg px-2 text-[13px] font-semibold text-primary hover:bg-primary/10">回到本周</button>}
          <button onClick={() => shift(7)} aria-label="下一周" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-stone-100 hover:text-ink"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </header>

      <div className="grid grid-cols-7 divide-x divide-ink/[0.07]">
        {review.days.map((day) => {
          const ratio = day.total ? day.done / day.total : 0;
          const allDone = day.total > 0 && day.done === day.total;
          return (
            <button key={day.date} onClick={() => setOpenDate(openDate === day.date ? null : day.date)} aria-expanded={openDate === day.date} aria-label={`${format(parseISO(day.date), "M月d日 EEEE", { locale: zhCN })}，${day.isFuture ? `安排了 ${day.total} 件` : `完成 ${day.done}/${day.total}`}`}
              className={`relative flex min-h-[4.75rem] flex-col items-center gap-1 px-0.5 py-2 hover:bg-mint/30 ${openDate === day.date ? "bg-primary/10" : day.isToday ? "bg-mint/40" : ""}`}>
              {openDate === day.date && <span aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" />}
              <span className={`text-[13px] ${day.isToday ? "font-bold text-primary" : "text-muted"}`}>{format(parseISO(day.date), "EEEEE", { locale: zhCN })}</span>
              <span className={`text-[13px] tabular-nums ${day.isToday ? "font-bold text-primary" : "font-semibold text-ink"}`}>{parseISO(day.date).getDate()}</span>
              {day.total === 0 ? <span className="text-[13px] text-stone-300">–</span>
                : day.isFuture ? <span className="text-[13px] tabular-nums text-muted">{day.total} 件</span>
                : <>
                  <span className="h-1 w-8 overflow-hidden rounded-full bg-stone-200 sm:w-12"><span className="block h-full rounded-full bg-primary" style={{ width: `${ratio * 100}%` }} /></span>
                  <span className={`text-[13px] font-semibold tabular-nums ${allDone ? "text-primary" : "text-ink"}`}>{allDone ? "✓" : `${day.done}/${day.total}`}</span>
                </>}
            </button>
          );
        })}
      </div>

      {openDay && (
        <div className="border-t border-ink/10 px-3 pb-2 pt-3 sm:px-4">
          <div className="flex items-center gap-2">
            <h3 className="text-[13px] font-semibold text-ink">{format(parseISO(openDay.date), "M月d日 EEEE", { locale: zhCN })}</h3>
            <span className="text-[13px] text-muted">{openDay.total === 0 ? "没有安排" : openDay.isFuture ? `安排了 ${openDay.total} 件` : openDay.pending.length ? `还没完成 ${openDay.pending.length} 件` : "都完成了"}</span>
            <button onClick={() => onOpenDay(openDay.date)} className="ml-auto inline-flex min-h-9 items-center gap-0.5 rounded-lg px-2 text-[13px] font-semibold text-primary hover:bg-primary/10">打开这一天<ChevronRight className="h-4 w-4" /></button>
          </div>
          {openDay.pending.length > 0 && <ul className="mt-1 divide-y divide-ink/[0.07]">
            {openDay.pending.map((item) => (
              <li key={item.key}>
                <button onClick={() => onOpenDay(item.date)} className="flex min-h-11 w-full items-center gap-2 text-left hover:bg-stone-50">
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: SUBJECT_DOT[item.subject] }} />
                  <span className="min-w-0 flex-1 truncate text-[15px] text-ink">{item.title}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-stone-300" />
                </button>
              </li>
            ))}
          </ul>}
        </div>
      )}
    </section>
  );
}
