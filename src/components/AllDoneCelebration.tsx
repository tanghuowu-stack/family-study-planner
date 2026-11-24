import { Check } from "lucide-react";

/**
 * 今天的清单全部做完时的正向反馈（2026-11 界面审查第 15 条）。
 * 激励区可以比信息区活泼一点（TASK_05）：大一点的对勾、一句夸奖。
 * 2026-11-24 用户：🔥 连续天数统计不对，去掉（打卡月历和这里都不显示）。
 * 只在"今天"显示；动效只有一次轻微放大，prefers-reduced-motion 下关闭。
 */
export function AllDoneCelebration({ count }: { count: number }) {
  return (
    <div role="status" className="flex items-center gap-4 px-4 py-5 sm:px-5">
      <span className="flex h-14 w-14 shrink-0 animate-[celebrate_600ms_ease-out] items-center justify-center rounded-full bg-primary text-white motion-reduce:animate-none">
        <Check className="h-8 w-8" strokeWidth={3} />
      </span>
      <div className="min-w-0">
        <p className="text-lg font-bold text-ink">今天的 {count} 件事都做完了！</p>
        <p className="mt-1 text-[15px] text-muted">认真做完每一件，明天继续加油。</p>
      </div>
    </div>
  );
}
