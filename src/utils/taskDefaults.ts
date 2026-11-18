/**
 * 新建任务的默认设置（2026-11-18 统一）。纯函数：表单在选分类、二级类型、上课/作业、课程或改日期时调用，
 * 只填用户没手动改过的字段（见 TaskForm 的 touched 记录）。编辑已有任务不调用。规则写死在这里，不做成可改的设置。
 *
 * | 分类 | 二级类型 | 任务类型 | 未完成处理 |
 * | 学校作业 | 任一学科，标题默认"X家庭作业" | 所选日期周一至周四：单日；周五：时段（周五至周日）；周六日：单日 | 顺延至次日 |
 * | 课外班作业 | 语文"大增语文课后作业"、数学"奥数班作业"、英语"FCE作业"（都是标题） | 时段 | 顺延至次日 |
 * | 课外班上课 | — | 单日，上课时间从课程库带出 | 到期结束 |
 * | 兴趣班上课 | 钢琴课 / 游泳课 / 轮滑课 / 勾了"算作上课"的自定义项 | 单日 | 到期结束 |
 * | 兴趣班 | 钢琴练习 | 每周几次（现有默认：每周 3 次） | 不适用 |
 * | 其他安排 | 其他（提醒） | 单日 | 顺延至次日 |
 * | 其他安排 | 考试或比赛、休闲 | 单日 | 到期结束 |
 * | 其他安排 | 旅游 | 时段 | 到期结束 |
 *
 * 课外班作业的截止日：课程库里这门课（同学科、进行中、算作上课）有固定上课星期的，截止到所选日期之后下一次上课的
 * 前一天（周六上课、周六录的作业截止到下周五）；没有固定上课星期的，所选日期加 6 天。
 * "大增 / 奥数班 / FCE 作业"在现有结构里是任务标题（courseHomeworkTitle），不是二级类型或课程，这里不新增两者。
 */
import { addDays, getDay } from "date-fns";
import type { Course, ExtraContentType, MainCategory, RolloverMode, TaskDraft, TaskTimeType, WeeklyQuota } from "../types/task";
import { fromDateKey, toDateKey } from "./date";
import { isCourseTask } from "./taskMeta";

/** 每周几次的现有默认（每周 3 次）；钢琴练习新建时沿用，不改动 */
export const WEEKLY_TIMES_DEFAULT: WeeklyQuota = { enabled: true, targetCount: 3, unit: "次", isWeeklyRecurring: true, allowAutoDistribute: false, allowRollover: false };

export interface TaskDefaults {
  timeType?: TaskTimeType;
  /** 单日用 */
  date?: string;
  /** 时段 / 每周几次用 */
  startDate?: string;
  endDate?: string;
  rolloverMode?: RolloverMode;
  allowRollover?: boolean;
  /** 上课时间（从课程库带出） */
  startTime?: string;
  endTime?: string;
  weeklyQuota?: WeeklyQuota;
}

export interface TaskDefaultsOptions {
  extraContentType?: ExtraContentType;
  /** 课程库（新建表单里读到的全部课程） */
  courses?: Course[];
  /** 用户在"从课程带出"里选中的课程 */
  course?: Course;
}

const ROLLOVER = {
  next: { rolloverMode: "autoNextDay" as const, allowRollover: true },
  end: { rolloverMode: "skipIfMissed" as const, allowRollover: false },
  overdue: { rolloverMode: "keepOverdue" as const, allowRollover: false },
};

const single = (date: string) => ({ timeType: "singleDate" as const, date });
const range = (startDate: string, endDate: string) => ({ timeType: "dateRange" as const, startDate, endDate });
const plusDays = (date: string, days: number) => toDateKey(addDays(fromDateKey(date), days));

/** 同学科、进行中、在所选日期有效的上课课程（课程库） */
function classCoursesFor(subCategory: string, date: string, courses: Course[] = []): Course[] {
  return courses.filter((course) => course.mainCategory === "extraHomework" && course.subCategory === subCategory && course.isClass
    && course.status === "active" && (!course.startDate || course.startDate <= date) && (!course.endDate || course.endDate >= date));
}

/** 课外班作业截止日：所选日期之后下一次上课的前一天；没有固定上课星期时加 6 天 */
export function courseHomeworkDeadline(date: string, weekdays: number[] | undefined): string {
  if (weekdays?.length) {
    for (let offset = 1; offset <= 7; offset += 1) {
      if (weekdays.includes(getDay(fromDateKey(plusDays(date, offset))))) return plusDays(date, offset - 1);
    }
  }
  return plusDays(date, 6);
}

