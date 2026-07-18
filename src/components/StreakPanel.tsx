/**
 * StreakPanel（TASK_08 统计页·打卡区）+ WeekStatsPanel（任务统计区）
 * 数据全部来自 statsRepository 现成函数，UI 层不做聚合计算。
 * 视觉遵守 docs/style.md：打卡区用分组容器（border-mint bg-mint/40），
 * 漏卡标记用 rose（见 style.md §7 补充），学科色沿用 MAIN_CATEGORY_META。
 */
import { ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { addDays, addMonths, endOfMonth, getDay, parseISO, startOfMonth } from "date-fns";
import {
  applyReviveCard,
  getDailyCheckItems,
  getPerItemStreaks,
  getStreakData,
  getSubjectComparison,
  getWeekCompletionRate,
  setDailyCheckOverride,
  type DailyCheckItem,
  type PerItemStreak,
  type StreakData,
  type SubjectComparisonItem,
  type WeekCompletionRate,
} from "../data/statsRepository";
import { taskRepository, scheduleOccursOn } from "../data/taskRepository";
import { MAIN_CATEGORY_META } from "../utils/taskMeta";
import { todayKey, toDateKey, formatCompactDate } from "../utils/date";
import type { Task } from "../types/task";

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
  return "今天把打卡项做完，连续记录就开始啦！";
};

