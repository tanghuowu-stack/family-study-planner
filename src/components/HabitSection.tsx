/**
 * HabitSection（打卡页）
 * 打卡 = 若干「打卡项目」各自独立计连续。数据来自 statsRepository，UI 不做聚合计算。
 * 2026-11 第 6 批：由"每个项目一张整宽月历卡"改为一张矩阵——行是项目、列是本月每一天，
 * 月份切换和图例只出现一次，项目之间可以横向对比。窄屏横向滚动，项目名一列固定在左侧。
 * 颜色：完成 primary、漏卡 rose、休息或无排期 stone（与 TASK_08 §4 三态一致）。
 */
import { ChevronDown, ChevronLeft, ChevronRight, ListChecks, CalendarOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { addDays, addMonths, endOfMonth, getDay, parseISO, startOfMonth } from "date-fns";
import {
  disableHabitProject,
  getHabitCalendars,
  getHabitCandidates,
  getHabitProjects,
  linkHabit,
  setHabitProjectStartDate,
  suggestHabitLinks,
  unlinkHabit,
  getHiddenHabitCandidates,
  getRestDays,
  hideHabitCandidate,
  setHabitEnabled,

  toggleRestDay,
  unhideHabitCandidate,
  type HabitCalendar,
  type HabitCandidate,
  type HabitLinkSuggestion,
  type HabitProject,
  type HabitDayStatus,
} from "../data/statsRepository";
import { todayKey, toDateKey } from "../utils/date";

const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
const WEEKDAY_SHORT = ["日", "一", "二", "三", "四", "五", "六"];
const STATUS_TEXT: Record<HabitDayStatus, string> = { done: "完成", missed: "漏卡", off: "休息或无排期" };

export function HabitSection() {
  const [month, setMonth] = useState(() => todayKey().slice(0, 7));
  const [calendars, setCalendars] = useState<HabitCalendar[] | null>(null);
  const [restDays, setRestDays] = useState<Set<string>>(new Set());
  const [manageOpen, setManageOpen] = useState(false);
  const [restOpen, setRestOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    getHabitCalendars(month).then(setCalendars).catch(() => setCalendars([]));
    getRestDays().then((days) => setRestDays(new Set(days))).catch(() => setRestDays(new Set()));
  }, [month, refreshKey]);

  const shiftMonth = (delta: number) => setMonth(toDateKey(addMonths(parseISO(`${month}-01`), delta)).slice(0, 7));
  const isThisMonth = month === todayKey().slice(0, 7);

  return (
    <section className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button onClick={() => shiftMonth(-1)} className="flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-white hover:text-ink" aria-label="上个月"><ChevronLeft className="h-5 w-5" /></button>
          <h2 className="min-w-24 text-center text-base font-bold text-ink">{month.slice(0, 4)}年{Number(month.slice(5, 7))}月</h2>
          <button onClick={() => shiftMonth(1)} className="flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-white hover:text-ink" aria-label="下个月"><ChevronRight className="h-5 w-5" /></button>
          {!isThisMonth && <button onClick={() => setMonth(todayKey().slice(0, 7))} className="h-10 rounded-lg px-2 text-[13px] font-semibold text-primary hover:bg-primary/10">回到本月</button>}
        </div>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setManageOpen(true)} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-ink/10 bg-white px-3 text-sm font-medium text-ink hover:bg-mint/40">
            <ListChecks className="h-4 w-4" />管理打卡项目
          </button>
          <button onClick={() => setRestOpen(true)} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-ink/10 bg-white px-3 text-sm font-medium text-ink hover:bg-mint/40">
            <CalendarOff className="h-4 w-4" />休息日
          </button>
        </div>
      </div>

      {calendars === null ? (
        <p className="mt-4 px-1 text-sm text-muted">加载中…</p>
      ) : calendars.length === 0 ? (
        <div className="surface mt-3 p-6 text-center">
          <p className="text-sm text-muted">还没有打卡项目，选几个每天坚持做的重复任务吧</p>
          <button onClick={() => setManageOpen(true)} className="mt-3 min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white">管理打卡项目</button>
        </div>
      ) : (
        <>
          {/* 停掉的项目（这个月一天都没排）不占一行；管理弹窗里照样能看到 */}
          {calendars.some((cal) => cal.hasScheduleInMonth)
            ? <HabitMatrix calendars={calendars.filter((cal) => cal.hasScheduleInMonth)} restDays={restDays} />
            : <div className="surface mt-3 p-5 text-center text-sm text-muted">这个月没有安排打卡项目</div>}
          {calendars.some((cal) => !cal.hasScheduleInMonth) && (
            <p className="mt-2 px-1 text-[13px] text-muted">这个月停着的项目不显示：{calendars.filter((cal) => !cal.hasScheduleInMonth).map((cal) => cal.title).join("、")}</p>
          )}
        </>
      )}

      {manageOpen && <ManageDialog onClose={() => setManageOpen(false)} onChanged={reload} />}
      {restOpen && <RestDayDialog initialMonth={month} onClose={() => setRestOpen(false)} onChanged={reload} />}
    </section>
  );
}

