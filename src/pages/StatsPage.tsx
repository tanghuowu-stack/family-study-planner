import { ChevronDown } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { HabitSection } from "../components/HabitSection";
import { WeekReviewStrip } from "../components/WeekReviewStrip";
import { taskRepository } from "../data/taskRepository";
import { todayKey } from "../utils/date";

type CourseStats = Awaited<ReturnType<typeof taskRepository.getCourseStatistics>>;

export type StatsTab = "week" | "habits" | "courses";

/**
 * 统计（原"周计划及打卡"；2026-11-25 页面整理改名并分成三个标签，一次只看一块，不再一长页堆三块）：
 * - 本周：本周每天完成情况（每天 + 每周几次），点某天展开那天还没做的；
 * - 打卡：各打卡项目的月历；
 * - 上课：课程节数（本月 / 本年累计直接显示，自定义时间段收在下面）。
 * 云同步、备份、课程、假期、历史备忘、操作记录都在"设置"页。
 */
export function StatsPage({ refreshKey, onOpenDay, tab, tabs }: { refreshKey: number; onOpenDay: (date: string) => void; tab: StatsTab; tabs: ReactNode }) {
  const [message, setMessage] = useState("");
  const [courseStart, setCourseStart] = useState(() => `${todayKey().slice(0, 7)}-01`);
  const [courseEnd, setCourseEnd] = useState(todayKey);
  const [courseStats, setCourseStats] = useState<CourseStats>();
  const [showCustom, setShowCustom] = useState(false);
  const countCourses = async () => {
    if (!courseStart || !courseEnd || courseStart > courseEnd) return setMessage("课程统计日期范围不正确");
    setCourseStats(await taskRepository.getCourseStatistics(courseStart, courseEnd));
    setMessage("");
  };
  return <main className="mx-auto w-full max-w-5xl lg:max-w-none xl:max-w-6xl px-3 pb-content pt-4 sm:px-7 sm:pt-6 lg:px-10">
    {tabs}
    {tab === "week" && <WeekReviewStrip refreshKey={refreshKey} onOpenDay={onOpenDay} />}
    {tab === "habits" && <HabitSection />}
    {tab === "courses" && <section className="surface p-3 sm:p-5">
      <h2 className="text-base font-bold text-ink">课程节数统计</h2>
      <CourseTotals refreshKey={refreshKey} />
      <div className="mt-3 border-t border-ink/[0.07] pt-2">
        <button onClick={() => setShowCustom(!showCustom)} aria-expanded={showCustom} className="flex min-h-10 items-center gap-1 text-[13px] font-semibold text-muted hover:text-ink">自定义时间段<ChevronDown className={`h-4 w-4 transition ${showCustom ? "rotate-180" : ""}`} /></button>
        {showCustom && <><div className="mt-1 flex flex-wrap items-end gap-2"><label className="text-[13px] text-muted">开始日期<input type="date" value={courseStart} onChange={(event) => setCourseStart(event.target.value)} className="mt-1 block min-h-11 rounded-lg border px-2.5 text-sm text-stone-700" /></label><label className="text-[13px] text-muted">结束日期<input type="date" value={courseEnd} onChange={(event) => setCourseEnd(event.target.value)} className="mt-1 block min-h-11 rounded-lg border px-2.5 text-sm text-stone-700" /></label><button onClick={countCourses} className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white">统计</button></div>{message && <p role="alert" className="mt-3 text-sm text-rose-700">{message}</p>}{courseStats && <CourseStatistics data={courseStats} />}</>}
      </div>
    </section>}
  </main>;
}

const COURSE_GROUPS = ["语文", "数学", "英语", "兴趣班", "其他"];

/**
 * 本月 / 本年课程累计（2026-11-19 用户要求，不用再自己选日期点统计）：都算到今天为止（含今天），
 * 口径同 getCourseStatistics（按实际排到的节数，取消 / 顺延的不算、顺延到的那天算）。
 * 每门课一行，两列：本月几节、本年几节；按 语文 / 数学 / 英语 / 兴趣班 / 其他 分组，最后一行合计。
 */
function CourseTotals({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<{ month: CourseStats; year: CourseStats } | null>(null);
  useEffect(() => {
    const today = todayKey();
    void Promise.all([taskRepository.getCourseStatistics(`${today.slice(0, 7)}-01`, today), taskRepository.getCourseStatistics(`${today.slice(0, 4)}-01-01`, today)])
      .then(([month, year]) => setData({ month, year }));
  }, [refreshKey]);
  if (!data) return null;
  const today = todayKey();
  const monthCount = new Map(data.month.items.map((item) => [`${item.group}:${item.label}`, item.count]));
  const groups = COURSE_GROUPS.map((group) => ({ group, items: data.year.items.filter((item) => item.group === group) })).filter((group) => group.items.length);
  if (!groups.length) return <p className="mt-2 text-[13px] text-muted">今年还没有课程</p>;
  const cell = "w-16 text-right tabular-nums sm:w-24";
  return <div className="mt-2 max-w-2xl text-[14px] sm:text-[15px]">
    <div className="flex items-center gap-2 border-b border-ink/10 pb-1.5 text-[13px] text-muted"><span className="min-w-0 flex-1">截至 {Number(today.slice(5, 7))}月{Number(today.slice(8))}日</span><span className={cell}>{Number(today.slice(5, 7))}月</span><span className={cell}>{today.slice(0, 4)}年</span></div>
    <div>
      {groups.map(({ group, items }) => <div key={group} className="pt-2">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-muted">{group}</h3>
        {items.map((item) => {
          const month = monthCount.get(`${item.group}:${item.label}`) ?? 0;
          return <div key={item.label} className="flex min-h-8 items-center gap-2 border-b border-ink/[0.05] text-ink">
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <span className={`${cell} ${month ? "font-semibold" : "text-stone-300"}`}>{month} <span className="text-[13px] font-normal text-muted">节</span></span>
            <span className={`${cell} font-semibold`}>{item.count} <span className="text-[13px] font-normal text-muted">节</span></span>
          </div>;
        })}
      </div>)}
    </div>
    <div className="mt-2 flex items-center gap-2 font-bold text-ink"><span className="min-w-0 flex-1">合计</span><span className={cell}>{data.month.total} <span className="text-[13px] font-normal text-muted">节</span></span><span className={cell}>{data.year.total} <span className="text-[13px] font-normal text-muted">节</span></span></div>
  </div>;
}

function CourseStatistics({ data }: { data: CourseStats }) {
  const groups = COURSE_GROUPS.map((group) => ({ group, items: data.items.filter((item) => item.group === group) })).filter((group) => group.items.length);
  return <div className="mt-3 rounded-lg bg-stone-50 p-3 text-sm"><p className="text-[13px] text-stone-400">{data.startDate} 至 {data.endDate}</p>{groups.length ? <div className="mt-2 grid gap-3 sm:grid-cols-2">{groups.map(({ group, items }) => <div key={group}><h4 className="text-[13px] font-semibold text-stone-600">{group}</h4>{items.map((item) => <div key={`${group}:${item.label}`} className="mt-1 flex justify-between gap-3 text-[13px] text-stone-600"><span className="truncate">{item.label}</span><span className="shrink-0 font-medium">{item.count} 节</span></div>)}</div>)}</div> : <p className="mt-2 text-[13px] text-stone-400">该日期范围内暂无课程</p>}<p className="mt-3 border-t pt-2 text-right font-semibold">合计：{data.total} 节</p></div>;
}