export function StreakPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [streak, setStreak] = useState<StreakData | null>(null);
  const [perItems, setPerItems] = useState<PerItemStreak[] | null>(null);
  const [todayItems, setTodayItems] = useState<DailyCheckItem[]>([]);
  const [monthAnchor, setMonthAnchor] = useState(() => todayKey().slice(0, 7) + "-01");
  const [reviveOpen, setReviveOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const notify = (text: string, error = false) => { setToast({ text, error }); setTimeout(() => setToast(null), 2600); };

  const reload = () => {
    getStreakData().then(setStreak).catch(() => setStreak(null));
    getPerItemStreaks().then(setPerItems).catch(() => setPerItems([]));
    getDailyCheckItems(todayKey()).then(setTodayItems).catch(() => setTodayItems([]));
  };
  useEffect(reload, [refreshKey]);

  const today = todayKey();
  const checkins = new Set(streak?.checkinDates ?? []);
  const rests = new Set(streak?.restDays ?? []);
  const revived = new Set(streak?.revivedDates ?? []);
  const missed = new Set(streak?.missedDays ?? []);
  const hasItems = (perItems?.length ?? 0) > 0;
  const todayDone = todayItems.filter((i) => i.done).length;
  const todayLeft = todayItems.length - todayDone;

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

  return <section className="mt-5 rounded-2xl border border-mint bg-mint/40 p-3">
    <h2 className="px-1 text-base font-bold text-ink">打卡</h2>
    <div className="mt-2 space-y-3">
      {/* 总连续卡片 */}
      <div className="rounded-2xl border border-stone-100 bg-white p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-muted">连续打卡</p>
            <p className="mt-1 flex items-baseline gap-2">
              <span className="text-4xl font-bold text-primary sm:text-5xl">{streak?.currentStreak ?? 0}</span>
              <span className="text-sm font-medium text-ink">天</span>
            </p>
            {!hasItems
              ? <p className="mt-1 text-sm text-ink">还没有打卡项目，去任务里勾选「计入打卡」</p>
              : <>
                  <p className="mt-1 text-sm text-ink">
                    {todayItems.length === 0 ? "今日无需打卡" : todayLeft === 0 ? "今日打卡完成！" : `今日还差 ${todayLeft} 项完成打卡`}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">{encourage(streak?.currentStreak ?? 0)}</p>
                </>}
            <p className="mt-1 text-xs text-muted">历史最长 {streak?.longestStreak ?? 0} 天</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-mint px-3 py-1.5 text-sm font-medium text-ink">🎫 复活卡 × {streak?.reviveBalance ?? 0}</span>
            {reviveCandidate && <button onClick={() => setReviveOpen(true)} className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100">申请复活卡补卡</button>}
            {hasItems && <button onClick={() => setAdjustOpen(true)} className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50"><SlidersHorizontal className="h-3.5 w-3.5" />调整今日打卡项</button>}
          </div>
        </div>
      </div>

      {/* 我的打卡项目 */}
      {hasItems && <div className="rounded-2xl border border-stone-100 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold">我的打卡项目</h3>
        <div className="mt-2 divide-y divide-stone-100">
          {perItems!.map((item) => <div key={item.taskId} className="flex items-center gap-2 py-2">
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{item.title}</span>
            <span className="flex shrink-0 gap-1">{item.recentDays.map((d) => (
              <span key={d.date} title={d.date} className={`flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-semibold ${
                d.status === "done" ? "bg-primary text-white" : d.status === "missed" ? "bg-rose-100 text-rose-500" : "bg-stone-100 text-stone-300"
              }`}>{d.status === "done" ? "✓" : d.status === "missed" ? "✕" : "·"}</span>
            ))}</span>
            <span className="w-12 shrink-0 text-right text-sm font-semibold text-ink">🔥{item.currentStreak}</span>
          </div>)}
        </div>
      </div>}

      {/* 打卡月历 */}
      <div className="rounded-2xl border border-stone-100 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">打卡月历</h3>
          <div className="flex items-center gap-1 text-sm text-stone-600">
            <button onClick={() => setMonthAnchor(toDateKey(addMonths(parseISO(monthAnchor), -1)))} className="rounded-lg p-1 hover:bg-mint" aria-label="上个月"><ChevronLeft className="h-4 w-4" /></button>
            <span className="min-w-24 text-center font-medium">{monthAnchor.slice(0, 4)}年{Number(monthAnchor.slice(5, 7))}月</span>
            <button onClick={() => setMonthAnchor(toDateKey(addMonths(parseISO(monthAnchor), 1)))} className="rounded-lg p-1 hover:bg-mint" aria-label="下个月"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
        <MonthGrid anchor={monthAnchor} today={today} checkins={checkins} rests={rests} revived={revived} missed={missed} />
        <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-primary" />打卡</span>
          <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-rose-400" />漏卡</span>
          <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-amber-400" />复活卡补</span>
          <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-stone-300" />休息日</span>
        </div>
      </div>

      {/* 徽章区 */}
      <div className="rounded-2xl border border-stone-100 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold">坚持徽章</h3>
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">{BADGES.map(({ days, emoji }) => {
          const unlocked = (streak?.longestStreak ?? 0) >= days;
          return <div key={days} className={`flex flex-col items-center rounded-xl px-2 py-2.5 ${unlocked ? "bg-mint/60" : "border border-dashed border-stone-200 bg-stone-50 opacity-50 grayscale"}`}>
            <span className="text-2xl">{emoji}</span>
            <span className={`mt-1 text-[11px] font-medium ${unlocked ? "text-ink" : "text-muted"}`}>连续 {days} 天</span>
          </div>;
        })}</div>
      </div>
    </div>

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

    {/* 调整今日打卡项 */}
    {adjustOpen && <AdjustTodayDialog todayItems={todayItems} onClose={() => setAdjustOpen(false)} onSaved={() => { setAdjustOpen(false); notify("今日打卡项已更新"); reload(); }} onError={(msg) => notify(msg, true)} />}

    {toast && <div className={`fixed bottom-24 left-1/2 z-[85] -translate-x-1/2 rounded-full px-5 py-2.5 text-sm shadow-xl lg:bottom-8 ${toast.error ? "bg-sun font-medium text-ink" : "bg-primary text-white"}`}>{toast.text}</div>}
  </section>;
}

/** 任务统计区：本周完成率 + 学科对比（样式与拆分前一致） */
export function WeekStatsPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [week, setWeek] = useState<WeekCompletionRate | null>(null);
  const [subjects, setSubjects] = useState<SubjectComparisonItem[]>([]);
  useEffect(() => {
    getWeekCompletionRate().then(setWeek).catch(() => setWeek(null));
    getSubjectComparison().then(setSubjects).catch(() => setSubjects([]));
  }, [refreshKey]);

  return <div className="space-y-4">
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
  </div>;
}

/**
 * 调整今日打卡项：默认候选 = 今天排期到的 enableStreak 任务；
 * 取消勾选默认项 → removed，勾选默认集之外的任务 → added，
 * 保存调 setDailyCheckOverride（数据层负责去重与空覆盖清理）。
 */
