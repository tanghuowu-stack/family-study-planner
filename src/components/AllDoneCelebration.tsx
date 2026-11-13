import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { getHabitCalendars, type HabitCalendar } from "../data/statsRepository";
import { todayKey } from "../utils/date";

/**
 * 今天的清单全部做完时的正向反馈（2026-11 界面审查第 15 条）。
 * 激励区可以比信息区活泼一点（TASK_05）：大一点的对勾、一句夸奖、各打卡项目的连续天数。
 * 只在"今天"显示；动效只有一次轻微放大，prefers-reduced-motion 下关闭。
 */
export function AllDoneCelebration({ count }: { count: number }) {
  const [streaks, setStreaks] = useState<HabitCalendar[]>([]);
  useEffect(() => {
    getHabitCalendars(todayKey().slice(0, 7)).then((cals) => setStreaks(cals.filter((cal) => cal.currentStreak > 0))).catch(() => setStreaks([]));
  }, [count]);
  return (
    <div role="status" className="flex items-center gap-4 px-4 py-5 sm:px-5">
      <span className="flex h-14 w-14 shrink-0 animate-[celebrate_600ms_ease-out] items-center justify-center rounded-full bg-primary text-white motion-reduce:animate-none">
        <Check className="h-8 w-8" strokeWidth={3} />
      </span>
      <div className="min-w-0">
        <p className="text-lg font-bold text-ink">今天的 {count} 件事都做完了！</p>
        {streaks.length > 0
          ? <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[15px] text-muted">{streaks.map((cal) => <span key={cal.taskId} className="whitespace-nowrap">{cal.title} <span className="font-semibold text-ink">🔥{cal.currentStreak} 天</span></span>)}</p>
          : <p className="mt-1 text-[15px] text-muted">认真做完每一件，明天继续加油。</p>}
      </div>
    </div>
  );
}
