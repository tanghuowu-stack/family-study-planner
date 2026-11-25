import { Check, Pencil, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { formatFullDate, fromDateKey, todayKey } from "../utils/date";
import { getCalendarAnnotation } from "../data/calendarAnnotations";
import {
  cloneSchoolTimetable,
  loadSchoolTimetable,
  saveSchoolTimetable,
  TIMETABLE_DAYS,
  type SchoolTimetable,
  type TimetableDay,
  type TimetableSection,
} from "../data/appSettingsRepository";

const DAY_LABELS: Record<TimetableDay, string> = {
  monday: "周一",
  tuesday: "周二",
  wednesday: "周三",
  thursday: "周四",
  friday: "周五",
};

const SECTION_META: Record<TimetableSection, { label: string; className: string; bar: string }> = {
  morning: { label: "上午", className: "text-amber-700", bar: "#E0A040" },
  afternoon: { label: "下午", className: "text-sky-700", bar: "#5B9BD5" },
  extended: { label: "延时", className: "text-primary", bar: "#2B7656" },
};

/** 休息行的版式（名称和时间存在课表设置 breaks 里，编辑课表时可改） */
const BREAK_LAYOUT: Record<string, { long?: boolean; splitByDay?: boolean }> = {
  "am-4": { long: true },
  "extended-1": { splitByDay: true },
};

/**
 * 课程小色块（2026-11-25 课表重新设计）：语文 / 数学 / 英语用学科色（同今日页色点），体育劳动社团类主色，
 * 其余浅灰；底色是该色 10% 透明，字是深一档的同色。
 */
function courseTone(course: string): { color: string; background: string } {
  if (!course.trim() || course.trim() === "-") return { color: "#A8A29E", background: "transparent" };
  if (course.includes("语文")) return { color: "#B64E39", background: "#D96A5217" };
  if (course.includes("数学")) return { color: "#4056B5", background: "#5868C817" };
  if (course.includes("英语")) return { color: "#7546AE", background: "#9364C717" };
  if (/足球|体健|体育|劳动|俱乐部|社团|云脑班/.test(course)) return { color: "#28705C", background: "#2B765614" };
  return { color: "#202925", background: "#F1EFEB" };
}

function CourseName({ course }: { course: string }) {
  const match = course.match(/^(.*?)(（(?:葫芦丝|课本)）)$/);
  if (!match) return <>{course || "-"}</>;
  return <>{match[1]}<span className="timetable-course-note ml-0.5 inline-block text-[10px] font-semibold opacity-75">{match[2]}</span></>;
}

const displayTime = (value: string) => value.replace("-", "–");
const termLabel = (value: string) => /^[（(].+[）)]$/.test(value.trim()) ? value.trim() : `（${value.trim()}）`;

export function TimetablePage({ tabs }: { tabs?: ReactNode } = {}) {
  const [today, setToday] = useState(todayKey);
  const [saved, setSaved] = useState<SchoolTimetable | null>(null);
  const [draft, setDraft] = useState<SchoolTimetable | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedHint, setSavedHint] = useState(false);

  useEffect(() => {
    const updateDate = () => setToday(todayKey());
    const timer = window.setInterval(updateDate, 60_000);
    document.addEventListener("visibilitychange", updateDate);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", updateDate); };
  }, []);

  useEffect(() => {
    let active = true;
    void loadSchoolTimetable().then((value) => {
      if (!active) return;
      setSaved(value);
      setDraft(cloneSchoolTimetable(value));
    });
    return () => { active = false; };
  }, []);

  const tomorrow = useMemo(() => {
    const date = fromDateKey(today);
    date.setDate(date.getDate() + 1);
    const index = date.getDay();
    return index >= 1 && index <= 5 ? TIMETABLE_DAYS[index - 1] : null;
  }, [today]);

  const beginEdit = () => {
    if (!saved) return;
    setDraft(cloneSchoolTimetable(saved));
    setEditing(true);
    setSavedHint(false);
  };

  const cancelEdit = () => {
    if (saved) setDraft(cloneSchoolTimetable(saved));
    setEditing(false);
  };

  const updateCourse = (slotIds: string[], day: TimetableDay, value: string) => {
    setDraft((current) => current ? {
      ...current,
      slots: current.slots.map((slot) => slotIds.includes(slot.id)
        ? { ...slot, courses: { ...slot.courses, [day]: value } }
        : slot),
    } : current);
  };

  const updateHighlight = (slotIds: string[], day: TimetableDay, value: boolean) => {
    setDraft((current) => current ? {
      ...current,
      slots: current.slots.map((slot) => slotIds.includes(slot.id)
        ? { ...slot, highlights: { ...slot.highlights, [day]: value } }
        : slot),
    } : current);
  };

  const updateBreak = (slotId: string, field: "label" | "time", value: string) => {
    setDraft((current) => current ? {
      ...current,
      breaks: { ...current.breaks, [slotId]: { ...current.breaks[slotId], [field]: value } },
    } : current);
  };

  const updateTime = (slotId: string, value: string) => {
    setDraft((current) => current ? {
      ...current,
      slots: current.slots.map((slot) => slot.id === slotId ? { ...slot, time: value } : slot),
    } : current);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    await saveSchoolTimetable(draft);
    const next = cloneSchoolTimetable(draft);
    setSaved(next);
    setDraft(cloneSchoolTimetable(next));
    setEditing(false);
    setSaving(false);
    setSavedHint(true);
    window.setTimeout(() => setSavedHint(false), 2200);
  };

  if (!draft) {
    return <main className="mx-auto w-full max-w-6xl px-3 pb-content pt-4 sm:px-7 sm:pt-6 lg:px-10">{tabs}<div className="surface p-6 text-sm text-muted">正在读取课表...</div></main>;
  }

  const firstExtended = draft.slots.find((slot) => slot.id === "extended-1");
  const holidayStatus = getCalendarAnnotation(today).holidayStatus;
  const secondExtended = draft.slots.find((slot) => slot.id === "extended-2");
  const mergedDays = new Set(TIMETABLE_DAYS.filter((day) => firstExtended?.courses[day] && firstExtended.courses[day] === secondExtended?.courses[day]));
  const mergeMondayTuesdayBreak = !mergedDays.has("monday") && !mergedDays.has("tuesday");

  return (
    <main className={`school-timetable-page ${editing ? "is-editing" : ""} mx-auto w-full max-w-6xl px-3 pb-content pt-4 sm:px-7 sm:pt-6 lg:px-10`}>
      {tabs}
      <header className="page-header timetable-header">
        <div className="min-w-0"><div className="flex min-w-0 items-baseline gap-x-3"><h1 className="page-title shrink-0">课表</h1><p className="hidden min-w-0 truncate text-xs font-semibold text-ink sm:block sm:text-sm">{formatFullDate(today)}{holidayStatus && <span className={`ml-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${holidayStatus === "休" ? "bg-rose-50 text-rose-700" : "bg-blue-50 text-blue-700"}`}>{holidayStatus}</span>}{!editing && saved?.term && <span className="ml-1">{termLabel(saved.term)}</span>}</p></div>{editing ? <input aria-label="学期名称" value={draft.term} onChange={(event) => setDraft({ ...draft, term: event.target.value })} className="mt-1 w-full max-w-sm rounded-md border px-2 py-1 text-xs text-muted" /> : <p className="mt-1 truncate text-xs font-semibold text-ink sm:hidden">{formatFullDate(today)}{holidayStatus && <span className={`ml-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${holidayStatus === "休" ? "bg-rose-50 text-rose-700" : "bg-blue-50 text-blue-700"}`}>{holidayStatus}</span>}{saved?.term && <span className="ml-1">{termLabel(saved.term)}</span>}</p>}</div>
        <div className="flex items-center gap-2">
          {savedHint && <span className="text-xs font-medium text-primary">已保存</span>}
          {editing ? <><button type="button" onClick={cancelEdit} className="flex h-9 items-center gap-1.5 rounded-lg border border-ink/10 bg-white px-3 text-xs font-semibold text-muted hover:text-ink"><X className="h-4 w-4" />取消</button><button type="button" disabled={saving} onClick={() => void save()} className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-white hover:bg-[#1c493b] disabled:opacity-50"><Check className="h-4 w-4" />{saving ? "保存中" : "保存"}</button></> : <button type="button" aria-label="编辑课表" title="编辑课表" onClick={beginEdit} className="timetable-edit-button flex h-9 items-center gap-1.5 rounded-lg bg-ink px-3 text-xs font-semibold text-white hover:bg-primary"><Pencil className="h-4 w-4" /><span>编辑课表</span></button>}
        </div>
      </header>

      <section className="timetable-surface overflow-hidden rounded-xl border border-ink/[0.08] bg-white shadow-[0_1px_2px_rgba(32,41,37,0.04),0_12px_32px_-20px_rgba(32,41,37,0.25)]"><div className="timetable-scroll overflow-x-auto"><table className="w-full min-w-[760px] table-fixed border-separate border-spacing-0">
        <colgroup><col className="w-[132px]" />{TIMETABLE_DAYS.map((day) => <col key={day} />)}</colgroup>
        <thead><tr className="bg-[#F7F6F3]"><th className="sticky left-0 z-30 border-b border-r border-ink/[0.08] bg-[#F7F6F3] px-3 py-3 text-left text-[12px] font-semibold text-muted">节次 · 时间</th>{TIMETABLE_DAYS.map((day) => <th key={day} className={`border-b border-ink/[0.08] px-2 py-3 text-center text-[14px] font-bold ${tomorrow === day ? "bg-primary/[0.08] text-primary" : "text-ink"}`}>{DAY_LABELS[day]}{tomorrow === day && <span className="ml-1.5 inline-block rounded-full bg-primary px-1.5 py-px align-middle text-[10px] font-semibold text-white">明天</span>}</th>)}</tr></thead>
        <tbody>{draft.slots.map((slot, index) => {
          const firstOfSection = index === 0 || draft.slots[index - 1].section !== slot.section;
          const section = SECTION_META[slot.section];
          const breakItem = draft.breaks[slot.id];
          const breakMeta = breakItem && { ...breakItem, ...BREAK_LAYOUT[slot.id] };
          // 编辑时休息行整行一个编辑框：名称 + 时间
          const breakEditor = breakItem && <span className="inline-flex flex-wrap items-center justify-center gap-1.5"><input aria-label={`${section.label}${slot.label}之后的休息名称`} value={breakItem.label} onChange={(event) => updateBreak(slot.id, "label", event.target.value)} className="w-40 rounded border bg-white px-1.5 py-0.5 text-center text-[12px] font-bold text-ink" /><input aria-label={`${section.label}${slot.label}之后的休息时间`} value={breakItem.time} onChange={(event) => updateBreak(slot.id, "time", event.target.value)} className="w-[96px] rounded border bg-white px-1 py-0.5 text-center font-mono text-[11px] text-muted" /></span>;
          return [
            <tr key={slot.id} className={firstOfSection && index > 0 ? "[&>*]:border-t [&>*]:border-t-ink/15" : ""}>
              <th className="timetable-slot sticky left-0 z-20 border-b border-r border-ink/[0.08] bg-[#FBFAF8] px-3 py-2.5 text-left font-normal" style={{ boxShadow: `inset 3px 0 0 ${section.bar}` }}><div className="flex items-center gap-2"><span className={`timetable-section-label w-7 shrink-0 text-[10px] font-bold ${section.className}`}>{firstOfSection ? section.label : ""}</span><div className="min-w-0"><div className="timetable-slot-label text-xs font-bold text-ink"><span className={`timetable-section-inline hidden ${section.className}`}>{firstOfSection ? `${section.label} ` : ""}</span>{slot.label}</div>{editing ? <input aria-label={`${section.label}${slot.label}时间`} value={slot.time} onChange={(event) => updateTime(slot.id, event.target.value)} className="mt-1 w-[82px] rounded border px-1 py-0.5 font-mono text-[9px] text-muted" /> : <div className="timetable-slot-time mt-0.5 whitespace-nowrap font-mono text-[10px] font-medium text-muted">{displayTime(slot.time)}</div>}</div></div></th>
              {TIMETABLE_DAYS.map((day) => {
                if (slot.id === "extended-2" && mergedDays.has(day)) return null;
                const merged = slot.id === "extended-1" && mergedDays.has(day);
                const slotIds = merged ? ["extended-1", "extended-2"] : [slot.id];
                return <td key={day} rowSpan={merged ? 3 : 1} className={`timetable-course relative border-b border-r border-ink/[0.08] px-1.5 py-1.5 text-center align-middle last:border-r-0 ${tomorrow === day ? "bg-primary/[0.04]" : "bg-white"}`}>{editing ? <div className="flex flex-col items-center gap-1"><input aria-label={`${DAY_LABELS[day]}${section.label}${slot.label}`} value={slot.courses[day]} onChange={(event) => updateCourse(slotIds, day, event.target.value)} className="w-full rounded-md border px-1.5 py-2 text-center text-base font-bold text-ink" /><label className="flex cursor-pointer items-center gap-1 text-[11px] font-semibold text-muted"><input type="checkbox" aria-label={`${DAY_LABELS[day]}${section.label}${slot.label}高亮显示`} checked={slot.highlights[day]} onChange={(event) => updateHighlight(slotIds, day, event.target.checked)} className="accent-primary" />高亮显示</label></div> : <><span className="flex min-h-[2.75rem] w-full items-center justify-center rounded-lg px-1 py-1.5 text-[16px] font-bold leading-tight" style={courseTone(slot.courses[day])}><CourseName course={slot.courses[day]} /></span>{slot.highlights[day] && <span role="img" aria-label="要带课本或工具" title="要带课本或工具" className="timetable-carry absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-white" />}</>}</td>;
              })}
            </tr>,
            breakMeta && editing ? <tr key={`${slot.id}-break`} className={`timetable-break ${breakMeta.long ? "bg-amber-50/75" : "bg-[#F5F4F1]"}`}><th aria-hidden="true" className={`sticky left-0 z-20 border-b border-r border-ink/[0.08] px-3 py-1 ${breakMeta.long ? "bg-amber-50" : "bg-[#F5F4F1]"}`} /><td colSpan={5} className="border-b border-ink/[0.08] px-2 py-1.5 text-center">{breakEditor}</td></tr> : breakMeta && (breakMeta.splitByDay ? <tr key={`${slot.id}-break`} className="timetable-break timetable-break-split bg-[#F5F4F1]"><th aria-hidden="true" className="sticky left-0 z-20 border-b border-r border-ink/[0.08] bg-[#F5F4F1] px-3 py-1" />{TIMETABLE_DAYS.map((day) => {
              if (mergedDays.has(day) || (day === "tuesday" && mergeMondayTuesdayBreak)) return null;
              const colSpan = day === "monday" && mergeMondayTuesdayBreak ? 2 : 1;
              return <td key={day} colSpan={colSpan} className="border-b border-r border-ink/[0.08] px-1.5 py-1.5 text-center text-[10px] font-semibold text-muted last:border-r-0">{breakMeta.label}<span className="ml-1 whitespace-nowrap font-mono text-[9px] font-normal text-muted/80">({displayTime(breakMeta.time)})</span></td>;
            })}</tr> : <tr key={`${slot.id}-break`} className={`timetable-break ${breakMeta.long ? "bg-[#FDF6E9]" : "bg-[#F7F6F3]"}`}><th aria-hidden="true" className={`sticky left-0 z-20 border-b border-r border-ink/[0.08] px-3 py-1 ${breakMeta.long ? "bg-[#FDF6E9]" : "bg-[#F7F6F3]"}`} /><td colSpan={5} className="border-b border-ink/[0.08] px-2 py-1.5 text-center"><span className={`text-[12px] font-semibold tracking-wide ${breakMeta.long ? "text-amber-800" : "text-muted"}`}>{breakMeta.label}</span><span className="ml-1.5 whitespace-nowrap font-mono text-[10px] text-muted/80">({displayTime(breakMeta.time)})</span></td></tr>),
          ];
        })}</tbody>
      </table></div></section>
      <p className="mt-2.5 flex items-center justify-center gap-1.5 text-[12px] font-medium text-muted"><span aria-hidden className="h-2 w-2 rounded-full bg-amber-500" />要带课本或工具</p>
    </main>
  );
}
