/**
 * StreakPanel（TASK_08 统计页主体）
 * 数据全部来自 statsRepository 现成函数，UI 层不做聚合计算。
 * 视觉遵守 docs/style.md：primary/mint 主题、卡片 rounded-2xl border-stone-100、
 * 学科色沿用 MAIN_CATEGORY_META、金色（复活）用 amber、休息日用 stone。
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { addDays, addMonths, endOfMonth, getDay, parseISO, startOfMonth } from "date-fns";
import {
  applyReviveCard,
  getStreakData,
  getSubjectComparison,
  getWeekCompletionRate,
  type StreakData,
  type SubjectComparisonItem,
  type WeekCompletionRate,
} from "../data/statsRepository";
import { MAIN_CATEGORY_META } from "../utils/taskMeta";
import { todayKey, toDateKey, formatCompactDate } from "../utils/date";

const BADGES: { days: number; emoji: string }[] = [
  { days: 3, emoji: "🌱" }, { days: 7, emoji: "⭐" }, { days: 14, emoji: "🔥" },
  { days: 30, emoji: "🏅" }, { days: 60, emoji: "🏆" }, { days: 100, emoji: "👑" },
];

const encourage = (streak: number): string => {
  if (streak >= 30) return "坚持就是超能力！";
  if (streak >= 14) return "两周不间断，真了不起！";
  if (streak >= 7) return "满一周啦，继续冲！";
  if (streak >= 3) return "势头正好，别停下！";
  if (streak >= 1) return "好的开始，明天见！";
  return "完成一件打卡任务，开启记录吧！";
};

export function StreakPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [streak, setStreak] = useState<StreakData | null>(null);
  const [week, setWeek] = useState<WeekCompletionRate | null>(null);
  const [subjects, setSubjects] = useState<SubjectComparisonItem[]>([]);
  const [monthAnchor, setMonthAnchor] = useState(() => todayKey().slice(0, 7) + "-01");
  const [reviveOpen, setReviveOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const notify = (text: string, error = false) => { setToast({ text, error }); setTimeout(() => setToast(null), 2600); };

  const reload = () => {
    getStreakData().then(setStreak).catch(() => setStreak(null));
    getWeekCompletionRate().then(setWeek).catch(() => setWeek(null));
    getSubjectComparison().then(setSubjects).catch(() => setSubjects([]));
  };
  useEffect(reload, [refreshKey]);

  const today = todayKey();
  const checkins = new Set(streak?.checkinDates ?? []);
  const rests = new Set(streak?.restDays ?? []);
  const revived = new Set(streak?.revivedDates ?? []);
  const missed = new Set(streak?.missedDays ?? []);

  // 断卡后 3 天内可补的日期：昨天起往前 3 天里的"漏卡日"（有应做未完成），取最近的一天
  const reviveCandidate = (() => {
    if (!streak) return null;
    for (let back = 1; back <= 3; back++) {
      const d = toDateKey(addDays(parseISO(today), -back));
      if (missed.has(d)) return d;
    }
    return null;
  })();

  const confirmRevive = async () => {
    if (!reviveCandidate) return;
    try {
      await applyReviveCard(reviveCandidate);
      setReviveOpen(false);
      notify(`已补上 ${formatCompactDate(reviveCandidate)} 的打卡`);
      reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : "补卡失败", true);
    }
  };

  return <div className="mt-5 space-y-4">
    {/* 打卡卡片 */}
    <section className="rounded-2xl border border-stone-100 bg-white p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-muted">连续打卡</p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-bold text-primary sm:text-5xl">{streak?.currentStreak ?? 0}</span>
            <span className="text-sm font-medium text-ink">天</span>
          </p>
          <p className="mt-1 text-sm text-ink">{encourage(streak?.currentStreak ?? 0)}</p>
          <p className="mt-1 text-xs text-muted">历史最长 {streak?.longestStreak ?? 0} 天</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-mint px-3 py-1.5 text-sm font-medium text-ink">🎫 复活卡 × {streak?.reviveBalance ?? 0}</span>
          {reviveCandidate && <button onClick={() => setReviveOpen(true)} className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100">申请复活卡补卡</button>}
        </div>
      </div>
    </section>

    {/* 打卡月历 */}
    <section className="rounded-2xl border border-stone-100 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">打卡月历</h3>
        <div className="flex items-center gap-1 text-sm text-stone-600">
          <button onClick={() => setMonthAnchor(toDateKey(addMonths(parseISO(monthAnchor), -1)))} className="rounded-lg p-1 hover:bg-mint" aria-label="上个月"><ChevronLeft className="h-4 w-4" /></button>
          <span className="min-w-24 text-center font-medium">{monthAnchor.slice(0, 4)}年{Number(monthAnchor.slice(5, 7))}月</span>
          <button onClick={() => setMonthAnchor(toDateKey(addMonths(parseISO(monthAnchor), 1)))} className="rounded-lg p-1 hover:bg-mint" aria-label="下个月"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
      <MonthGrid anchor={monthAnchor} today={today} checkins={checkins} rests={rests} revived={revived} />
      <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-primary" />打卡</span>
        <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-amber-400" />复活卡补</span>
        <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-stone-300" />休息日</span>
      </div>
    </section>

    {/* 本周完成率 */}
    <section className="rounded-2xl border border-stone-100 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold">本周完成率</h3>
      {week && week.rate !== null
        ? <div className="mt-3">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-2xl font-bold text-primary">{Math.round(week.rate * 100)}%</span>
              <span className="text-xs text-muted">已完成 {week.done} / 应做 {week.total}</span>
            </div>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-mint"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round(week.rate * 100)}%` }} /></div>
          </div>
        : <p className="mt-2 text-sm text-muted">本周无安排</p>}
    </section>

    {/* 学科对比 */}
    <section className="rounded-2xl border border-stone-100 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold">本周学科对比</h3>
      {subjects.length
        ? <div className="mt-3 space-y-2.5">{subjects.map((item) => {
            const meta = MAIN_CATEGORY_META[item.mainCategory];
            const pct = item.rate === null ? 0 : Math.round(item.rate * 100);
            return <div key={item.mainCategory} className="flex items-center gap-2">
              <span className={`w-16 shrink-0 rounded-md px-1.5 py-0.5 text-center text-[11px] font-medium ${meta.className}`}>{meta.label}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-100"><div className={`h-full rounded-full ${meta.dot}`} style={{ width: `${pct}%` }} /></div>
              <span className="w-14 shrink-0 text-right text-xs text-muted">{item.done}/{item.total}</span>
            </div>;
          })}</div>
        : <p className="mt-2 text-sm text-muted">本周无安排</p>}
    </section>

    {/* 徽章区 */}
    <section className="rounded-2xl border border-stone-100 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold">坚持徽章</h3>
      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">{BADGES.map(({ days, emoji }) => {
        const unlocked = (streak?.longestStreak ?? 0) >= days;
        return <div key={days} className={`flex flex-col items-center rounded-xl px-2 py-2.5 ${unlocked ? "bg-mint/60" : "border border-dashed border-stone-200 bg-stone-50 opacity-50 grayscale"}`}>
          <span className="text-2xl">{emoji}</span>
          <span className={`mt-1 text-[11px] font-medium ${unlocked ? "text-ink" : "text-muted"}`}>连续 {days} 天</span>
        </div>;
      })}</div>
    </section>

    {/* 复活卡确认框 */}
    {reviveOpen && reviveCandidate && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/30 p-4" onClick={() => setReviveOpen(false)}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold">使用复活卡补卡</h3>
        <p className="mt-2 text-sm text-stone-600">将补上 <span className="font-semibold text-ink">{formatCompactDate(reviveCandidate)}</span> 的打卡。</p>
        <p className="mt-1 text-xs text-muted">当前剩余复活卡 {streak?.reviveBalance ?? 0} 张，使用后减 1。</p>
        <HoldConfirmButton onConfirm={confirmRevive} />
        <button onClick={() => setReviveOpen(false)} className="mt-2 w-full rounded-xl border bg-white px-4 py-2 text-sm text-stone-500">取消</button>
      </div>
    </div>}

    {toast && <div className={`fixed bottom-24 left-1/2 z-[85] -translate-x-1/2 rounded-full px-5 py-2.5 text-sm shadow-xl lg:bottom-8 ${toast.error ? "bg-sun font-medium text-ink" : "bg-primary text-white"}`}>{toast.text}</div>}
  </div>;
}

