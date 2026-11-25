import { ChevronDown } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { HabitSection } from "../components/HabitSection";
import { taskRepository } from "../data/taskRepository";
import { todayKey } from "../utils/date";

type CourseStats = Awaited<ReturnType<typeof taskRepository.getCourseStatistics>>;

export type StatsTab = "habits" | "courses";

/**
 * 统计（原"周计划及打卡"；2026-11-25 页面整理改名并分标签，一次只看一块）：
 * - 打卡：月度概览、每个项目一张卡、打卡矩阵；
 * （"本周"标签同日去掉：和今日页右栏重复，用户要求）
 * - 上课：课程节数（本月 / 本年累计直接显示，自定义时间段收在下面）。
 * 云同步、备份、课程、假期、历史备忘、操作记录都在"设置"页。
 */
export function StatsPage({ refreshKey, tab, tabs }: { refreshKey: number; tab: StatsTab; tabs: ReactNode }) {
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
    {tab === "habits" && <HabitSection />}
    {tab === "courses" && <div className="space-y-3 sm:space-y-4">
      <CourseTotals refreshKey={refreshKey} />
      <section className="surface px-3 py-1 sm:px-5">
        <button onClick={() => setShowCustom(!showCustom)} aria-expanded={showCustom} className="flex min-h-12 w-full items-center gap-1 text-[14px] font-semibold text-ink">按时间段统计<span className="ml-1 text-[13px] font-normal text-muted">自己选开始和结束日期</span><ChevronDown className={`ml-auto h-4 w-4 text-muted transition ${showCustom ? "rotate-180" : ""}`} /></button>
        {showCustom && <><div className="mt-1 flex flex-wrap items-end gap-2"><label className="text-[13px] text-muted">开始日期<input type="date" value={courseStart} onChange={(event) => setCourseStart(event.target.value)} className="mt-1 block min-h-11 rounded-lg border px-2.5 text-sm text-stone-700" /></label><label className="text-[13px] text-muted">结束日期<input type="date" value={courseEnd} onChange={(event) => setCourseEnd(event.target.value)} className="mt-1 block min-h-11 rounded-lg border px-2.5 text-sm text-stone-700" /></label><button onClick={countCourses} className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white">统计</button></div>{message && <p role="alert" className="mt-3 text-sm text-rose-700">{message}</p>}{courseStats && <CourseStatistics data={courseStats} />}<div className="h-3" /></>}
      </section>
    </div>}
  </main>;
}

const COURSE_GROUPS = ["语文", "数学", "英语", "兴趣班", "其他"];
/** 分组颜色：语文 / 数学 / 英语用学科色（同今日页色点），兴趣班主色，其他灰 */
const GROUP_COLOR: Record<string, string> = { 语文: "#D96A52", 数学: "#5868C8", 英语: "#9364C7", 兴趣班: "#2B7656", 其他: "#8A948F" };

/**
 * 上课（2026-11-25 用户："统计下的上课页面也非常丑"，重新设计）：
 * - 三张概览卡：本月几节、今年几节、今年上得最多的课；
 * - 每个分组一张卡（语文 / 数学 / 英语 / 兴趣班 / 其他，左上学科色点），每门课一行：课名、今年节数条形（按全年最多那门的比例）、
 *   右边“本月 N 节”和“今年 N 节”；本月没上的本月数字变灰。宽屏两列。
 * 都算到今天为止（含今天），口径同 getCourseStatistics（按实际排到的节数，取消 / 顺延的不算、顺延到的那天算）。
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
  const monthName = `${Number(today.slice(5, 7))}月`;
  const monthCount = new Map(data.month.items.map((item) => [`${item.group}:${item.label}`, item.count]));
  const groups = COURSE_GROUPS.map((group) => ({ group, items: data.year.items.filter((item) => item.group === group).sort((a, b) => b.count - a.count) })).filter((group) => group.items.length);
  if (!groups.length) return <div className="surface p-6 text-center text-sm text-muted">今年还没有课程</div>;
  const top = [...data.year.items].sort((a, b) => b.count - a.count)[0];
  const max = Math.max(...data.year.items.map((item) => item.count), 1);
  const tile = "surface min-w-0 p-3 sm:p-4";
  return <>
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      <div className={tile}><p className="text-[13px] font-medium text-muted">{monthName}上课</p><p className="mt-1.5 text-[24px] font-bold leading-8 tabular-nums text-primary sm:text-[28px]">{data.month.total}<span className="text-[15px] font-semibold text-muted"> 节</span></p><p className="mt-1 truncate text-[12px] text-muted sm:text-[13px]">截至 {Number(today.slice(5, 7))}月{Number(today.slice(8))}日</p></div>
      <div className={tile}><p className="text-[13px] font-medium text-muted">{today.slice(0, 4)}年</p><p className="mt-1.5 text-[24px] font-bold leading-8 tabular-nums text-ink sm:text-[28px]">{data.year.total}<span className="text-[15px] font-semibold text-muted"> 节</span></p><p className="mt-1 truncate text-[12px] text-muted sm:text-[13px]">{data.year.items.length} 门课</p></div>
      <div className={tile}><p className="text-[13px] font-medium text-muted">上得最多</p><p className="mt-1.5 truncate text-[17px] font-bold leading-8 text-ink sm:text-[20px]" title={top.label}>{top.label}</p><p className="mt-1 truncate text-[12px] text-muted sm:text-[13px]">今年 {top.count} 节</p></div>
    </div>
    <div className="grid gap-3 lg:grid-cols-2 lg:gap-4">
      {groups.map(({ group, items }) => {
        const color = GROUP_COLOR[group] ?? GROUP_COLOR.其他;
        const groupMonth = items.reduce((sum, item) => sum + (monthCount.get(`${item.group}:${item.label}`) ?? 0), 0);
        const groupYear = items.reduce((sum, item) => sum + item.count, 0);
        return <section key={group} className="surface overflow-hidden">
          <header className="flex items-center gap-2 border-b border-ink/[0.07] px-3 py-3 sm:px-4">
            <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
            <h3 className="text-[15px] font-bold text-ink">{group}</h3>
            <span className="ml-auto text-[13px] tabular-nums text-muted">{monthName} <span className="font-semibold text-ink">{groupMonth}</span> · 今年 <span className="font-semibold text-ink">{groupYear}</span> 节</span>
          </header>
          <ul className="divide-y divide-ink/[0.05]">
            {items.map((item) => {
              const month = monthCount.get(`${item.group}:${item.label}`) ?? 0;
              return <li key={item.label} className="px-3 py-2.5 sm:px-4">
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink">{item.label}</span>
                  <span className={`w-16 shrink-0 text-right text-[13px] tabular-nums ${month ? "text-ink" : "text-stone-300"}`}>{monthName} <span className="font-bold">{month}</span></span>
                  <span className="w-16 shrink-0 text-right text-[13px] tabular-nums text-muted">今年 <span className="font-bold text-ink">{item.count}</span></span>
                </div>
                <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-stone-100"><span className="block h-full rounded-full" style={{ width: `${(item.count / max) * 100}%`, backgroundColor: color, opacity: 0.75 }} /></span>
              </li>;
            })}
          </ul>
        </section>;
      })}
    </div>
  </>;
}

function CourseStatistics({ data }: { data: CourseStats }) {
  const groups = COURSE_GROUPS.map((group) => ({ group, items: data.items.filter((item) => item.group === group) })).filter((group) => group.items.length);
  return <div className="mt-3 rounded-lg bg-stone-50 p-3 text-sm"><p className="text-[13px] text-stone-400">{data.startDate} 至 {data.endDate}</p>{groups.length ? <div className="mt-2 grid gap-3 sm:grid-cols-2">{groups.map(({ group, items }) => <div key={group}><h4 className="text-[13px] font-semibold text-stone-600">{group}</h4>{items.map((item) => <div key={`${group}:${item.label}`} className="mt-1 flex justify-between gap-3 text-[13px] text-stone-600"><span className="truncate">{item.label}</span><span className="shrink-0 font-medium">{item.count} 节</span></div>)}</div>)}</div> : <p className="mt-2 text-[13px] text-stone-400">该日期范围内暂无课程</p>}<p className="mt-3 border-t pt-2 text-right font-semibold">合计：{data.total} 节</p></div>;
}
