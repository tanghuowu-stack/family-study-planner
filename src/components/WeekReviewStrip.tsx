import { addDays, format, parseISO } from "date-fns";
import { zhCN } from "date-fns/locale";
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, ClipboardCheck, Dumbbell, Hourglass } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { getWeekReview, type WeekReview, type WeekReviewDay, type WeekReviewItem } from "../data/weekReview";
import { formatCompactDate, todayKey, toDateKey } from "../utils/date";
import { sumWeeklyTimes } from "../utils/weeklyTimes";
import { SUBJECT_DOT } from "./GroupHeading";

/**
 * 统计 › 本周（2026-11-25 用户："只有一横条，非常不专业，至少也得铺满屏"）。自上而下：
 * 1. 周切换（‹ 本周 11月23日–11月29日 ›）；
 * 2. 三张概览卡：作业完成（到今天为止 done/total + 进度条）、每周练习（做了几次 / 目标）、还没做完（到今天为止）；
 * 3. 每天一张卡：星期、日期、完成数、进度条，下面列出那天的每件事（做完的打勾变灰、没做的空心圈），点一下进那天的今日页；
 *    Mac 宽屏 7 天一排，iPad / 窄 Mac 两到四列，手机一列；
 * 4. 每周练习：每项一行进度条（做够的打勾，过去的周没做够标红）。
 * 口径见 data/weekReview.ts：每件事只算一次，完成看现在的状态。
 */