function AdjustTodayDialog({ todayItems, onClose, onSaved, onError }: {
  todayItems: DailyCheckItem[];
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const today = todayKey();
  const [rows, setRows] = useState<{ task: Task; isDefault: boolean; included: boolean }[] | null>(null);
  const [extras, setExtras] = useState<Task[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const all = await taskRepository.listAll();
      const scheduledToday = all.filter((t) => t.status !== "cancelled" && scheduleOccursOn(t, today));
      const defaultIds = new Set(scheduledToday.filter((t) => t.enableStreak === true).map((t) => t.id));
      const includedIds = new Set(todayItems.map((i) => i.task.id));
      const rowMap = new Map<string, { task: Task; isDefault: boolean; included: boolean }>();
      for (const t of scheduledToday.filter((t) => t.enableStreak === true)) rowMap.set(t.id, { task: t, isDefault: true, included: includedIds.has(t.id) });
      for (const item of todayItems) if (!rowMap.has(item.task.id)) rowMap.set(item.task.id, { task: item.task, isDefault: defaultIds.has(item.task.id), included: true });
      setRows([...rowMap.values()]);
      setExtras(scheduledToday.filter((t) => !t.enableStreak && !rowMap.has(t.id)));
    })();
  }, [today, todayItems]);

  const toggle = (id: string) => setRows((rs) => rs!.map((r) => (r.task.id === id ? { ...r, included: !r.included } : r)));
  const addExtra = (id: string) => {
    const task = extras.find((t) => t.id === id);
    if (!task) return;
    setRows((rs) => [...rs!, { task, isDefault: false, included: true }]);
    setExtras((es) => es.filter((t) => t.id !== id));
  };
  const save = async () => {
    if (!rows) return;
    setSaving(true);
    try {
      const removed = rows.filter((r) => r.isDefault && !r.included).map((r) => r.task.id);
      const added = rows.filter((r) => !r.isDefault && r.included).map((r) => r.task.id);
      await setDailyCheckOverride(today, { added, removed });
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/30 p-4" onClick={onClose}>
    <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
      <h3 className="font-semibold">调整今日打卡项</h3>
      <p className="mt-1 text-xs text-muted">只影响今天：取消勾选可临时移出，也可把今天的其他任务临时加入打卡。</p>
      {!rows
        ? <p className="mt-3 text-sm text-muted">加载中…</p>
        : <>
            <div className="mt-3 max-h-56 space-y-1 overflow-y-auto">
              {rows.length === 0 && <p className="text-sm text-muted">今天没有排期中的打卡项</p>}
              {rows.map((r) => <label key={r.task.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-mint/40">
                <input type="checkbox" checked={r.included} onChange={() => toggle(r.task.id)} className="h-4 w-4 rounded" />
                <span className="min-w-0 flex-1 truncate text-ink">{r.task.title || "（无标题）"}</span>
                {!r.isDefault && <span className="shrink-0 rounded-md bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500">临时加入</span>}
              </label>)}
            </div>
            {extras.length > 0 && <select value="" onChange={(e) => addExtra(e.target.value)} className="mt-3 w-full rounded-lg border px-2.5 py-1.5 text-sm text-stone-600">
              <option value="" disabled>添加今天的其他任务…</option>
              {extras.map((t) => <option key={t.id} value={t.id}>{t.title || "（无标题）"}</option>)}
            </select>}
            <div className="mt-4 flex gap-2">
              <button onClick={save} disabled={saving} className="flex-1 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "保存中…" : "保存"}</button>
              <button onClick={onClose} className="rounded-xl border bg-white px-4 py-2 text-sm text-stone-500">取消</button>
            </div>
          </>}
    </div>
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
function MonthGrid({ anchor, today, checkins, rests, revived, missed }: { anchor: string; today: string; checkins: Set<string>; rests: Set<string>; revived: Set<string>; missed: Set<string> }) {
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
              : missed.has(d)
                ? "bg-rose-100 font-semibold text-rose-500"
                : "text-stone-600";
        return <span key={d} className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs ${style} ${d === today ? "ring-2 ring-primary/40" : ""}`}>{Number(d.slice(8))}</span>;
      })}
    </div>
  </div>;
}
