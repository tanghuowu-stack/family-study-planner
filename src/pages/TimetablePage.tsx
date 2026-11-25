import { Check, Pencil, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { formatFullDate, fromDateKey, todayKey } from "../utils/date";
import { getCalendarAnnotation } from "../data/calendarAnnotations";
import { currentScheduleItem, SCHOOL_AFTER, SCHOOL_AFTERNOON, SCHOOL_DISMISS, SCHOOL_LUNCH, SCHOOL_MORNING, type ScheduleItem } from "../data/schoolSchedule";
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

function CourseName({ course, stacked = false }: { course: string; stacked?: boolean }) {
  const match = course.match(/^(.*?)(（(?:葫芦丝|课本)）)$/);
  if (!match) return <>{course || "-"}</>;
  // 课程表格子窄：括号里的“课本 / 葫芦丝”换到课名下面一行小字
  if (stacked) return <span className="flex flex-col items-center leading-tight"><span>{match[1]}</span><span className="text-[10px] font-semibold opacity-75">{match[2].slice(1, -1)}</span></span>;
  return <>{match[1]}<span className="timetable-course-note ml-0.5 inline-block text-[10px] font-semibold opacity-75">{match[2]}</span></>;
}

/**
 * 要带课本或工具的课（2026-11-25 用户：黄点不显眼，"一看课表就知道要带什么"）：
 * 整块换成浅黄底 + 2px 琥珀色粗框 + 深琥珀字，比学科色块醒目得多；编辑课表时用"高亮显示"复选框设置。
 */
const CARRY_STYLE = { color: "#8A4B00", background: "#FFF1CC", boxShadow: "inset 0 0 0 2px #E39A1C" } as const;

const displayTime = (value: string) => value.replace("-", "–");
const termLabel = (value: string) => /^[（(].+[）)]$/.test(value.trim()) ? value.trim() : `（${value.trim()}）`;

export function TimetablePage({ tabs }: { tabs?: ReactNode } = {}) {
  const [today, setToday] = useState(todayKey);
  const [saved, setSaved] = useState<SchoolTimetable | null>(null);
  const [draft, setDraft] = useState<SchoolTimetable | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedHint, setSavedHint] = useState(false);

  const [now, setNow] = useState(() => new Date());
  // 手机上"课程表 / 作息时间"切换（iPad、电脑两块并排）
  const [phoneView, setPhoneView] = useState<"grid" | "schedule">("grid");
  useEffect(() => {
    const updateDate = () => { setToday(todayKey()); setNow(new Date()); };
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

      {!editing ? <ReadView draft={draft} tomorrow={tomorrow} now={now} phoneView={phoneView} onPhoneView={setPhoneView} /> : <>
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
                return <td key={day} rowSpan={merged ? 3 : 1} className={`timetable-course relative border-b border-r border-ink/[0.08] px-1.5 py-1.5 text-center align-middle last:border-r-0 ${tomorrow === day ? "bg-primary/[0.04]" : "bg-white"}`}>{editing ? <div className="flex flex-col items-center gap-1"><input aria-label={`${DAY_LABELS[day]}${section.label}${slot.label}`} value={slot.courses[day]} onChange={(event) => updateCourse(slotIds, day, event.target.value)} className="w-full rounded-md border px-1.5 py-2 text-center text-base font-bold text-ink" /><label className="flex cursor-pointer items-center gap-1 text-[11px] font-semibold text-muted"><input type="checkbox" aria-label={`${DAY_LABELS[day]}${section.label}${slot.label}高亮显示`} checked={slot.highlights[day]} onChange={(event) => updateHighlight(slotIds, day, event.target.checked)} className="accent-primary" />高亮显示</label></div> : <span className={`flex min-h-[2.75rem] w-full items-center justify-center rounded-lg px-1 py-1.5 text-[16px] font-bold leading-tight ${slot.highlights[day] ? "timetable-carry" : ""}`} style={slot.highlights[day] ? CARRY_STYLE : courseTone(slot.courses[day])} title={slot.highlights[day] ? "要带课本或工具" : undefined}><CourseName course={slot.courses[day]} /></span>}</td>;
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
      <p className="timetable-legend mt-2.5 flex shrink-0 items-center justify-center gap-2 text-[12px] font-medium text-muted"><span aria-hidden className="inline-flex h-5 items-center rounded-md px-2 text-[11px] font-bold" style={CARRY_STYLE}>课名</span>粗框黄底的课要带课本或工具</p>
      </>}
    </main>
  );
}


/* ───────────────────────── 课表（只读）：课程表 + 作息时间 ─────────────────────────
 * 2026-11-25 用户："课表特别难看，根据学校的作息时间表重新设计，时间和课程混合或分开都可以"。
 * 分开：左边课程表只放课（节次 × 周一到周五，不夹休息行、不写时间），右边作息时间按学校的作息表
 * （data/schoolSchedule.ts）一行一项，正在进行的那一项浅绿底标"现在"。手机上两块用切换按钮看其中一块。
 * iPad、手机整页一屏，课程表行高按屏幕平分。
 */
const SECTION_BADGE: Record<TimetableSection, { color: string; background: string }> = {
  morning: { color: "#9A5B00", background: "#FDF0D8" },
  afternoon: { color: "#2F6FAE", background: "#E3EEF9" },
  extended: { color: "#2B7656", background: "#E3F0E9" },
};

function ReadView({ draft, tomorrow, now, phoneView, onPhoneView }: { draft: SchoolTimetable; tomorrow: TimetableDay | null; now: Date; phoneView: "grid" | "schedule"; onPhoneView: (view: "grid" | "schedule") => void }) {
  return (
    <>
      <div role="tablist" aria-label="课程表 / 作息时间" className="mb-2 grid shrink-0 grid-cols-2 gap-1 rounded-full border border-ink/10 bg-white p-1 sm:hidden">
        {(["grid", "schedule"] as const).map((value) => (
          <button key={value} type="button" role="tab" aria-selected={phoneView === value} onClick={() => onPhoneView(value)}
            className={`min-h-10 rounded-full text-[14px] font-semibold ${phoneView === value ? "bg-ink text-white" : "text-muted"}`}>{value === "grid" ? "课程表" : "作息时间"}</button>
        ))}
      </div>
      <div className="fit-fill grid min-h-0 gap-3 sm:grid-cols-[minmax(0,1fr)_13.5rem] lg:grid-cols-[minmax(0,1fr)_17rem] desk:gap-4">
        <div className={`${phoneView === "grid" ? "flex" : "hidden"} min-h-0 flex-col sm:flex`}>
          <CourseGrid draft={draft} tomorrow={tomorrow} />
          <p className="mt-2 flex shrink-0 items-center justify-center gap-2 text-[12px] font-medium text-muted"><span aria-hidden className="inline-flex h-5 items-center rounded-md px-2 text-[11px] font-bold" style={CARRY_STYLE}>课名</span>粗框黄底的课要带课本或工具</p>
        </div>
        <div className={`${phoneView === "schedule" ? "flex" : "hidden"} min-h-0 flex-col sm:flex`}>
          <DaySchedule now={now} />
        </div>
      </div>
    </>
  );
}

function CourseGrid({ draft, tomorrow }: { draft: SchoolTimetable; tomorrow: TimetableDay | null }) {
  const first = draft.slots.find((slot) => slot.id === "extended-1");
  const second = draft.slots.find((slot) => slot.id === "extended-2");
  // 课后服务前两段同一门（云脑班、俱乐部）合成一格
  const merged = new Set(TIMETABLE_DAYS.filter((day) => first?.courses[day] && first.courses[day] === second?.courses[day]));
  let classNo = 0;
  let afterNo = 0;
  const divider = (key: string, text: string, tone: string) => (
    <tr key={key} className="h-7"><td colSpan={6} className={`border-b border-ink/[0.07] px-2 text-center text-[12px] font-semibold tracking-wide ${tone}`}>{text}</td></tr>
  );
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-ink/[0.08] bg-white shadow-[0_1px_2px_rgba(32,41,37,0.04),0_12px_32px_-20px_rgba(32,41,37,0.25)]">
      <table className="h-full w-full table-fixed border-separate border-spacing-0">
        <colgroup><col className="w-11 sm:w-14" />{TIMETABLE_DAYS.map((day) => <col key={day} />)}</colgroup>
        <thead>
          <tr className="h-10 bg-[#F7F6F3]">
            <th className="border-b border-ink/[0.08]" aria-label="节次" />
            {TIMETABLE_DAYS.map((day) => (
              <th key={day} className={`border-b border-ink/[0.08] px-1 text-center text-[13px] font-bold sm:text-[14px] ${tomorrow === day ? "bg-primary/[0.08] text-primary" : "text-ink"}`}>
                {DAY_LABELS[day]}{tomorrow === day && <span className="ml-1 hidden rounded-full bg-primary px-1.5 py-px align-middle text-[10px] font-semibold text-white sm:inline-block">明天</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {draft.slots.flatMap((slot, index) => {
            const rows = [];
            const prev = draft.slots[index - 1];
            if (prev && prev.section !== slot.section) rows.push(slot.section === "afternoon" ? divider("lunch", `午餐 · 午休  ${SCHOOL_LUNCH.start}–${SCHOOL_LUNCH.end}`, "bg-[#FDF6E9] text-amber-800") : divider("after", "课后服务  15:55 起", "bg-[#EEF5F1] text-primary"));
            const badge = SECTION_BADGE[slot.section];
            const label = slot.section === "extended" ? `${++afterNo}` : `${++classNo}`;
            rows.push(
              <tr key={slot.id}>
                <th scope="row" className="border-b border-r border-ink/[0.07] bg-[#FBFAF8] px-1 font-normal">
                  <span className="mx-auto flex h-7 w-7 flex-col items-center justify-center rounded-full text-[13px] font-bold leading-none sm:h-8 sm:w-8" style={badge} title={slot.section === "extended" ? `课后第 ${label} 段` : `第 ${label} 节`}>
                    {slot.section === "extended" && <span className="text-[8px] font-semibold leading-none">课后</span>}{label}
                  </span>
                </th>
                {TIMETABLE_DAYS.map((day) => {
                  if (slot.id === "extended-2" && merged.has(day)) return null;
                  const span = slot.id === "extended-1" && merged.has(day) ? 2 : 1;
                  const course = slot.courses[day];
                  const carry = slot.highlights[day];
                  return (
                    <td key={day} rowSpan={span} className={`border-b border-r border-ink/[0.07] p-[3px] align-middle last:border-r-0 sm:p-1 ${tomorrow === day ? "bg-primary/[0.04]" : ""}`}>
                      <span className="flex h-full min-h-9 w-full items-center justify-center rounded-lg px-0.5 py-1 text-center text-[14px] font-bold leading-tight sm:min-h-10 sm:text-[16px]" style={carry ? CARRY_STYLE : courseTone(course)} title={carry ? "要带课本或工具" : undefined}>
                        <CourseName course={course} stacked />
                      </span>
                    </td>
                  );
                })}
              </tr>,
            );
            return rows;
          })}
        </tbody>
      </table>
    </section>
  );
}

function ScheduleRow({ entry, current }: { entry: ScheduleItem; current: boolean }) {
  const tone = entry.kind === "class" ? "text-[14px] font-semibold text-ink" : entry.kind === "activity" ? "text-[14px] font-medium text-primary" : entry.kind === "big-break" ? "text-[13px] font-semibold text-amber-800" : "text-[13px] text-muted";
  return (
    <li className={`flex min-h-[26px] items-center gap-1.5 rounded-md px-2 py-0.5 ${current ? "bg-mint ring-1 ring-inset ring-primary/30" : ""}`}>
      <span className={`w-[4.6rem] shrink-0 text-[12px] tabular-nums lg:w-[5.25rem] ${entry.kind === "class" ? "font-semibold text-ink" : "text-muted"}`}>{entry.start}–{entry.end}</span>
      <span className={`min-w-0 flex-1 leading-tight ${tone}`}>{entry.label}</span>
      {current && <span className="shrink-0 rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-5 text-white">现在</span>}
    </li>
  );
}

function DaySchedule({ now }: { now: Date }) {
  const current = currentScheduleItem(now);
  const day = now.getDay();
  const isCurrent = (entry: ScheduleItem) => !!current && current.start === entry.start && current.label === entry.label;
  const sectionTitle = (text: string, color: string) => <p className="mb-0.5 mt-2 flex items-center gap-1.5 px-2 text-[12px] font-bold first:mt-0" style={{ color }}><span aria-hidden className="h-3 w-[3px] rounded-full" style={{ backgroundColor: color }} />{text}</p>;
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-ink/[0.08] bg-white shadow-[0_1px_2px_rgba(32,41,37,0.04),0_12px_32px_-20px_rgba(32,41,37,0.25)]">
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-ink/[0.08] bg-[#F7F6F3] px-3">
        <h2 className="text-[14px] font-bold text-ink">作息时间</h2>
        <span className="text-[12px] text-muted">{SCHOOL_DISMISS.leave} 放学</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {sectionTitle("上午", "#C98A1E")}
        <ul>{SCHOOL_MORNING.items.map((entry) => <ScheduleRow key={entry.start + entry.label} entry={entry} current={isCurrent(entry)} />)}</ul>
        <ul className="my-1"><ScheduleRow entry={SCHOOL_LUNCH} current={isCurrent(SCHOOL_LUNCH)} /></ul>
        {sectionTitle("下午", "#3B82C4")}
        <ul>{SCHOOL_AFTERNOON.items.map((entry) => <ScheduleRow key={entry.start + entry.label} entry={entry} current={isCurrent(entry)} />)}</ul>
        {sectionTitle("课后服务", "#2B7656")}
        {SCHOOL_AFTER.map((group) => (
          <div key={group.title} className={`mt-1 rounded-lg px-0.5 py-1 ${group.days.includes(day) ? "bg-[#F3F8F5]" : ""}`}>
            <p className="px-2 text-[12px] font-semibold text-muted">{group.title}{group.days.includes(day) && <span className="ml-1 text-primary">· 今天</span>}</p>
            <ul>{group.items.map((entry) => <ScheduleRow key={entry.start + entry.label} entry={entry} current={group.days.includes(day) && isCurrent(entry)} />)}</ul>
          </div>
        ))}
        <p className="mx-1 mt-2 rounded-md bg-primary/10 px-2 py-1.5 text-[13px] font-semibold text-primary">{SCHOOL_DISMISS.text}</p>
      </div>
    </section>
  );
}
