import { addDays, format, parseISO } from "date-fns";
import { zhCN } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { getWeekReview, type WeekReview } from "../data/weekReview";
import { formatCompactDate, todayKey, toDateKey } from "../utils/date";
import { sumWeeklyTimes } from "../utils/weeklyTimes";
import { SUBJECT_DOT } from "./GroupHeading";

/**
 * "周计划及打卡"页顶部的"本周"条（2026-11-18 从月视图搬来）：7 天各自完成几件。默认只显示这一行；点某一天，下方展开那天还没完成的事
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
  // 每周几次的总量（各项目标之和 / 已做之和），放在 7 天后面的第 8 列
  const hasTimes = review.weeklyTimes.length > 0;
  const times = sumWeeklyTimes(review.weeklyTimes);
  const timesAllDone = times.target > 0 && times.done >= times.target;
  const timesMissed = !timesAllDone && review.weekEnd < today;

  return (
    <section className="surface mb-3 overflow-hidden sm:mb-4" aria-label="本周完成情况">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-ink/10 py-1.5 pl-3 pr-1.5 sm:gap-x-3 sm:px-4 sm:py-3">
        <h2 className="text-base font-bold text-ink">{title}</h2>
        <span className="text-[13px] text-muted">{formatCompactDate(review.weekStart)}–{formatCompactDate(review.weekEnd)}</span>
        {total > 0 && <span className="text-[13px] font-semibold text-ink">已完成 {done}/{total}</span>}
        <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
          <button onClick={() => shift(-7)} aria-label="上一周" className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg text-muted hover:bg-stone-100 hover:text-ink"><ChevronLeft className="h-4 w-4" /></button>
          {!isThisWeek && <button onClick={() => setAnchor(today)} className="h-8 sm:h-9 rounded-lg px-2 text-[13px] font-semibold text-primary hover:bg-primary/10">回到本周</button>}
          <button onClick={() => shift(7)} aria-label="下一周" className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg text-muted hover:bg-stone-100 hover:text-ink"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </header>

      <div className={`grid divide-x divide-ink/[0.07] ${hasTimes ? "grid-cols-[repeat(7,minmax(0,1fr))_minmax(0,1.5fr)]" : "grid-cols-7"}`}>
        {review.days.map((day) => {
          const ratio = day.total ? day.done / day.total : 0;
          const allDone = day.total > 0 && day.done === day.total;
          return (
            <button key={day.date} onClick={() => setOpenDate(openDate === day.date ? null : day.date)} aria-expanded={openDate === day.date} aria-label={`${format(parseISO(day.date), "M月d日 EEEE", { locale: zhCN })}，${day.isFuture ? `安排了 ${day.total} 件` : `完成 ${day.done}/${day.total}`}`}
              className={`relative flex min-h-[4rem] flex-col items-center gap-0.5 px-0.5 py-1.5 hover:bg-mint/30 sm:min-h-[4.75rem] sm:gap-1 sm:py-2 ${openDate === day.date ? "bg-primary/10" : day.isToday ? "bg-mint/40" : ""}`}>
              {openDate === day.date && <span aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" />}
              <span className={`text-[12px] leading-4 sm:text-[13px] sm:leading-5 ${day.isToday ? "font-bold text-primary" : "text-muted"}`}>{format(parseISO(day.date), "EEEEE", { locale: zhCN })}</span>
              <span className={`text-[13px] leading-4 tabular-nums sm:leading-5 ${day.isToday ? "font-bold text-primary" : "font-semibold text-ink"}`}>{parseISO(day.date).getDate()}</span>
              {day.total === 0 ? <span className="text-[13px] leading-4 text-stone-300">–</span>
                : day.isFuture ? <span className="text-[12px] leading-4 tabular-nums text-muted sm:text-[13px]">{day.total} 件</span>
                : <>
                  <span className={`h-1 overflow-hidden rounded-full bg-stone-200 ${hasTimes ? "w-6 sm:w-10" : "w-8 sm:w-12"}`}><span className="block h-full rounded-full bg-primary" style={{ width: `${ratio * 100}%` }} /></span>
                  <span className={`text-[12px] font-semibold leading-4 tabular-nums sm:text-[13px] ${allDone ? "text-primary" : "text-ink"}`}>{allDone ? "✓" : `${day.done}/${day.total}`}</span>
                </>}
            </button>
          );
        })}
        {hasTimes && (
          <div aria-label={`每周练习，这一周做了 ${times.done}/${times.target} 次`} className="flex min-h-[4rem] flex-col items-center gap-0.5 bg-stone-50/70 px-0.5 py-1.5 sm:min-h-[4.75rem] sm:gap-1 sm:py-2">
            <span className="whitespace-nowrap text-[12px] leading-4 text-muted sm:text-[13px] sm:leading-5"><span className="sm:hidden">练习</span><span className="hidden sm:inline">每周练习</span></span>
            <span className={`text-[13px] font-semibold leading-4 tabular-nums sm:leading-5 ${timesAllDone ? "text-primary" : timesMissed ? "text-rose-700" : "text-ink"}`}>{times.done}/{times.target}</span>
            <span className="h-1 w-8 overflow-hidden rounded-full bg-stone-200 sm:w-14"><span className="block h-full rounded-full bg-primary" style={{ width: `${times.target ? (times.done / times.target) * 100 : 0}%` }} /></span>
            <span className={`text-[12px] font-semibold leading-4 sm:text-[13px] ${timesAllDone ? "text-primary" : "text-muted"}`}>{timesAllDone ? "✓" : `差 ${times.target - times.done}`}</span>
          </div>
        )}
      </div>

      {hasTimes && (
        // 每周几次不排到哪一天：单独一行，看这一周做了几次（过去的周没做够标出来）
        <div className="flex flex-wrap items-center gap-1.5 border-t border-ink/10 px-3 py-2 sm:gap-x-2 sm:px-4 sm:py-2.5" aria-label="每周几次">
          <span className="text-[12px] font-semibold text-muted sm:text-[13px]">每周几次 <span className={`tabular-nums ${timesAllDone ? "text-primary" : "text-ink"}`}>{times.done}/{times.target}</span></span>
          {review.weeklyTimes.map((item) => {
            const missed = !item.reached && review.weekEnd < today;
            return (
              <span key={item.taskId} title={`${item.title}：这一周做了 ${item.done}/${item.target} ${item.unit}`}
                className={`inline-flex min-h-6 items-center gap-1 rounded-full px-2 text-[12px] ring-1 ring-inset sm:min-h-7 sm:gap-1.5 sm:px-2.5 sm:text-[13px] ${item.reached ? "bg-mint/60 ring-primary/20" : missed ? "bg-rose-50 ring-rose-200" : "bg-white ring-ink/10"}`}>
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: SUBJECT_DOT[item.subject] }} />
                <span className="max-w-[5.5rem] truncate text-ink sm:max-w-[7rem]">{item.title}</span>
                <span className={`font-semibold tabular-nums ${item.reached ? "text-primary" : missed ? "text-rose-700" : "text-ink"}`}>{item.reached ? `✓ ${item.done}/${item.target}` : `${item.done}/${item.target}`}</span>
              </span>
            );
          })}
        </div>
      )}

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
