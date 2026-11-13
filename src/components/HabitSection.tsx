/**
 * HabitSection（统计页·打卡区）
 * 打卡 = 若干项目各自一张月历。数据来自 statsRepository，UI 不做聚合计算。
 * 视觉遵守 docs/style.md：primary/mint 主题、卡片 rounded-2xl border-stone-100，
 * 完成绿（primary）、漏卡红（rose，见 style.md §功能色补充）、off 灰（stone）。
 */
import { ChevronDown, ChevronLeft, ChevronRight, ListChecks, CalendarOff } from "lucide-react";
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
    <section className="mt-6">
      {/* 顶部：标题 + 入口 */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div><p className="section-heading">Habit tracker</p><h2 className="mt-1 text-lg font-bold text-ink">打卡月历</h2></div>
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
    <div className="surface p-4 sm:p-5">
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
        <span className="ml-auto text-right font-semibold text-primary">本月打卡 {cal.monthCompletedDays} 天</span>
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

/** 管理打卡项目：勾选/取消即时调 setHabitEnabled；打卡起点改完点「确定」才保存 */
function ManageDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [candidates, setCandidates] = useState<HabitCandidate[] | null>(null);
  const [hidden, setHidden] = useState<{ taskId: string; title: string }[]>([]);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [coursesOpen, setCoursesOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    getHabitCandidates().then(setCandidates).catch(() => setCandidates([]));
    getHiddenHabitCandidates().then(setHidden).catch(() => setHidden([]));
  }, []);
  useEffect(load, [load]);

  const run = async (taskId: string, action: () => Promise<void>, refreshCalendars = true) => {
    setBusy(taskId);
    setError("");
    try {
      await action();
      load();
      if (refreshCalendars) onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败，请重试");
    } finally {
      setBusy(null);
    }
  };

  // 已勾选的始终留在主列表（否则找不到地方取消）；没勾选的上课类一般不用来打卡，折叠起来减少干扰
  const mainList = candidates?.filter((c) => c.enabled || !c.isCourse) ?? [];
  const courseList = candidates?.filter((c) => !c.enabled && c.isCourse) ?? [];

  const renderCandidate = (c: HabitCandidate) => (
    <div key={c.taskId} className="border-b border-ink/[0.07] py-1 last:border-0">
      <div className="flex items-center gap-2">
        <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-sm">
          <input type="checkbox" checked={c.enabled} disabled={busy === c.taskId} onChange={() => void run(c.taskId, () => setHabitEnabled(c.taskId, !c.enabled))} className="h-5 w-5 shrink-0 rounded accent-primary" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-ink">{c.title}</span>
            {c.calendarTitle && c.calendarTitle !== c.title && <span className="block text-xs text-muted">计入「{c.calendarTitle}」月历</span>}
          </span>
        </label>
        {!c.enabled && (
          <button onClick={() => void run(c.taskId, () => hideHabitCandidate(c.taskId), false)} disabled={busy === c.taskId} title="从这个列表里隐藏，任务本身不受影响" className="min-h-11 shrink-0 rounded-lg px-2 text-xs text-muted hover:text-ink disabled:opacity-50">
            不再提示
          </button>
        )}
      </div>
      {c.enabled && c.streakStartDate && (
        <StartDateEditor key={c.streakStartDate} title={c.title} saved={c.streakStartDate} disabled={busy === c.taskId} onSave={(date) => run(c.taskId, () => setHabitStartDate(c.taskId, date))} />
      )}
    </div>
  );

  return (
    <Dialog onClose={onClose} title="管理打卡项目">
      <p className="mt-1 text-xs text-muted">勾选后立刻生效，每个项目各有一张月历。</p>
      {candidates === null ? (
        <p className="mt-3 text-sm text-muted">加载中…</p>
      ) : candidates.length === 0 ? (
        <p className="mt-3 text-sm text-muted">还没有可作为打卡的重复任务，先在任务里创建每天/每周重复的任务吧。</p>
      ) : (
        <div className="mt-2 max-h-[60vh] overflow-y-auto">
          {mainList.map(renderCandidate)}
          {courseList.length > 0 && (
            <div className="border-t border-ink/10">
              <button onClick={() => setCoursesOpen(!coursesOpen)} aria-expanded={coursesOpen} className="flex min-h-11 w-full items-center justify-between text-left text-xs text-muted">
                <span>上课类 {courseList.length} 项（一般不用打卡）</span>
                <ChevronDown className={`h-3.5 w-3.5 transition ${coursesOpen ? "rotate-180" : ""}`} />
              </button>
              {coursesOpen && <div>{courseList.map(renderCandidate)}</div>}
            </div>
          )}
        </div>
      )}
      {error && <p role="alert" className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
      {hidden.length > 0 && (
        <div className="mt-2 border-t border-ink/10">
          <button onClick={() => setHiddenOpen(!hiddenOpen)} aria-expanded={hiddenOpen} className="flex min-h-11 w-full items-center justify-between text-xs text-muted">
            已隐藏 {hidden.length} 项
            <ChevronDown className={`h-3.5 w-3.5 transition ${hiddenOpen ? "rotate-180" : ""}`} />
          </button>
          {hiddenOpen && (
            <div className="space-y-0.5">
              {hidden.map((h) => (
                <div key={h.taskId} className="flex items-center gap-2 text-xs text-muted">
                  <span className="min-w-0 flex-1 truncate">{h.title}</span>
                  <button onClick={() => void run(h.taskId, () => unhideHabitCandidate(h.taskId), false)} disabled={busy === h.taskId} className="min-h-11 shrink-0 px-2 text-primary hover:underline disabled:opacity-50">恢复显示</button>
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

/**
 * 打卡起点：一个看得出能改的日期框。改动只进本地草稿，点「确定」才保存——
 * 日期框每拨一下月/日都会触发 change，边改边存会存进中间值。
 * 保存成功后父组件用新起点做 key 重建本组件，草稿随之归位。
 */
function StartDateEditor({ title, saved, disabled, onSave }: { title: string; saved: string; disabled: boolean; onSave: (date: string) => Promise<void> }) {
  const [draft, setDraft] = useState(saved);
  const changed = draft !== "" && draft !== saved;
  return (
    <div className="mb-2 ml-[1.875rem] flex flex-wrap items-center gap-2 text-xs text-muted">
      <label className="flex items-center gap-2">
        <span className="shrink-0">打卡起点</span>
        <input type="date" aria-label={`${title}的打卡起点`} value={draft} max={todayKey()} disabled={disabled} onChange={(event) => setDraft(event.target.value)} className="h-9 rounded-lg border px-2 text-sm text-ink" />
      </label>
      {changed && (
        <>
          <button onClick={() => void onSave(draft)} disabled={disabled} className="h-9 rounded-lg bg-primary px-3 text-xs font-semibold text-white disabled:opacity-50">确定</button>
          <button onClick={() => setDraft(saved)} disabled={disabled} className="h-9 rounded-lg px-2 text-xs text-muted hover:text-ink">取消</button>
        </>
      )}
    </div>
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
