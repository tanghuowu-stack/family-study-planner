import type { CourseStatus, ExtraContentType, MainCategory, RolloverMode, SchedulePattern, TaskStatus, TaskTimeType, SubCategory } from "../types/task";

/**
 * R1 完成状态权威源判定（PROJECT_GUIDE 6.5 数据层铁律）：
 * occurrence 类任务的完成状态只记 task_occurrence_statuses 表，本体 status 恒为 todo/cancelled；
 * 非 occurrence 类任务的完成状态记在本体 status/completedAt，不得产生 occurrence 记录。
 */
export const isOccurrenceSchedule = (task: { schedulePattern?: SchedulePattern; timeType: TaskTimeType }) =>
  task.timeType === "recurring";

export const SUB_CATEGORY_META: Record<SubCategory | ExtraContentType, { icon: string; color: string; bgColor: string; label: string }> = {
  chinese: { icon: "📖", color: "#C65D3B", bgColor: "#F5E6E0", label: "语文" },
  math: { icon: "🔢", color: "#4F46E5", bgColor: "#EEF2FF", label: "数学" },
  english: { icon: "🔤", color: "#7C3AED", bgColor: "#F3E8FF", label: "英语" },
  piano: { icon: "🎹", color: "#EC4899", bgColor: "#FCE7F3", label: "钢琴课" },
  swimming: { icon: "🏊", color: "#0891B2", bgColor: "#E0F2FE", label: "游泳课" },
  rollerSkating: { icon: "🛼", color: "#F59E0B", bgColor: "#FEF3C7", label: "轮滑课" },
  pianoPractice: { icon: "🎹", color: "#EC4899", bgColor: "#FCE7F3", label: "钢琴练习" },
  chineseReading: { icon: "📚", color: "#C65D3B", bgColor: "#F5E6E0", label: "中文阅读" },
  englishReading: { icon: "📖", color: "#7C3AED", bgColor: "#F3E8FF", label: "英文阅读" },
  examCompetition: { icon: "🏆", color: "#DC2626", bgColor: "#FEE2E2", label: "考试或比赛" },
  travel: { icon: "✈️", color: "#0891B2", bgColor: "#E0F2FE", label: "旅游" },
  leisure: { icon: "🎮", color: "#7C3AED", bgColor: "#F3E8FF", label: "休闲" },
  other: { icon: "📝", color: "#6B7280", bgColor: "#F3F4F6", label: "其他" },
  reading: { icon: "📚", color: "#C65D3B", bgColor: "#F5E6E0", label: "阅读" },
  class: { icon: "👨‍🏫", color: "#4F46E5", bgColor: "#EEF2FF", label: "上课" },
  homework: { icon: "📝", color: "#6B7280", bgColor: "#F3F4F6", label: "作业" },
  practice: { icon: "✏️", color: "#8B5CF6", bgColor: "#F5F3FF", label: "练习" },
  dictation: { icon: "🔤", color: "#7C3AED", bgColor: "#F3E8FF", label: "听写" },
  recitation: { icon: "🗣️", color: "#C65D3B", bgColor: "#F5E6E0", label: "背诵" },
};

