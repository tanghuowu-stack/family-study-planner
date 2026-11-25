import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { taskRepository } from "../data/taskRepository";
import { DESK_QUERY, useMediaQuery } from "../hooks/useMediaQuery";
import { db } from "../data/db";
import { loadPointsContext } from "../data/pointsService";
import { getWeekStartKey, todayKey, toDateKey } from "../utils/date";
import { taskShortName } from "../utils/taskMeta";
import { practiceHistory, type PracticeHistoryRow } from "../utils/weeklyTimes";
import type { Task } from "../types/task";

type CourseStats = Awaited<ReturnType<typeof taskRepository.getCourseStatistics>>;

export type StatsTab = "practice" | "courses";

/**
 * 统计（原"周计划及打卡"；2026-11-25 页面整理改名并分标签，一次只看一块）：
 * - 练习：每周练习一周一周的完成情况和每周积分（2026-11-25 B3，代替原来的"打卡"：打卡里的钢琴、背诗、听写、RAZ
 *   和每周练习是同一批事，重复了；原打卡月历、管理、休息日一起去掉，任务上的打卡字段保留不用）；
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
  return <main className="fit-screen mx-auto w-full max-w-5xl lg:max-w-none xl:max-w-6xl px-3 pb-content pt-4 sm:px-7 sm:pt-6 lg:px-10">
    {tabs}
    {tab === "practice" && <div className="fit-fill flex min-h-0 flex-col"><PracticeHistory refreshKey={refreshKey} /></div>}
    {tab === "courses" && <div className="fit-fill flex min-h-0 flex-col gap-2 desk:gap-4">
      <CourseTotals refreshKey={refreshKey} />
      <section className="surface shrink-0 px-3 py-0.5 sm:px-5">
        <button onClick={() => setShowCustom(!showCustom)} aria-expanded={showCustom} className="flex min-h-12 w-full items-center gap-1 text-[14px] font-semibold text-ink">按时间段统计<ChevronDown className={`ml-auto h-4 w-4 text-muted transition ${showCustom ? "rotate-180" : ""}`} /></button>
        {showCustom && <><div className="mt-1 flex flex-wrap items-end gap-2"><label className="text-[13px] text-muted">开始日期<input type="date" value={courseStart} onChange={(event) => setCourseStart(event.target.value)} className="mt-1 block min-h-11 rounded-lg border px-2.5 text-sm text-stone-700" /></label><label className="text-[13px] text-muted">结束日期<input type="date" value={courseEnd} onChange={(event) => setCourseEnd(event.target.value)} className="mt-1 block min-h-11 rounded-lg border px-2.5 text-sm text-stone-700" /></label><button onClick={countCourses} className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white">统计</button></div>{message && <p role="alert" className="mt-3 text-sm text-rose-700">{message}</p>}{courseStats && <CourseStatistics data={courseStats} />}<div className="h-3" /></>}
      </section>
    </div>}
  </main>;
}

/**
 * 统计 › 练习：行 = 每周练习，列 = 周（Mac 8 周，手机 / iPad 4 周，‹ › 往前翻），每格“做了 / 目标”，
 * 达标的主色实心块、过去没达标的玫红字、本周浅绿底；最后一行是那周的积分（练习 + 提前完成 + 家长奖励）。
 */