export function getTaskDefaults(mainCategory: MainCategory, subCategory: string, date: string, options: TaskDefaultsOptions = {}): TaskDefaults {
  const { extraContentType, courses, course } = options;
  if (mainCategory === "school") {
    // 周一到周四、周五按任务所选日期判断，不按录入当天
    const weekday = getDay(fromDateKey(date));
    return { ...(weekday === 5 ? range(date, plusDays(date, 2)) : single(date)), ...ROLLOVER.next };
  }
  if (mainCategory === "extraHomework") {
    if (!subCategory) return {};
    if (extraContentType === "class") {
      const source = course ?? classCoursesFor(subCategory, date, courses).find((item) => item.schedule?.startTime);
      return { ...single(date), ...ROLLOVER.end, startTime: source?.schedule?.startTime, endTime: source?.schedule?.endTime };
    }
    if (subCategory === "reading") return { ...single(date), ...ROLLOVER.next };
    const weekdays = course?.schedule?.weekdays?.length ? course.schedule.weekdays
      : [...new Set(classCoursesFor(subCategory, date, courses).flatMap((item) => item.schedule?.weekdays ?? []))];
    return { ...range(date, courseHomeworkDeadline(date, weekdays)), ...ROLLOVER.next };
  }
  if (mainCategory === "interestClass") {
    if (!subCategory) return {};
    if (subCategory === "pianoPractice") return { timeType: "weeklyTimes", startDate: date, endDate: undefined, weeklyQuota: WEEKLY_TIMES_DEFAULT };
    if (isCourseTask({ mainCategory, subCategory, extraContentType })) {
      return { ...single(date), ...ROLLOVER.end, startTime: course?.schedule?.startTime, endTime: course?.schedule?.endTime };
    }
    return { ...single(date), ...ROLLOVER.overdue };
  }
  if (mainCategory === "temporary") {
    if (!subCategory) return {};
    if (subCategory === "travel") return { ...range(date, date), ...ROLLOVER.end };
    if (subCategory === "examCompetition" || subCategory === "leisure") return { ...single(date), ...ROLLOVER.end };
    return { ...single(date), ...ROLLOVER.next };
  }
  return {};
}

/** 用户在表单里手动改过的字段：之后再切换分类 / 二级类型 / 日期，默认值不覆盖它们 */
export type TouchedField = "timeType" | "endDate" | "rollover" | "time";

/**
 * 把默认值合进表单草稿：只改没被手动改过的字段。
 * - timeType 没改过：按默认换安排方式和日期（单日填 date；时段填开始 / 截止，截止日手动改过且不早于开始就保留；每周几次从所选日期开始）。
 * - rollover 没改过：换未完成处理。time 没改过：换上课时间（没有就清空）。
 */
export function mergeTaskDefaults(current: TaskDraft, defaults: TaskDefaults, touched: ReadonlySet<TouchedField>): TaskDraft {
  const next: TaskDraft = { ...current };
  if (defaults.timeType && !touched.has("timeType")) {
    Object.assign(next, { timeType: defaults.timeType, schedulePattern: "singleDate", recurrence: undefined, specificDates: undefined, weekStart: undefined, assignmentWindow: undefined });
    if (defaults.timeType === "singleDate") Object.assign(next, { date: defaults.date, startDate: undefined, endDate: undefined });
    else if (defaults.timeType === "dateRange") Object.assign(next, { date: undefined, startDate: defaults.startDate,
      endDate: touched.has("endDate") && current.endDate && defaults.startDate && current.endDate >= defaults.startDate ? current.endDate : defaults.endDate });
    else Object.assign(next, { date: undefined, startDate: defaults.startDate, endDate: undefined });
    next.weeklyQuota = defaults.timeType === "weeklyTimes" ? current.weeklyQuota ?? defaults.weeklyQuota : undefined;
  }
  if (defaults.rolloverMode && !touched.has("rollover")) Object.assign(next, { rolloverMode: defaults.rolloverMode, allowRollover: defaults.allowRollover ?? false });
  if (!touched.has("time")) Object.assign(next, { startTime: defaults.startTime, endTime: defaults.endTime });
  return next;
}

/** 课外班作业快捷标题按钮的名字（标题本身见 taskMeta.courseHomeworkTitle） */
export const COURSE_HOMEWORK_CHIP: Record<string, string> = { chinese: "大增作业", math: "奥数班作业", english: "FCE作业" };