export const MAIN_CATEGORY_META: Record<MainCategory, { label: string; className: string; dot: string }> = {
  school: { label: "学校作业", className: "bg-blue-50 text-blue-700", dot: "bg-blue-500" },
  extraHomework: { label: "课外", className: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  interestClass: { label: "兴趣班", className: "bg-violet-50 text-violet-700", dot: "bg-violet-500" },
  readingPlan: { label: "阅读计划", className: "bg-cyan-50 text-cyan-700", dot: "bg-cyan-500" },
  temporary: { label: "事项", className: "bg-rose-50 text-rose-700", dot: "bg-rose-500" },
};

export const SUB_CATEGORY_OPTIONS: Record<MainCategory, { value: string; label: string }[]> = {
  school: [
    { value: "chinese", label: "语文" }, { value: "math", label: "数学" },
    { value: "english", label: "英语" }, { value: "other", label: "其他" },
  ],
  extraHomework: [
    { value: "chinese", label: "语文" }, { value: "math", label: "数学" },
    { value: "english", label: "英语" }, { value: "reading", label: "阅读" },
  ],
  interestClass: [
    { value: "piano", label: "钢琴课" }, { value: "swimming", label: "游泳课" },
    { value: "rollerSkating", label: "轮滑课" }, { value: "pianoPractice", label: "钢琴练习" },
  ],
  readingPlan: [
    { value: "chineseReading", label: "中文阅读" }, { value: "englishReading", label: "英文阅读" },
  ],
  temporary: [
    { value: "examCompetition", label: "考试或比赛" }, { value: "travel", label: "旅游" },
    { value: "leisure", label: "休闲" }, { value: "other", label: "其他" },
  ],
};

// 课程库（TASK_02）：课程只挂在“课外”和“兴趣班”两类下
export const COURSE_MAIN_OPTIONS: { value: MainCategory; label: string }[] = [
  { value: "extraHomework", label: "课外（主学科）" },
  { value: "interestClass", label: "兴趣班" },
];

export const COURSE_STATUS_META: Record<CourseStatus, { label: string; className: string }> = {
  active: { label: "进行中", className: "bg-emerald-50 text-emerald-700" },
  ended: { label: "已结课", className: "bg-stone-200 text-stone-500" },
  planned: { label: "计划中", className: "bg-amber-50 text-amber-700" },
};

export const STATUS_META: Record<TaskStatus, { label: string; className: string }> = {
  todo: { label: "未开始", className: "text-stone-500 bg-stone-100" },
  doing: { label: "进行中", className: "text-amber-700 bg-amber-50" },
  done: { label: "已完成", className: "text-emerald-700 bg-emerald-50" },
  cancelled: { label: "已取消", className: "text-stone-400 bg-stone-100" },
  overdue: { label: "已逾期", className: "text-rose-700 bg-rose-50" },
};

export const TIME_TYPE_META: Record<TaskTimeType, string> = {
  singleDate: "指定一天", dateRange: "日期范围", weekGoal: "每周任务池",
  monthGoal: "每月计划", assignmentWindow: "课后作业周期", recurring: "固定重复",
};

export const ROLLOVER_META: Record<RolloverMode, string> = {
  autoNextDay: "自动顺延到下一天", keepOverdue: "保留原日期并标记逾期", skipIfMissed: "过期自动跳过",
};

export const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
export const EXTRA_CONTENT_OPTIONS: { value: ExtraContentType; label: string }[] = [
  { value: "class", label: "上课" }, { value: "homework", label: "作业" },
  { value: "practice", label: "练习" }, { value: "dictation", label: "听写" },
  { value: "recitation", label: "背诵" }, { value: "reading", label: "阅读" },
  { value: "other", label: "其他" },
];
// 课外（语文/数学/英语）下可选的内容类型——精简后只保留上课和作业
export const EXTRA_CONTENT_OPTIONS_SIMPLE: { value: ExtraContentType; label: string }[] = [
  { value: "class", label: "上课" }, { value: "homework", label: "作业" },
];
export const extraContentLabel = (value?: ExtraContentType) => EXTRA_CONTENT_OPTIONS.find((item) => item.value === value)?.label ?? "其他";

export const subCategoryLabel = (main: MainCategory, sub: string) =>
  SUB_CATEGORY_OPTIONS[main]?.find((item) => item.value === sub)?.label ?? "其他";

export const taskDisplayName = (task: { mainCategory: MainCategory; subCategory: string; title: string; extraContentType?: ExtraContentType }) => {
  const showContentType = task.mainCategory === "extraHomework" && task.subCategory !== "reading";
  const base = `${MAIN_CATEGORY_META[task.mainCategory].label}·${subCategoryLabel(task.mainCategory, task.subCategory)}${showContentType ? `｜${extraContentLabel(task.extraContentType)}` : ""}`;
  const title = task.title.trim();
  const repeatedInterestTitle = task.mainCategory === "interestClass" && title === subCategoryLabel(task.mainCategory, task.subCategory);
  return title && !repeatedInterestTitle ? `${base} - ${title}` : base;
};

export const taskShortName = (task: { mainCategory: MainCategory; subCategory: string; title: string; extraContentType?: ExtraContentType }) => {
  const title = task.title.trim();
  if (title) return title;
  if (task.mainCategory === "interestClass") return subCategoryLabel(task.mainCategory, task.subCategory);
  if (task.mainCategory === "extraHomework" && task.subCategory === "reading") return "阅读";
  return subCategoryLabel(task.mainCategory, task.subCategory);
};

export const isCourseTask = (task: { mainCategory: MainCategory; subCategory: string; extraContentType?: ExtraContentType }) =>
  (task.mainCategory === "extraHomework" && task.extraContentType === "class")
  || (task.mainCategory === "interestClass" && ["piano", "swimming", "rollerSkating"].includes(task.subCategory));

const SORT_KEYS = [
  "school:chinese", "school:math", "school:english", "school:other",
  "extraHomework:chinese", "extraHomework:math", "extraHomework:english", "extraHomework:reading",
  "readingPlan:chineseReading", "readingPlan:englishReading", "interestClass:pianoPractice",
  "interestClass:piano", "interestClass:swimming", "interestClass:rollerSkating",
  "temporary:examCompetition", "temporary:travel", "temporary:leisure", "temporary:other",
];

export const defaultSortOrder = (main: MainCategory, sub: string) => {
  const index = SORT_KEYS.indexOf(`${main}:${sub}`);
  return index < 0 ? 999 : index;
};

/** 任务本身完成状态的未同步标记 key（区分同一个重复任务的不同天） */
export const taskSyncKey = (task: { id: string; occurrenceDate?: string }) => `${task.id}:${task.occurrenceDate ?? ""}`;
/** 清单小项的未同步标记 key */
export const itemSyncKey = (taskId: string, itemId: string) => `${taskId}#${itemId}`;