export function WeekReviewStrip({ refreshKey, onOpenDay }: { refreshKey: number; onOpenDay: (date: string) => void }) {
  const [anchor, setAnchor] = useState(todayKey);
  const [review, setReview] = useState<WeekReview | null>(null);
  useEffect(() => { void getWeekReview(anchor).then(setReview); }, [anchor, refreshKey]);
  if (!review) return null;

  const today = todayKey();
  const isThisWeek = today >= review.weekStart && today <= review.weekEnd;
  const counted = review.days.filter((day) => !day.isFuture);
  const done = counted.reduce((sum, day) => sum + day.done, 0);
  const total = counted.reduce((sum, day) => sum + day.total, 0);
  const upcoming = review.days.filter((day) => day.isFuture).reduce((sum, day) => sum + day.total, 0);
  const shift = (days: number) => setAnchor(toDateKey(addDays(parseISO(review.weekStart), days)));
  const title = isThisWeek ? "本周" : review.weekEnd < today ? "那一周" : "下一周";
  const times = sumWeeklyTimes(review.weeklyTimes);
  const timesAllDone = times.target > 0 && times.done >= times.target;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

  return (
    <section aria-label="本周完成情况" className="space-y-3 sm:space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={() => shift(-7)} aria-label="上一周" className="flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-white hover:text-ink"><ChevronLeft className="h-5 w-5" /></button>
        <div className="min-w-0 text-center sm:text-left">
          <h2 className="text-[17px] font-bold leading-6 text-ink">{title}</h2>
          <p className="text-[13px] leading-4 text-muted">{formatCompactDate(review.weekStart)}–{formatCompactDate(review.weekEnd)}</p>
        </div>
        <button onClick={() => shift(7)} aria-label="下一周" className="flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-white hover:text-ink"><ChevronRight className="h-5 w-5" /></button>
        {!isThisWeek && <button onClick={() => setAnchor(today)} className="ml-auto min-h-11 rounded-lg border border-ink/10 bg-white px-3 text-[13px] font-semibold text-primary hover:bg-primary/5">回到本周</button>}
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <StatTile icon={ClipboardCheck} color="#2B7656" label="作业完成" value={<>{done}<span className="text-[15px] font-semibold text-muted">/{total}</span></>} ratio={total ? done / total : 0}
          note={total ? `完成 ${pct(done, total)}%` : upcoming ? `后面还有 ${upcoming} 件` : "没有安排"} />
        <StatTile icon={Dumbbell} color="#9364C7" label="每周练习" value={<>{times.done}<span className="text-[15px] font-semibold text-muted">/{times.target}</span></>} ratio={times.target ? times.done / times.target : 0}
          note={times.target ? (timesAllDone ? "都做够了" : `还差 ${times.target - times.done} 次`) : "没有练习"} />
        <StatTile icon={Hourglass} color={review.unfinished.length ? "#E36B4E" : "#2B7656"} label="还没做完" value={<>{review.unfinished.length}<span className="text-[15px] font-semibold text-muted"> 件</span></>}
          note={review.unfinished.length ? "到今天为止" : "都做完了"} />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4 xl:grid-cols-7">
        {review.days.map((day) => <DayCard key={day.date} day={day} onOpenDay={onOpenDay} />)}
      </div>

      {review.weeklyTimes.length > 0 && (
        <section className="surface overflow-hidden" aria-label="每周练习">
          <header className="flex items-center gap-2 border-b border-ink/10 px-3 py-3 sm:px-4">
            <h3 className="text-[15px] font-bold text-ink">每周练习</h3>
            <span className={`ml-auto rounded-full px-2.5 py-0.5 text-[13px] font-semibold tabular-nums ${timesAllDone ? "bg-primary/10 text-primary" : "bg-stone-100 text-ink"}`}>{times.done}/{times.target} 次</span>
          </header>
          <ul className="grid divide-y divide-ink/[0.06] sm:grid-cols-2 sm:divide-y-0">
            {review.weeklyTimes.map((item) => {
              const missed = !item.reached && review.weekEnd < today;
              return (
                <li key={item.taskId} className="flex min-h-12 items-center gap-3 px-3 py-2 sm:border-b sm:border-ink/[0.06] sm:px-4">
                  <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: SUBJECT_DOT[item.subject] }} />
                  <span className="w-24 shrink-0 truncate text-[15px] font-medium text-ink sm:w-28">{item.title}</span>
                  <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-stone-100"><span className={`block h-full rounded-full ${item.reached ? "bg-primary" : missed ? "bg-rose-300" : "bg-primary/60"}`} style={{ width: `${Math.min(100, item.target ? (item.done / item.target) * 100 : 0)}%` }} /></span>
                  <span className={`w-20 shrink-0 text-right text-[13px] font-semibold tabular-nums ${item.reached ? "text-primary" : missed ? "text-rose-700" : "text-ink"}`}>{item.reached && "✓ "}{item.done}/{item.target} {item.unit}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </section>
  );
}

function StatTile({ icon: Icon, color, label, value, note, ratio }: { icon: typeof Circle; color: string; label: string; value: ReactNode; note: string; ratio?: number }) {
  return (
    <div className="surface min-w-0 p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <span aria-hidden className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full sm:flex" style={{ background: `${color}1A`, color }}><Icon className="h-4 w-4" /></span>
        <span className="truncate text-[13px] font-medium text-muted">{label}</span>
      </div>
      <p className="mt-1.5 text-[24px] font-bold leading-8 tabular-nums text-ink sm:mt-2 sm:text-[28px]">{value}</p>
      {ratio !== undefined && <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-stone-100"><span className="block h-full rounded-full" style={{ width: `${Math.min(100, ratio * 100)}%`, background: color }} /></span>}
      <p className="mt-1.5 truncate text-[12px] text-muted sm:text-[13px]">{note}</p>
    </div>
  );
}

function DayCard({ day, onOpenDay }: { day: WeekReviewDay; onOpenDay: (date: string) => void }) {
  const date = parseISO(day.date);
  const allDone = day.total > 0 && day.done === day.total && !day.isFuture;
  const items: (WeekReviewItem & { done: boolean })[] = [...day.pending.map((item) => ({ ...item, done: false })), ...day.completed.map((item) => ({ ...item, done: true }))];
  return (
    <article className={`surface flex min-w-0 flex-col overflow-hidden ${day.isToday ? "ring-2 ring-primary/40" : ""}`}>
      <button onClick={() => onOpenDay(day.date)} className={`flex min-h-12 items-center gap-2 border-b border-ink/[0.07] px-3 py-2 text-left hover:bg-stone-50 ${day.isToday ? "bg-mint/50" : ""}`} aria-label={`打开${format(date, "M月d日 EEEE", { locale: zhCN })}`}>
        <span className={`text-[22px] font-bold leading-7 tabular-nums ${day.isToday ? "text-primary" : "text-ink"}`}>{date.getDate()}</span>
        <span className="min-w-0 flex-1 leading-4">
          <span className={`block whitespace-nowrap text-[13px] font-semibold ${day.isToday ? "text-primary" : "text-ink"}`}>{format(date, "EEEE", { locale: zhCN }).replace("星期", "周")}</span>
          <span className={`block whitespace-nowrap text-[12px] ${day.isToday ? "font-semibold text-primary" : "text-muted"}`}>{day.isToday ? "今天" : `${date.getMonth() + 1}月`}</span>
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold tabular-nums ${day.total === 0 ? "text-stone-300" : allDone ? "bg-primary/10 text-primary" : day.isFuture ? "bg-stone-100 text-muted" : "bg-stone-100 text-ink"}`}>
          {day.total === 0 ? "–" : allDone ? "✓" : day.isFuture ? `${day.total} 件` : `${day.done}/${day.total}`}
        </span>
      </button>
      {day.total > 0 && !day.isFuture && <span className="mx-3 mt-2 block h-1 overflow-hidden rounded-full bg-stone-100"><span className="block h-full rounded-full bg-primary" style={{ width: `${(day.done / day.total) * 100}%` }} /></span>}
      {items.length === 0
        ? <p className="px-3 py-4 text-[13px] text-stone-400">没有安排</p>
        : <ul className="flex-1 px-1.5 py-1.5">
          {items.map((item) => (
            <li key={item.key}>
              <button onClick={() => onOpenDay(item.date)} className="flex min-h-9 w-full items-center gap-2 rounded-md px-1.5 text-left hover:bg-stone-50">
                {item.done
                  ? <CheckCircle2 aria-label="已完成" className="h-4 w-4 shrink-0 text-primary" />
                  : <Circle aria-label={day.isFuture ? "还没到" : "没做完"} className={`h-4 w-4 shrink-0 ${day.isFuture ? "text-stone-300" : "text-alert/70"}`} />}
                <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: SUBJECT_DOT[item.subject] }} />
                <span className={`min-w-0 flex-1 truncate text-[14px] ${item.done ? "text-muted line-through decoration-stone-300" : "text-ink"}`}>{item.title}</span>
              </button>
            </li>
          ))}
        </ul>}
    </article>
  );
}
