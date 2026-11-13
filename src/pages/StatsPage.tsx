import { useState } from "react";
import { HabitSection } from "../components/HabitSection";
import { taskRepository } from "../data/taskRepository";
import { todayKey } from "../utils/date";

type CourseStats = Awaited<ReturnType<typeof taskRepository.getCourseStatistics>>;

/**
 * 打卡页（原"统计与设置"，2026-11 第 6 批拆分）：只留打卡月历和课程节数统计；
 * 云同步、备份、课程、假期、历史备忘、操作记录都移到"设置"页。
 */
export function StatsPage() {
  const [message, setMessage] = useState("");
  const [courseStart, setCourseStart] = useState(() => `${todayKey().slice(0, 7)}-01`);
  const [courseEnd, setCourseEnd] = useState(todayKey);
  const [courseStats, setCourseStats] = useState<CourseStats>();
  const countCourses = async () => {
    if (!courseStart || !courseEnd || courseStart > courseEnd) return setMessage("课程统计日期范围不正确");
    setCourseStats(await taskRepository.getCourseStatistics(courseStart, courseEnd));
    setMessage("");
  };
  return <main className="mx-auto w-full max-w-5xl lg:max-w-none xl:max-w-6xl px-4 pb-content pt-4 sm:px-7 sm:pt-6 lg:px-10"><header className="page-header"><h1 className="page-title">打卡</h1></header>
    <HabitSection />
    <section className="surface mt-6 p-4 sm:p-5"><h2 className="text-base font-bold text-ink">课程节数统计</h2><div className="mt-3 flex flex-wrap items-end gap-2"><label className="text-[13px] text-muted">开始日期<input type="date" value={courseStart} onChange={(event) => setCourseStart(event.target.value)} className="mt-1 block min-h-11 rounded-lg border px-2.5 text-sm text-stone-700" /></label><label className="text-[13px] text-muted">结束日期<input type="date" value={courseEnd} onChange={(event) => setCourseEnd(event.target.value)} className="mt-1 block min-h-11 rounded-lg border px-2.5 text-sm text-stone-700" /></label><button onClick={countCourses} className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white">统计</button></div>{message && <p role="alert" className="mt-3 text-sm text-rose-700">{message}</p>}{courseStats && <CourseStatistics data={courseStats} />}</section>
  </main>;
}

function CourseStatistics({ data }: { data: CourseStats }) {
  const groups = ["语文", "数学", "英语", "兴趣班", "其他"].map((group) => ({ group, items: data.items.filter((item) => item.group === group) })).filter((group) => group.items.length);
  return <div className="mt-3 rounded-lg bg-stone-50 p-3 text-sm"><p className="text-[13px] text-stone-400">{data.startDate} 至 {data.endDate}</p>{groups.length ? <div className="mt-2 grid gap-3 sm:grid-cols-2">{groups.map(({ group, items }) => <div key={group}><h4 className="text-[13px] font-semibold text-stone-600">{group}</h4>{items.map((item) => <div key={`${group}:${item.label}`} className="mt-1 flex justify-between gap-3 text-[13px] text-stone-600"><span className="truncate">{item.label}</span><span className="shrink-0 font-medium">{item.count} 节</span></div>)}</div>)}</div> : <p className="mt-2 text-[13px] text-stone-400">该日期范围内暂无课程</p>}<p className="mt-3 border-t pt-2 text-right font-semibold">合计：{data.total} 节</p></div>;
}
