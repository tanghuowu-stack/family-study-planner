/**
 * HabitSection（统计页·打卡区）
 * 打卡 = 若干项目各自一张月历。数据来自 statsRepository，UI 不做聚合计算。
 * 视觉遵守 docs/style.md：primary/mint 主题、卡片 rounded-2xl border-stone-100，
 * 完成绿（primary）、漏卡红（rose，见 style.md §功能色补充）、off 灰（stone）。
 */
import { ChevronDown, ChevronLeft, ChevronRight, ListChecks, CalendarOff, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { addDays, addMonths, endOfMonth, getDay, parseISO, startOfMonth } from "date-fns";
import {
  getHabitCalendars,
  getHabitCandidates,
  getHiddenHabitCandidates,
  getRestDays,
  hideHabitCandidate,
  setHabitEnabled,
  setHabitStartDate,
  toggleRestDay,
  unhideHabitCandidate,
  type HabitCalendar,
  type HabitCandidate,
  type HabitDayStatus,
} from "../data/statsRepository";
import { todayKey, toDateKey } from "../utils/date";

const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

export function HabitSection() {
  const [month, setMonth] = useState(() => todayKey().slice(0, 7));
  const [calendars, setCalendars] = useState<HabitCalendar[] | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [restOpen, setRestOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    getHabitCalendars(month).then(setCalendars).catch(() => setCalendars([]));
  }, [month, refreshKey]);

  const shiftMonth = (delta: number) => setMonth(toDateKey(addMonths(parseISO(`${month}-01`), delta)).slice(0, 7));

  return (
    <section className="mt-5">
      {/* 顶部：标题 + 入口 */}
      <div className="flex items-center justify-between px-1">
        <h2 className="text-base font-bold text-ink">打卡</h2>
        <div className="flex gap-2">
          <button onClick={() => setManageOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-mint/40">
            <ListChecks className="h-3.5 w-3.5" />管理打卡项目
          </button>
          <button onClick={() => setRestOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-mint/40">
            <CalendarOff className="h-3.5 w-3.5" />休息日
          </button>
        </div>
      </div>

      {/* 主体：每个项目一张月历卡 */}
      {calendars === null ? (
        <p className="mt-4 px-1 text-sm text-muted">加载中…</p>
      ) : calendars.length === 0 ? (
        <div className="mt-3 rounded-2xl border border-dashed border-stone-200 bg-white p-6 text-center">
          <p className="text-sm text-muted">还没有打卡项目，勾选几个每天要做的任务吧</p>
          <button onClick={() => setManageOpen(true)} className="mt-3 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white">管理打卡项目</button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {calendars.map((cal) => (
            <HabitCard key={cal.taskId} cal={cal} month={month} onPrevMonth={() => shiftMonth(-1)} onNextMonth={() => shiftMonth(1)} />
          ))}
        </div>
      )}

      {manageOpen && <ManageDialog onClose={() => setManageOpen(false)} onChanged={reload} />}
      {restOpen && <RestDayDialog initialMonth={month} onClose={() => setRestOpen(false)} onChanged={reload} />}
    </section>
  );
}

function HabitCard({ cal, month, onPrevMonth, onNextMonth }: { cal: HabitCalendar; month: string; onPrevMonth: () => void; onNextMonth: () => void }) {
  return (
    <div className="rounded-2xl border border-stone-100 bg-white p-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-ink">{cal.title}</span>
          <span className="shrink-0 rounded-full bg-mint px-2 py-0.5 text-xs font-medium text-ink">🔥{cal.currentStreak}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-sm text-stone-600">
          <button onClick={onPrevMonth} className="rounded-lg p-1 hover:bg-mint" aria-label="上个月"><ChevronLeft className="h-4 w-4" /></button>
          <span className="min-w-20 text-center text-xs font-medium">{month.slice(0, 4)}年{Number(month.slice(5, 7))}月</span>
          <button onClick={onNextMonth} className="rounded-lg p-1 hover:bg-mint" aria-label="下个月"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
      <MonthGrid days={cal.days} />
      <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-primary" />完成</span>
        <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-rose-400" />漏卡</span>
        <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-stone-200" />休息或无排期</span>
      </div>
    </div>
  );
}

/** 打卡月历网格：周一起始，与 getWeekStartKey 口径一致 */
function MonthGrid({ days }: { days: { date: string; status: HabitDayStatus }[] }) {
  if (days.length === 0) return null;
  const today = todayKey();
  const leadingBlanks = (getDay(parseISO(days[0].date)) + 6) % 7; // 周一=0
  const cell = (status: HabitDayStatus) =>
    status === "done" ? "bg-primary font-semibold text-white"
      : status === "missed" ? "bg-rose-100 font-semibold text-rose-500"
        : "text-stone-400";
  return (
    <div className="mt-3">
      <div className="grid grid-cols-7 text-center text-[11px] text-muted">{WEEK_LABELS.map((w) => <span key={w}>{w}</span>)}</div>
      <div className="mt-1 grid grid-cols-7 gap-y-1">
        {Array.from({ length: leadingBlanks }, (_, i) => <span key={`b${i}`} />)}
        {days.map((d) => (
          <span key={d.date} className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs ${cell(d.status)} ${d.date === today ? "ring-2 ring-primary/40" : ""}`}>
            {Number(d.date.slice(8))}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 管理打卡项目：勾选/取消即时调 setHabitEnabled */
function ManageDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [candidates, setCandidates] = useState<HabitCandidate[] | null>(null);
  const [hidden, setHidden] = useState<{ taskId: string; title: string }[]>([]);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const load = useCallback(() => {
    getHabitCandidates().then(setCandidates).catch(() => setCandidates([]));
    getHiddenHabitCandidates().then(setHidden).catch(() => setHidden([]));
  }, []);
  useEffect(load, [load]);

  const toggle = async (c: HabitCandidate) => {
    setBusy(c.taskId);
    try {
      await setHabitEnabled(c.taskId, !c.enabled);
      load();
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const changeStart = async (taskId: string, date: string) => {
    setEditingId(null);
    if (!date) return;
    setBusy(taskId);
    try {
      await setHabitStartDate(taskId, date);
      load();
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const hide = async (taskId: string) => {
    setBusy(taskId);
    try {
      await hideHabitCandidate(taskId);
      load();
    } finally {
      setBusy(null);
    }
  };

  const unhide = async (taskId: string) => {
    setBusy(taskId);
    try {
      await unhideHabitCandidate(taskId);
      load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog onClose={onClose} title="管理打卡项目">
      {candidates === null ? (
        <p className="mt-3 text-sm text-muted">加载中…</p>
      ) : candidates.length === 0 ? (
        <p className="mt-3 text-sm text-muted">还没有可作为打卡的重复任务，先在任务里创建每天/每周重复的任务吧。</p>
      ) : (
        <div className="mt-3 max-h-72 space-y-1 overflow-y-auto">
          {candidates.map((c) => (
            <div key={c.taskId} className="rounded-lg px-2 py-2 hover:bg-mint/40">
              <div className="flex items-center gap-2">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" checked={c.enabled} disabled={busy === c.taskId} onChange={() => toggle(c)} className="h-4 w-4 shrink-0 rounded" />
                  <span className="min-w-0 flex-1 truncate text-ink">{c.title}</span>
                </label>
                {!c.enabled && (
                  <button onClick={() => hide(c.taskId)} disabled={busy === c.taskId} aria-label={`不再显示"${c.title}"`} title="不再显示这个任务" className="shrink-0 rounded-lg p-1 text-stone-400 hover:bg-stone-100 hover:text-rose-500 disabled:opacity-50">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              {c.enabled && c.streakStartDate && (
                editingId === c.taskId ? (
                  <input
                    type="date"
                    autoFocus
                    defaultValue={c.streakStartDate}
                    max={todayKey()}
                    onBlur={(e) => changeStart(c.taskId, e.target.value)}
                    onChange={(e) => changeStart(c.taskId, e.target.value)}
                    className="ml-6 mt-1 rounded-lg border px-2 py-1 text-xs text-stone-700"
                  />
                ) : (
                  <button
                    onClick={() => setEditingId(c.taskId)}
                    disabled={busy === c.taskId}
                    className="ml-6 mt-0.5 text-xs text-muted hover:text-primary hover:underline"
                  >
                    打卡起点 {c.streakStartDate}
                  </button>
                )
              )}
            </div>
          ))}
        </div>
      )}
      {hidden.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <button onClick={() => setHiddenOpen(!hiddenOpen)} className="flex w-full items-center justify-between text-xs text-muted">
            已隐藏 {hidden.length} 项
            <ChevronDown className={`h-3.5 w-3.5 transition ${hiddenOpen ? "rotate-180" : ""}`} />
          </button>
          {hiddenOpen && (
            <div className="mt-1 space-y-0.5">
              {hidden.map((h) => (
                <div key={h.taskId} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-mint/40">
                  <span className="min-w-0 flex-1 truncate">{h.title}</span>
                  <button onClick={() => unhide(h.taskId)} disabled={busy === h.taskId} className="shrink-0 text-primary hover:underline disabled:opacity-50">取消隐藏</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <button onClick={onClose} className="mt-4 w-full rounded-xl border bg-white px-4 py-2 text-sm text-stone-500">完成</button>
    </Dialog>
  );
}

/** 休息日：点某天标记/取消，休息日在各项目月历里显示为灰 */
function RestDayDialog({ initialMonth, onClose, onChanged }: { initialMonth: string; onClose: () => void; onChanged: () => void }) {
  const [month, setMonth] = useState(initialMonth);
  const [rests, setRests] = useState<Set<string> | null>(null);
  const load = useCallback(() => { getRestDays().then((d) => setRests(new Set(d))).catch(() => setRests(new Set())); }, []);
  useEffect(load, [load]);

  const shiftMonth = (delta: number) => setMonth(toDateKey(addMonths(parseISO(`${month}-01`), delta)).slice(0, 7));
  const onToggle = async (date: string) => {
    const next = await toggleRestDay(date);
    setRests(new Set(next));
    onChanged();
  };

  const first = startOfMonth(parseISO(`${month}-01`));
  const last = endOfMonth(first);
  const days: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) days.push(toDateKey(d));
  const leadingBlanks = (getDay(first) + 6) % 7;
  const today = todayKey();

  return (
    <Dialog onClose={onClose} title="休息日">
      <p className="mt-1 text-xs text-muted">点一天设为休息日（再点取消）。休息日在各项目月历里显示为灰色、连续不中断。</p>
      <div className="mt-3 flex items-center justify-between text-sm text-stone-600">
        <button onClick={() => shiftMonth(-1)} className="rounded-lg p-1 hover:bg-mint" aria-label="上个月"><ChevronLeft className="h-4 w-4" /></button>
        <span className="font-medium">{month.slice(0, 4)}年{Number(month.slice(5, 7))}月</span>
        <button onClick={() => shiftMonth(1)} className="rounded-lg p-1 hover:bg-mint" aria-label="下个月"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="mt-3 grid grid-cols-7 text-center text-[11px] text-muted">{WEEK_LABELS.map((w) => <span key={w}>{w}</span>)}</div>
      <div className="mt-1 grid grid-cols-7 gap-y-1">
        {Array.from({ length: leadingBlanks }, (_, i) => <span key={`b${i}`} />)}
        {days.map((date) => {
          const isRest = rests?.has(date);
          return (
            <button key={date} onClick={() => onToggle(date)} className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs ${isRest ? "bg-stone-300 font-semibold text-stone-600" : "text-stone-600 hover:bg-mint"} ${date === today ? "ring-2 ring-primary/40" : ""}`}>
              {Number(date.slice(8))}
            </button>
          );
        })}
      </div>
      <button onClick={onClose} className="mt-4 w-full rounded-xl border bg-white px-4 py-2 text-sm text-stone-500">完成</button>
    </Dialog>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/30 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold">{title}</h3>
        {children}
      </div>
    </div>
  );
}