/** 家长确认：长按 2 秒触发，松手取消（进度用背景填充表现） */
function HoldConfirmButton({ onConfirm }: { onConfirm: () => void }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const start = () => {
    setHolding(true);
    timer.current = window.setTimeout(() => { setHolding(false); onConfirm(); }, 2000);
  };
  const cancel = () => { setHolding(false); window.clearTimeout(timer.current); };
  return <button
    onPointerDown={start} onPointerUp={cancel} onPointerLeave={cancel} onContextMenu={(e) => e.preventDefault()}
    className="relative mt-4 w-full touch-none select-none overflow-hidden rounded-xl border border-primary px-4 py-2.5 text-sm font-semibold text-primary"
  >
    <span className="absolute inset-y-0 left-0 bg-primary/25" style={{ width: holding ? "100%" : "0%", transitionProperty: "width", transitionDuration: holding ? "2000ms" : "150ms", transitionTimingFunction: "linear" }} />
    <span className="relative">长按 2 秒 · 家长确认</span>
  </button>;
}

/** 打卡月历格：周一起始，与 getWeekStartKey 口径一致 */
function MonthGrid({ anchor, today, checkins, rests, revived }: { anchor: string; today: string; checkins: Set<string>; rests: Set<string>; revived: Set<string> }) {
  const first = startOfMonth(parseISO(anchor));
  const last = endOfMonth(first);
  const leadingBlanks = (getDay(first) + 6) % 7; // 周一=0
  const days: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) days.push(toDateKey(d));
  return <div className="mt-3">
    <div className="grid grid-cols-7 text-center text-[11px] text-muted">{["一", "二", "三", "四", "五", "六", "日"].map((w) => <span key={w}>{w}</span>)}</div>
    <div className="mt-1 grid grid-cols-7 gap-y-1">
      {Array.from({ length: leadingBlanks }, (_, i) => <span key={`b${i}`} />)}
      {days.map((d) => {
        const style = checkins.has(d)
          ? "bg-primary font-semibold text-white"
          : revived.has(d)
            ? "bg-amber-400 font-semibold text-white"
            : rests.has(d)
              ? "bg-stone-200 text-stone-400"
              : "text-stone-600";
        return <span key={d} className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs ${style} ${d === today ? "ring-2 ring-primary/40" : ""}`}>{Number(d.slice(8))}</span>;
      })}
    </div>
  </div>;
}