function PracticeHistory({ refreshKey }: { refreshKey: number }) {
  const desk = useMediaQuery(DESK_QUERY);
  const count = desk ? 8 : 4;
  const thisWeek = getWeekStartKey(todayKey());
  const [offset, setOffset] = useState(0); // 往前翻了几周
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [scores, setScores] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    void db.tasks.toArray().then(setTasks);
    void loadPointsContext().then((ctx) => setScores(new Map(ctx.summary.history.map((week) => [week.weekStart, week.total])))).catch(() => setScores(new Map()));
  }, [refreshKey]);
  if (!tasks) return null;
  const weeks = Array.from({ length: count }, (_, index) => {
    const d = new Date(`${thisWeek}T00:00:00`);
    d.setDate(d.getDate() - 7 * (count - 1 - index + offset));
    return toDateKey(d);
  });
  const rows: PracticeHistoryRow[] = practiceHistory(tasks, weeks, thisWeek);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const label = (week: string) => week === thisWeek ? "本周" : `${Number(week.slice(5, 7))}/${Number(week.slice(8))}`;
  const cellClass = "px-1 text-center tabular-nums";
  if (!rows.length) return <div className="surface p-6 text-center text-sm text-muted">这几周没有每周练习</div>;
  return (
    <section className="surface flex min-h-0 shrink flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full table-fixed border-separate border-spacing-0 text-[14px] desk:text-[15px]">
          <colgroup><col className="w-[6.5rem] desk:w-40" />{weeks.map((week) => <col key={week} />)}</colgroup>
          <thead className="sticky top-0 z-10 bg-[#F7F6F3]">
            <tr className="h-11 text-[12px] font-semibold text-muted desk:text-[13px]">
              <th className="border-b border-ink/[0.08] pl-3 text-left desk:pl-4">
                <span className="flex items-center gap-0.5">练习
                  <span className="ml-auto flex">
                    <button type="button" aria-label="往前看" onClick={() => setOffset(offset + 1)} disabled={offset >= 26} className="flex h-8 w-7 items-center justify-center rounded-full text-ink hover:bg-white disabled:text-stone-300"><ChevronLeft className="h-4 w-4" /></button>
                    <button type="button" aria-label="往后看" onClick={() => setOffset(Math.max(0, offset - 1))} disabled={offset === 0} className="flex h-8 w-7 items-center justify-center rounded-full text-ink hover:bg-white disabled:text-stone-300"><ChevronRight className="h-4 w-4" /></button>
                  </span>
                </span>
              </th>
              {weeks.map((week) => <th key={week} className={`border-b border-ink/[0.08] ${cellClass} ${week === thisWeek ? "bg-mint/60 text-primary" : ""}`}>{label(week)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.taskId} className="h-11">
                <td className="truncate border-b border-ink/[0.05] pl-3 pr-1 text-ink desk:pl-4">{byId.get(row.taskId) ? taskShortName(byId.get(row.taskId)!) : ""}</td>
                {row.cells.map((cell, index) => {
                  const week = weeks[index];
                  const current = week === thisWeek;
                  if (!cell) return <td key={week} className={`border-b border-ink/[0.05] ${cellClass} text-stone-300 ${current ? "bg-mint/30" : ""}`}>–</td>;
                  const missed = !cell.reached && !current;
                  return (
                    <td key={week} className={`border-b border-ink/[0.05] p-1 ${current ? "bg-mint/30" : ""}`}>
                      <span className={`flex h-8 items-center justify-center rounded-md text-[13px] font-semibold tabular-nums ${cell.reached ? "bg-primary text-white" : missed ? "text-rose-600" : "text-ink"}`} title={`${cell.done}/${cell.target} ${cell.unit}`}>
                        {cell.reached && "✓ "}{cell.done}/{cell.target}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0 bg-white">
            <tr className="h-11 font-bold">
              <td className="border-t border-ink/10 pl-3 text-ink desk:pl-4">积分</td>
              {weeks.map((week) => <td key={week} className={`border-t border-ink/10 ${cellClass} ${week === thisWeek ? "bg-mint/40 text-primary" : scores.has(week) ? "text-ink" : "text-stone-300"}`}>{scores.has(week) ? scores.get(week) : "–"}</td>)}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

const COURSE_GROUPS = ["语文", "数学", "英语", "兴趣班", "其他"];
/** 分组颜色：语文 / 数学 / 英语用学科色（同今日页色点），兴趣班主色，其他灰 */
const GROUP_COLOR: Record<string, string> = { 语文: "#D96A52", 数学: "#5868C8", 英语: "#9364C7", 兴趣班: "#2B7656", 其他: "#8A948F" };

/**
 * 上课（2026-11-25 第三版，用户：彩色横条、每项"11月多少节、今年多少节"太乱）：一张按月的表。
 * 行 = 课程（按 语文 / 数学 / 英语 / 兴趣班 / 其他 分组），列 = 三个月（默认上个月、这个月、下个月）+ 本年合计；
 * 表头 ‹ › 在今年 1–12 月里左右翻。过去的月份是实际上了几节；这个月算到今天；以后的月份是任务里排了几节（标"计划"，灰字）。
 * 本年合计 = 今年 1 月 1 日到今天实际上的。口径同 getCourseStatistics（取消 / 顺延的不算、顺延到的那天算）。
 */
function CourseTotals({ refreshKey }: { refreshKey: number }) {
  const today = todayKey();
  const year = today.slice(0, 4);
  const thisMonth = Number(today.slice(5, 7));
  const [months, setMonths] = useState<CourseStats[] | null>(null);
  const [yearToDate, setYearToDate] = useState<CourseStats | null>(null);
  const [first, setFirst] = useState(() => Math.min(Math.max(thisMonth - 1, 1), 10));
  // Mac（电脑布局）1–12 月全显示；手机、iPad 只显示三个月，‹ › 翻（2026-11-25 用户）
  const desk = useMediaQuery(DESK_QUERY);
  useEffect(() => {
    const ranges = Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      const start = `${year}-${String(month).padStart(2, "0")}-01`;
      const last = new Date(Number(year), month, 0).getDate();
      const end = month === thisMonth ? today : `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
      return [start, end] as const;
    });
    void Promise.all([...ranges.map(([start, end]) => taskRepository.getCourseStatistics(start, end)), taskRepository.getCourseStatistics(`${year}-01-01`, today)])
      .then((results) => { setMonths(results.slice(0, 12)); setYearToDate(results[12]); });
  }, [refreshKey, today]);
  if (!months || !yearToDate) return null;
  const key = (item: { group: string; label: string }) => `${item.group}:${item.label}`;
  const counts = months.map((stats) => new Map(stats.items.map((item) => [key(item), item.count])));
  const yearCount = new Map(yearToDate.items.map((item) => [key(item), item.count]));
  const all = new Map<string, { group: string; label: string }>();
  [...months.flatMap((stats) => stats.items), ...yearToDate.items].forEach((item) => all.set(key(item), { group: item.group, label: item.label }));
  const groups = COURSE_GROUPS.map((group) => ({ group, items: [...all.values()].filter((item) => item.group === group).sort((a, b) => (yearCount.get(key(b)) ?? 0) - (yearCount.get(key(a)) ?? 0)) })).filter((group) => group.items.length);
  if (!groups.length) return <div className="surface p-6 text-center text-sm text-muted">今年还没有课程</div>;
  const shown = desk ? Array.from({ length: 12 }, (_, index) => index + 1) : [first, first + 1, first + 2];
  const isPlan = (month: number) => month > thisMonth;
  const cell = desk ? "w-14 px-1 text-right tabular-nums" : "w-[3.25rem] px-1 text-right tabular-nums sm:w-20";
  const monthValue = (month: number, value: number) => <td key={month} className={`${cell} ${month === thisMonth ? "bg-mint/40 font-bold text-ink" : isPlan(month) ? "text-stone-400" : value ? "text-ink" : "text-stone-300"}`}>{value}</td>;
  return (
    <section className="surface flex min-h-0 shrink flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-[14px] sm:text-[15px]">
          <thead className="sticky top-0 z-10 bg-[#F7F6F3]">
            <tr className="h-11 text-[12px] font-semibold text-muted sm:text-[13px]">
              <th className="border-b border-ink/[0.08] pl-3 text-left sm:pl-4">
                <span className="flex items-center gap-1">课程
                  {!desk && <span className="ml-auto flex gap-0.5">
                    <button type="button" aria-label="往前看一个月" disabled={first <= 1} onClick={() => setFirst(first - 1)} className="flex h-8 w-8 items-center justify-center rounded-full text-ink hover:bg-white disabled:text-stone-300"><ChevronLeft className="h-4 w-4" /></button>
                    <button type="button" aria-label="往后看一个月" disabled={first >= 10} onClick={() => setFirst(first + 1)} className="flex h-8 w-8 items-center justify-center rounded-full text-ink hover:bg-white disabled:text-stone-300"><ChevronRight className="h-4 w-4" /></button>
                  </span>}
                </span>
              </th>
              {shown.map((month) => (
                <th key={month} className={`${cell} border-b border-ink/[0.08] ${month === thisMonth ? "bg-mint/60 text-primary" : ""}`}>
                  {month}月{isPlan(month) && <span className="block text-[10px] font-medium leading-3 text-stone-400">计划</span>}
                </th>
              ))}
              <th className="w-16 whitespace-nowrap border-b border-l border-ink/[0.08] px-2 text-right text-ink sm:w-24 sm:px-4">本年合计</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(({ group, items }) => [
              <tr key={group}><td colSpan={shown.length + 2} className="bg-[#FBFAF8] px-3 pb-1 pt-2 text-[12px] font-bold text-muted sm:px-4"><span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: GROUP_COLOR[group] ?? GROUP_COLOR.其他 }} />{group}</span></td></tr>,
              ...items.map((item) => (
                <tr key={key(item)} className="h-10">
                  <td className="max-w-0 truncate border-b border-ink/[0.05] pl-3 pr-2 text-ink sm:pl-4">{item.label}</td>
                  {shown.map((month) => monthValue(month, counts[month - 1].get(key(item)) ?? 0))}
                  <td className="border-b border-l border-ink/[0.05] px-2 text-right font-bold tabular-nums text-ink sm:px-4">{yearCount.get(key(item)) ?? 0}</td>
                </tr>
              )),
            ])}
          </tbody>
          <tfoot className="sticky bottom-0 bg-white">
            <tr className="h-11 font-bold">
              <td className="border-t border-ink/10 pl-3 text-ink sm:pl-4">合计</td>
              {shown.map((month) => <td key={month} className={`${cell} border-t border-ink/10 ${month === thisMonth ? "bg-mint/40 text-ink" : isPlan(month) ? "text-stone-400" : "text-ink"}`}>{months[month - 1].total}</td>)}
              <td className="border-l border-t border-ink/10 px-2 text-right tabular-nums text-primary sm:px-4">{yearToDate.total}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function CourseStatistics({ data }: { data: CourseStats }) {
  const groups = COURSE_GROUPS.map((group) => ({ group, items: data.items.filter((item) => item.group === group) })).filter((group) => group.items.length);
  return <div className="mt-3 rounded-lg bg-stone-50 p-3 text-sm"><p className="text-[13px] text-stone-400">{data.startDate} 至 {data.endDate}</p>{groups.length ? <div className="mt-2 grid gap-3 sm:grid-cols-2">{groups.map(({ group, items }) => <div key={group}><h4 className="text-[13px] font-semibold text-stone-600">{group}</h4>{items.map((item) => <div key={`${group}:${item.label}`} className="mt-1 flex justify-between gap-3 text-[13px] text-stone-600"><span className="truncate">{item.label}</span><span className="shrink-0 font-medium">{item.count} 节</span></div>)}</div>)}</div> : <p className="mt-2 text-[13px] text-stone-400">该日期范围内暂无课程</p>}<p className="mt-3 border-t pt-2 text-right font-semibold">合计：{data.total} 节</p></div>;
}
