import { BookOpen, Check, Flag, Pencil, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { formatFullDate, fromDateKey, todayKey } from "../utils/date";
import { getCalendarAnnotation } from "../data/calendarAnnotations";
import { currentScheduleItem, durationText, SCHOOL_AFTER_BY_DAY, SCHOOL_AFTERNOON, SCHOOL_DISMISS, SCHOOL_LUNCH, SCHOOL_MORNING, SCHOOL_NAP, type ScheduleItem } from "../data/schoolSchedule";
import {
  applyTimetableAfterSchoolFixOnce,
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
 * 要带课本或工具的课（2026-11-25 用户：黄点不显眼；黄底粗框又难看）：
 * 色块改成该课程颜色的**实心深色块 + 白字**，旁边的普通课是同色浅底，一眼就能分出来；
 * 括号里的"课本 / 葫芦丝"在课名下面一行。编辑课表时用"高亮显示"复选框设置。
 */
function carryTone(course: string): { color: string; background: string } {
  const base = courseTone(course);
  // 没有学科色的课（道法、科学、音乐、美术……）统一用青绿实心，不用沉闷的深灰
  return { color: "#FFFFFF", background: base.color === "#202925" ? "#3F8F86" : base.color };
}
const CARRY_LEGEND = { color: "#FFFFFF", background: "#7546AE" } as const;
/** 编辑课表的大表里还用得到（只读页不用） */
const CARRY_STYLE = CARRY_LEGEND;

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
    void loadSchoolTimetable().then((loaded) => applyTimetableAfterSchoolFixOnce(loaded).catch(() => loaded)).then((value) => {
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
      <p className="timetable-legend mt-2.5 flex shrink-0 items-center justify-center gap-2 text-[12px] font-medium text-muted">编辑时勾“高亮显示”的课，平时显示成深色块，表示要带课本或工具</p>
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
          <p className="mt-2 flex shrink-0 items-center justify-center gap-2 text-[12px] font-medium text-muted"><span aria-hidden className="inline-flex h-5 items-center gap-1 rounded-md px-2 text-[11px] font-bold" style={CARRY_LEGEND}><BookOpen className="h-3 w-3" />课名</span>深色块的课要带课本或工具</p>
        </div>
        <div className={`${phoneView === "schedule" ? "flex" : "hidden"} min-h-0 flex-col sm:flex`}>
          <DaySchedule now={now} />
        </div>
      </div>
    </>
  );
}

function CourseGrid({ draft, tomorrow }: { draft: SchoolTimetable; tomorrow: TimetableDay | null }) {
  // 课后几段连着是同一门（周三云脑班三段、周五俱乐部前两段）合成一格
  const spans = extendedSpans(draft);
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
            if (prev && prev.section !== slot.section) rows.push(slot.section === "afternoon" ? divider("lunch", `午餐 ${SCHOOL_LUNCH.start}–${SCHOOL_LUNCH.end} · 午休 ${SCHOOL_NAP.start}–${SCHOOL_NAP.end}`, "bg-[#FDF6E9] text-amber-800") : divider("after", "课后服务  15:55 起", "bg-[#EEF5F1] text-primary"));
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
                  const span = slot.section === "extended" ? spans[day][slot.id] ?? 1 : 1;
                  if (span === 0) return null;
                  const course = slot.courses[day];
                  const carry = slot.highlights[day];
                  return (
                    <td key={day} rowSpan={span} className={`border-b border-r border-ink/[0.07] p-[3px] align-middle last:border-r-0 sm:p-1 ${tomorrow === day ? "bg-primary/[0.04]" : ""}`}>
                      <span className="flex h-full min-h-9 w-full items-center justify-center rounded-lg px-0.5 py-1 text-center text-[14px] font-bold leading-tight sm:min-h-10 sm:text-[16px]" style={carry ? carryTone(course) : courseTone(course)} title={carry ? "要带课本或工具" : undefined}>
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

/** 课后几段的合并：每天 { "extended-1": 行数, ... }，0 = 被上面合并掉 */
function extendedSpans(draft: SchoolTimetable): Record<TimetableDay, Record<string, number>> {
  const ids = draft.slots.filter((slot) => slot.section === "extended").map((slot) => slot.id);
  const course = (id: string, day: TimetableDay) => draft.slots.find((slot) => slot.id === id)?.courses[day]?.trim() ?? "";
  return Object.fromEntries(TIMETABLE_DAYS.map((day) => {
    const result: Record<string, number> = {};
    // 只合并"从课后第 1 段开始连着同一门"（周三云脑班三段、周五俱乐部前两段）；延时课 2、3 同一科也分开写
    ids.forEach((id) => { result[id] = 1; });
    let end = 1;
    while (end < ids.length && course(ids[0], day) && course(ids[end], day) === course(ids[0], day)) end += 1;
    if (end > 1) { result[ids[0]] = end; for (let k = 1; k < end; k += 1) result[ids[k]] = 0; }
    return [day, result];
  })) as Record<TimetableDay, Record<string, number>>;
}

/*
 * 作息时间（2026-11-25 第二版，用户："作息时间表也没有美感"）：一条竖向时间轴。
 * 左边开始时间（上课粗体，下面小字结束时间），中间时间轴上的圆点（上课实心、课间小灰点、大课间 / 午休琥珀圈、课后主色），
 * 右边名称 + 时长。午餐午休是一条琥珀浅底横条；最后一个旗子节点"17:55 下课 · 18:00 放学"。
 * 课后服务每天不同，表头"一 二 三 四 五"切换看哪天（默认今天，周末默认周一）；正在进行的一项浅绿底、圆点闪、标"现在"。
 */
const SECTION_COLOR = { morning: "#C98A1E", afternoon: "#3B82C4", after: "#2B7656" } as const;

function TimelineRow({ entry, color, current, last }: { entry: ScheduleItem; color: string; current: boolean; last?: boolean }) {
  const isClass = entry.kind === "class";
  const isActivity = entry.kind === "activity";
  const isBig = entry.kind === "big-break";
  const dot = isClass || isActivity
    ? <span className={`relative z-10 h-2.5 w-2.5 rounded-full ring-[3px] ring-white ${current ? "animate-pulse" : ""}`} style={{ backgroundColor: current ? "#2B7656" : color }} />
    : isBig ? <span className="relative z-10 h-2.5 w-2.5 rounded-full border-2 border-amber-500 bg-white" /> : <span className="relative z-10 h-1.5 w-1.5 rounded-full bg-stone-300 ring-2 ring-white" />;
  return (
    <li className={`grid grid-cols-[3rem_14px_minmax(0,1fr)] items-center gap-x-2 rounded-lg pr-2 ${isClass || isActivity ? "min-h-[34px]" : "min-h-[22px]"} ${current ? "bg-mint" : ""}`}>
      <span className={`text-right tabular-nums leading-tight ${isClass || isActivity ? "text-[13px] font-bold text-ink" : "text-[11px] text-stone-400"}`}>
        {entry.start}{(isClass || isActivity) && <span className="block text-[10px] font-normal text-stone-400">{entry.end}</span>}
      </span>
      <span className="relative flex h-full items-center justify-center">
        <span aria-hidden className={`absolute left-1/2 top-0 w-px -translate-x-1/2 bg-ink/10 ${last ? "h-1/2" : "bottom-0"}`} />
        {dot}
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={`min-w-0 flex-1 truncate ${isClass ? "text-[14px] font-semibold text-ink" : isActivity ? "text-[14px] font-semibold" : isBig ? "text-[12px] font-semibold text-amber-700" : "text-[12px] text-muted"}`} style={isActivity ? { color } : undefined}>{entry.label}</span>
        {current ? <span className="shrink-0 rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-5 text-white">现在</span>
          : (isClass || isActivity || isBig) && <span className="hidden shrink-0 text-[11px] tabular-nums text-stone-400 lg:inline">{durationText(entry)}</span>}
      </span>
    </li>
  );
}

function DaySchedule({ now }: { now: Date }) {
  const today = now.getDay();
  const [day, setDay] = useState(today >= 1 && today <= 5 ? today : 1);
  const current = day === today ? currentScheduleItem(now) : null;
  const isCurrent = (entry: ScheduleItem) => !!current && current.start === entry.start && current.label === entry.label;
  const after = SCHOOL_AFTER_BY_DAY[day] ?? [];
  const heading = (text: string, color: string, time: string) => (
    <li className="grid grid-cols-[3rem_14px_minmax(0,1fr)] items-center gap-x-2 pb-0.5 pt-2 first:pt-0">
      <span />
      <span className="relative flex h-full items-center justify-center"><span aria-hidden className="absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2 bg-ink/10" /></span>
      <span className="flex items-baseline gap-1.5 text-[12px] font-bold tracking-wide" style={{ color }}>{text}<span className="font-medium text-stone-400">{time}</span></span>
    </li>
  );
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-ink/[0.08] bg-white shadow-[0_1px_2px_rgba(32,41,37,0.04),0_12px_32px_-20px_rgba(32,41,37,0.25)]">
      <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-ink/[0.08] bg-[#F7F6F3] px-3 py-2">
        <h2 className="whitespace-nowrap text-[14px] font-bold text-ink">作息时间</h2>
        <div role="tablist" aria-label="看哪天的课后服务" className="ml-auto flex gap-1 sm:gap-0.5">
          {[1, 2, 3, 4, 5].map((value) => (
            <button key={value} type="button" role="tab" aria-selected={day === value} aria-label={`周${"一二三四五"[value - 1]}`} onClick={() => setDay(value)}
              className={`relative flex h-9 w-11 items-center justify-center rounded-full text-[14px] font-semibold sm:h-7 sm:w-7 sm:text-[12px] ${day === value ? "bg-ink text-white" : "text-muted hover:bg-white"}`}>
              {"一二三四五"[value - 1]}{value === today && <span aria-hidden className={`absolute -bottom-0.5 h-1 w-1 rounded-full ${day === value ? "bg-white" : "bg-primary"}`} />}
            </button>
          ))}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2.5">
        <ol>
          {heading("上午", SECTION_COLOR.morning, "8:25")}
          {SCHOOL_MORNING.items.map((entry) => <TimelineRow key={entry.start + entry.label} entry={entry} color={SECTION_COLOR.morning} current={isCurrent(entry)} />)}
        </ol>
        <div className="my-1.5 space-y-1">
          {[SCHOOL_LUNCH, SCHOOL_NAP].map((entry) => (
            <p key={entry.label} className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-[12px] font-semibold ${isCurrent(entry) ? "bg-mint text-primary" : "bg-[#FDF3E3] text-amber-800"}`}>
              <span>{entry.label}</span><span className="tabular-nums">{entry.start}–{entry.end}{isCurrent(entry) && <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[11px] leading-5 text-white">现在</span>}</span>
            </p>
          ))}
        </div>
        <ol>
          {heading("下午", SECTION_COLOR.afternoon, "14:00")}
          {SCHOOL_AFTERNOON.items.map((entry) => <TimelineRow key={entry.start + entry.label} entry={entry} color={SECTION_COLOR.afternoon} current={isCurrent(entry)} />)}
          {heading("课后服务", SECTION_COLOR.after, "15:55")}
          {after.map((entry) => <TimelineRow key={entry.start + entry.label} entry={entry} color={SECTION_COLOR.after} current={isCurrent(entry)} />)}
          <li className="grid grid-cols-[3rem_14px_minmax(0,1fr)] items-center gap-x-2 pt-1">
            <span className="text-right text-[13px] font-bold tabular-nums text-ink">{SCHOOL_DISMISS.classEnd}</span>
            <span className="relative flex h-full items-center justify-center"><span aria-hidden className="absolute left-1/2 top-0 h-1/2 w-px -translate-x-1/2 bg-ink/10" /><span className="relative z-10 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white"><Flag className="h-3 w-3" /></span></span>
            <span className="text-[13px] font-semibold text-primary">下课 · {SCHOOL_DISMISS.leave} 放学</span>
          </li>
        </ol>
      </div>
    </section>
  );
}