/** 打卡矩阵：行 = 打卡项目，列 = 本月每一天，行尾是本月完成天数 */
function HabitMatrix({ calendars, restDays }: { calendars: HabitCalendar[]; restDays: Set<string> }) {
  const today = todayKey();
  const scroller = useRef<HTMLDivElement>(null);
  const days = calendars[0]?.days.map((day) => day.date) ?? [];
  // 窄屏打开时把今天滚到可见区域中间
  useEffect(() => {
    const box = scroller.current;
    const cell = box?.querySelector<HTMLElement>("[data-today='true']");
    if (!box || !cell || box.scrollWidth <= box.clientWidth) return;
    box.scrollLeft = Math.max(0, cell.offsetLeft - box.clientWidth / 2);
  }, [days.join(",")]);

  const dot = (status: HabitDayStatus, future: boolean) =>
    future ? "bg-transparent"
      : status === "done" ? "bg-primary"
        : status === "missed" ? "bg-rose-300"
          : "bg-stone-200";

  return (
    <div className="surface mt-3 overflow-hidden">
      <div ref={scroller} className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-center">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 min-w-[6.5rem] border-b border-ink/10 bg-white px-3 shadow-[1px_0_0_rgba(32,41,37,0.08)] py-2 text-left text-[13px] font-semibold text-muted sm:px-4">项目</th>
              {days.map((date) => {
                const weekday = getDay(parseISO(date));
                const isToday = date === today;
                const isRest = restDays.has(date);
                return (
                  <th key={date} scope="col" data-today={isToday || undefined} title={isRest ? "休息日" : undefined}
                    className={`min-w-[1.375rem] border-b border-ink/10 px-0 xl:min-w-[1.5rem] py-1.5 align-bottom text-[13px] font-medium ${isToday ? "bg-mint/60 text-primary" : isRest ? "bg-stone-100 text-muted" : weekday === 0 || weekday === 6 ? "text-muted" : "text-ink"}`}>
                    <span className="block leading-4 tabular-nums">{Number(date.slice(8))}</span>
                    <span className={`block text-[13px] leading-4 ${isToday ? "font-bold" : "text-muted"}`}>{isRest ? "休" : WEEKDAY_SHORT[weekday]}</span>
                  </th>
                );
              })}
              <th scope="col" className="min-w-[3.5rem] border-b border-ink/10 bg-white py-2 pl-1 pr-3 text-right text-[13px] font-semibold text-muted sm:px-4">本月</th>
            </tr>
          </thead>
          <tbody>
            {calendars.map((cal) => (
              <tr key={cal.taskId}>
                <th scope="row" className="sticky left-0 z-10 border-b border-ink/[0.07] bg-white px-3 shadow-[1px_0_0_rgba(32,41,37,0.08)] py-2.5 text-left sm:px-4">
                  <span className="block max-w-[8rem] truncate text-[15px] font-semibold text-ink xl:max-w-[12rem]" title={cal.title}>{cal.title}</span>
                  <span className="block text-[13px] font-medium text-muted">{cal.currentStreak > 0 ? <>🔥 连续 {cal.currentStreak} 天</> : "还没开始连续"}</span>
                </th>
                {cal.days.map((day) => {
                  const future = day.date > today;
                  return (
                    <td key={day.date} className={`border-b border-ink/[0.07] px-0 py-2.5 ${day.date === today ? "bg-mint/40" : restDays.has(day.date) ? "bg-stone-50" : ""}`}>
                      <span role="img" aria-label={`${Number(day.date.slice(5, 7))}月${Number(day.date.slice(8))}日 ${future ? "未到" : STATUS_TEXT[day.status]}`} title={future ? undefined : STATUS_TEXT[day.status]}
                        className={`mx-auto block h-4 w-4 rounded-full ${dot(day.status, future)}`} />
                    </td>
                  );
                })}
                <td className="border-b border-ink/[0.07] py-2.5 pl-1 pr-3 text-right text-[15px] font-semibold tabular-nums text-ink sm:px-4">{cal.monthCompletedDays}<span className="text-[13px] font-medium text-muted"> 天</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2.5 text-[13px] text-muted sm:px-4">
        <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded-full bg-primary" />完成</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded-full bg-rose-300" />漏卡</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded-full bg-stone-200" />休息或无排期</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded-sm bg-mint" />今天</span>
      </div>
    </div>
  );
}

/**
 * 管理打卡项目（2026-11-14 重排）：
 * - 正在打卡：一个项目一行（接上的几段任务合在一起），可改起点、取消、把接错的任务移出；
 * - 可以加入打卡：勾选时先问"要接上以前的打卡吗？"，按像不像列出以前的项目，预选最像的；
 * - 已结束的任务、上课类、已隐藏的折叠起来，列表不再被一堆同名旧任务挤满。
 */
function ManageDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [projects, setProjects] = useState<HabitProject[] | null>(null);
  const [candidates, setCandidates] = useState<HabitCandidate[] | null>(null);
  const [hidden, setHidden] = useState<{ taskId: string; title: string }[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [linking, setLinking] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    getHabitProjects().then(setProjects).catch(() => setProjects([]));
    getHabitCandidates().then(setCandidates).catch(() => setCandidates([]));
    getHiddenHabitCandidates().then(setHidden).catch(() => setHidden([]));
  }, []);
  useEffect(load, [load]);

  const run = async (key: string, action: () => Promise<void>, refreshCalendars = true) => {
    setBusy(key);
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
  const toggleOpen = (key: string) => setOpen((current) => ({ ...current, [key]: !current[key] }));

  const enabledKeys = new Set(projects?.map((p) => p.key) ?? []);
  const free = candidates?.filter((c) => !c.enabled && !enabledKeys.has(c.projectKey)) ?? [];
  const available = free.filter((c) => !c.ended && !c.isCourse);
  const courses = free.filter((c) => !c.ended && c.isCourse);
  const ended = free.filter((c) => c.ended);

  const renderCandidate = (c: HabitCandidate) => (
    <div key={c.taskId} className="border-b border-ink/[0.07] py-1 last:border-0">
      <div className="flex items-center gap-2">
        <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5">
          <input type="checkbox" checked={linking === c.taskId} disabled={busy === c.taskId} onChange={() => setLinking(linking === c.taskId ? null : c.taskId)} className="h-5 w-5 shrink-0 rounded accent-primary" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] text-ink">{c.title}</span>
            <span className="block truncate text-[13px] text-muted">{c.categoryText} · {c.scheduleText} · {c.rangeText}</span>
          </span>
        </label>
        {linking !== c.taskId && (
          <button onClick={() => void run(c.taskId, () => hideHabitCandidate(c.taskId), false)} disabled={busy === c.taskId} title="从这个列表里隐藏，任务本身不受影响" className="min-h-11 shrink-0 rounded-lg px-2 text-[13px] text-muted hover:text-ink disabled:opacity-50">不再提示</button>
        )}
      </div>
      {linking === c.taskId && (
        <LinkChooser taskId={c.taskId} busy={busy === c.taskId} onCancel={() => setLinking(null)}
          onConfirm={(projectKey) => run(c.taskId, async () => { await (projectKey ? linkHabit(c.taskId, projectKey) : setHabitEnabled(c.taskId, true)); setLinking(null); })} />
      )}
    </div>
  );

  const folded = (key: string, label: string, list: HabitCandidate[]) => list.length > 0 && (
    <div className="border-t border-ink/10">
      <button onClick={() => toggleOpen(key)} aria-expanded={!!open[key]} className="flex min-h-11 w-full items-center justify-between text-left text-[13px] text-muted">
        <span>{label} {list.length} 项</span>
        <ChevronDown className={`h-3.5 w-3.5 transition ${open[key] ? "rotate-180" : ""}`} />
      </button>
      {open[key] && <div>{list.map(renderCandidate)}</div>}
    </div>
  );

  return (
    <Dialog onClose={onClose} title="管理打卡项目">
      {projects === null || candidates === null ? (
        <p className="mt-3 text-sm text-muted">加载中…</p>
      ) : (
        <div className="mt-2 max-h-[65vh] overflow-y-auto pr-1">
          <h4 className="text-[13px] font-semibold text-ink">正在打卡 <span className="font-medium text-muted">{projects.length}</span></h4>
          {projects.length === 0 && <p className="py-2 text-[13px] text-muted">还没有打卡项目，从下面选几个每天坚持的事。</p>}
          {projects.map((project) => (
            <div key={project.key} className="border-b border-ink/[0.07] py-1 last:border-0">
              <label className="flex min-h-11 cursor-pointer items-center gap-2.5">
                <input type="checkbox" checked disabled={busy === project.key} onChange={() => void run(project.key, () => disableHabitProject(project.key))} className="h-5 w-5 shrink-0 rounded accent-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-ink">{project.title}</span>
                  <span className="block truncate text-[13px] text-muted">{project.categoryText} · {project.scheduleText}{project.paused ? ` · 已停${project.lastDate ? `（最后 ${Number(project.lastDate.slice(5, 7))}/${Number(project.lastDate.slice(8))}）` : ""}` : ""} · 累计 {project.doneDays} 天</span>
                </span>
              </label>
              {project.members.length > 1 && (
                <div className="mb-1 ml-[1.875rem] space-y-0.5">
                  {project.members.map((member) => (
                    <div key={member.taskId} className="flex min-h-9 items-center gap-2 text-[13px] text-muted">
                      <span className="min-w-0 flex-1 truncate">{member.title} · {member.rangeText}</span>
                      {member.linked && <button onClick={() => void run(member.taskId, () => unlinkHabit(member.taskId))} disabled={busy === member.taskId} className="min-h-9 shrink-0 rounded-lg px-2 text-primary hover:bg-primary/10 disabled:opacity-50">移出</button>}
                    </div>
                  ))}
                </div>
              )}
              {project.startDate && (
                <StartDateEditor key={project.startDate} title={project.title} saved={project.startDate} disabled={busy === project.key} onSave={(date) => run(project.key, () => setHabitProjectStartDate(project.key, date))} />
              )}
            </div>
          ))}

          <h4 className="mt-4 text-[13px] font-semibold text-ink">可以加入打卡 <span className="font-medium text-muted">{available.length}</span></h4>
          <p className="text-[13px] text-muted">勾选时可以接上以前停掉的打卡，合成一行、历史连在一起。</p>
          {available.map(renderCandidate)}
          {folded("course", "上课类（一般不用打卡）", courses)}
          {folded("ended", "已结束的任务", ended)}
          {hidden.length > 0 && (
            <div className="border-t border-ink/10">
              <button onClick={() => toggleOpen("hidden")} aria-expanded={!!open.hidden} className="flex min-h-11 w-full items-center justify-between text-[13px] text-muted">
                已隐藏 {hidden.length} 项
                <ChevronDown className={`h-3.5 w-3.5 transition ${open.hidden ? "rotate-180" : ""}`} />
              </button>
              {open.hidden && hidden.map((h) => (
                <div key={h.taskId} className="flex items-center gap-2 text-[13px] text-muted">
                  <span className="min-w-0 flex-1 truncate">{h.title}</span>
                  <button onClick={() => void run(h.taskId, () => unhideHabitCandidate(h.taskId), false)} disabled={busy === h.taskId} className="min-h-11 shrink-0 px-2 text-primary hover:underline disabled:opacity-50">恢复显示</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {error && <p role="alert" className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}
      <button onClick={onClose} className="mt-4 min-h-11 w-full rounded-lg border bg-white px-4 text-sm text-stone-500">完成</button>
    </Dialog>
  );
}

/**
 * 勾选一个任务加入打卡时："要接上以前的打卡吗？"
 * 以前打过卡的项目按像不像排在前面（同分类同学科、名字有相同的字），最像的预先选好；
 * 都不是就选"作为新项目"。名字常常不一样，所以不自动合并，由家长确认。
 */
function LinkChooser({ taskId, busy, onConfirm, onCancel }: { taskId: string; busy: boolean; onConfirm: (projectKey: string | null) => Promise<void>; onCancel: () => void }) {
  const [suggestions, setSuggestions] = useState<HabitLinkSuggestion[] | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    suggestHabitLinks(taskId).then((list) => {
      setSuggestions(list);
      setChoice(list[0] && list[0].score >= 3 ? list[0].project.key : null);
    }).catch(() => setSuggestions([]));
  }, [taskId]);
  if (suggestions === null) return <p className="ml-[1.875rem] py-2 text-[13px] text-muted">查找以前的打卡…</p>;
  const visible = showAll ? suggestions : suggestions.filter((item, index) => item.score > 0 && index < 3);
  const option = (key: string | null, title: string, detail?: string) => (
    <label key={key ?? "new"} className={`flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 ${choice === key ? "bg-mint/60" : "hover:bg-stone-50"}`}>
      <input type="radio" name={`link-${taskId}`} checked={choice === key} onChange={() => setChoice(key)} className="mt-0.5 h-4 w-4 shrink-0 accent-primary" />
      <span className="min-w-0 flex-1"><span className="block text-[15px] text-ink">{title}</span>{detail && <span className="block text-[13px] text-muted">{detail}</span>}</span>
    </label>
  );
  return (
    <div className="mb-2 ml-[1.875rem] rounded-lg border border-ink/10 bg-white p-2">
      <p className="px-2 pb-1 text-[13px] font-semibold text-ink">{suggestions.length ? "要接上以前的打卡吗？" : "加入打卡"}</p>
      {visible.map(({ project }) => option(project.key, `接上「${project.title}」`, `${project.categoryText} · ${project.scheduleText} · ${project.paused ? `上次到 ${project.lastDate ? `${Number(project.lastDate.slice(5, 7))}/${Number(project.lastDate.slice(8))}` : "—"}` : "正在打卡"} · 累计 ${project.doneDays} 天`))}
      {!showAll && suggestions.length > visible.length && <button type="button" onClick={() => setShowAll(true)} className="min-h-9 px-2 text-[13px] font-semibold text-primary">看全部 {suggestions.length} 个以前的项目</button>}
      {option(null, "作为新项目", "以前没打过这件事的卡")}
      <div className="mt-1 flex gap-2 px-2 pb-1">
        <button type="button" onClick={() => void onConfirm(choice)} disabled={busy} className="min-h-10 flex-1 rounded-lg bg-primary text-sm font-semibold text-white disabled:opacity-50">{choice ? "接上并加入打卡" : "加入打卡"}</button>
        <button type="button" onClick={onCancel} className="min-h-10 rounded-lg px-3 text-sm text-muted">取消</button>
      </div>
    </div>
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
      <div className="mt-3 grid grid-cols-7 text-center text-[13px] text-muted">{WEEK_LABELS.map((w) => <span key={w}>{w}</span>)}</div>
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
