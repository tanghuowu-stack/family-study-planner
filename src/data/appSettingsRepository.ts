import { supabase } from "../lib/supabase";
import { isCloudMode } from "./repositoryProvider";
import { cloudRepository, notifySyncError } from "./cloudRepository";
import type { TaskSubjectGroup } from "../utils/taskGrouping";

const SETTINGS_KEY = "group_sort_order";

/** 通用 jsonb 设置读取：本地 localStorage 缓存 + 云端 app_settings（family_id+key 唯一） */
async function loadJsonSetting<T>(key: string): Promise<T | null> {
  const cacheKey = `app_settings:${key}`;
  const cached = localStorage.getItem(cacheKey);
  const cachedValue: T | null = cached ? JSON.parse(cached) : null;

  if (!isCloudMode() || !supabase) return cachedValue;

  try {
    const familyId = cloudRepository.getFamilyId();
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("family_id", familyId)
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    if (data?.value != null) {
      const value = data.value as T;
      localStorage.setItem(cacheKey, JSON.stringify(value));
      return value;
    }
    return cachedValue;
  } catch (e) {
    console.error(`[appSettings] load ${key}`, e);
    return cachedValue;
  }
}

/** 通用 jsonb 设置写入：先写本地缓存，云端失败走 notifySyncError（不静默） */
async function saveJsonSetting<T>(key: string, value: T, errLabel: string): Promise<void> {
  localStorage.setItem(`app_settings:${key}`, JSON.stringify(value));
  if (!isCloudMode() || !supabase) return;
  try {
    const familyId = cloudRepository.getFamilyId();
    const { error } = await supabase.from("app_settings").upsert(
      { family_id: familyId, key, value, updated_at: new Date().toISOString() },
      { onConflict: "family_id,key" }
    );
    if (error) throw error;
  } catch (e) {
    console.error(`[appSettings] save ${key}`, e);
    notifySyncError(errLabel, e);
  }
}

export async function loadGroupSortOrder(): Promise<TaskSubjectGroup[] | null> {
  return loadJsonSetting<TaskSubjectGroup[]>(SETTINGS_KEY);
}

export async function saveGroupSortOrder(order: TaskSubjectGroup[]): Promise<void> {
  return saveJsonSetting(SETTINGS_KEY, order, "分组排序云端同步失败");
}

// ── 自定义任务分类 ─────────────────────────────────────────────────

const CUSTOM_TASK_CATEGORIES_KEY = "custom_task_categories_v1";

export interface CustomTaskCategory {
  value: string;
  label: string;
}

export type CustomTaskCategories = Partial<Record<"school" | "extraHomework" | "interestClass" | "temporary", CustomTaskCategory[]>>;

export async function loadCustomTaskCategories(): Promise<CustomTaskCategories> {
  return (await loadJsonSetting<CustomTaskCategories>(CUSTOM_TASK_CATEGORIES_KEY)) ?? {};
}

export async function saveCustomTaskCategories(value: CustomTaskCategories): Promise<void> {
  return saveJsonSetting(CUSTOM_TASK_CATEGORIES_KEY, value, "自定义任务分类同步失败");
}

// ── 统计设置（TASK_08）────────────────────────────────────────────────────────

const REST_DAYS_KEY = "stats_rest_days";
// 注：stats_revive_cards / stats_daily_overrides 为 2026-07-18 重构前的历史键，
// 代码不再读写（云端旧数据不清理，任其保留）。

/** 休息日列表（YYYY-MM-DD），该天打卡跳过不断卡 */
export async function loadRestDays(): Promise<string[]> {
  return (await loadJsonSetting<string[]>(REST_DAYS_KEY)) ?? [];
}

export async function saveRestDays(days: string[]): Promise<void> {
  return saveJsonSetting(REST_DAYS_KEY, [...new Set(days)].sort(), "休息日设置云端同步失败");
}

const HIDDEN_HABIT_CANDIDATES_KEY = "stats_hidden_habit_candidates";

/** 「管理打卡项目」里被隐藏、不再展示的任务 id 列表（如"奥数暑假班"这类肯定不打卡的） */
export async function loadHiddenHabitCandidates(): Promise<string[]> {
  return (await loadJsonSetting<string[]>(HIDDEN_HABIT_CANDIDATES_KEY)) ?? [];
}

export async function saveHiddenHabitCandidates(ids: string[]): Promise<void> {
  return saveJsonSetting(HIDDEN_HABIT_CANDIDATES_KEY, [...new Set(ids)], "打卡候选设置云端同步失败");
}

// ── 课表设置 ─────────────────────────────────────────────────────────────────

const SCHOOL_TIMETABLE_KEY = "school_timetable_v1";

export const TIMETABLE_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;
export type TimetableDay = (typeof TIMETABLE_DAYS)[number];
export type TimetableSection = "morning" | "afternoon" | "extended";

export interface TimetableSlot {
  id: string;
  section: TimetableSection;
  label: string;
  time: string;
  courses: Record<TimetableDay, string>;
}

export interface SchoolTimetable {
  version: 3;
  term: string;
  slots: TimetableSlot[];
}

const courses = (monday: string, tuesday: string, wednesday: string, thursday: string, friday: string): Record<TimetableDay, string> => ({
  monday,
  tuesday,
  wednesday,
  thursday,
  friday,
});

export const DEFAULT_SCHOOL_TIMETABLE: SchoolTimetable = {
  version: 3,
  term: "2026-2027学年度上学期",
  slots: [
    { id: "am-1", section: "morning", label: "第一节", time: "08:25-09:05", courses: courses("数学", "语文", "数学", "语文", "数学") },
    { id: "am-2", section: "morning", label: "第二节", time: "09:35-10:15", courses: courses("语文", "数学", "语文", "数学", "语文") },
    { id: "am-3", section: "morning", label: "第三节", time: "10:30-11:10", courses: courses("英语（课本）", "道法（课本）", "科学（课本）", "道法（课本）", "体健") },
    { id: "am-4", section: "morning", label: "第四节", time: "11:30-12:10", courses: courses("足球", "音乐（葫芦丝）", "足球", "美术", "书法") },
    { id: "pm-1", section: "afternoon", label: "第一节", time: "14:00-14:40", courses: courses("劳动", "科学（课本）", "信息", "英语（课本）", "队课") },
    { id: "pm-2", section: "afternoon", label: "第二节", time: "15:00-15:40", courses: courses("美术", "心理", "音乐（葫芦丝）", "体健", "英语（课本）") },
    { id: "extended-1", section: "extended", label: "第三节", time: "15:55-16:35", courses: courses("英语", "数学", "云脑班", "社团", "俱乐部") },
    { id: "extended-2", section: "extended", label: "第四节", time: "16:50-17:30", courses: courses("数学", "语文", "云脑班", "语文", "俱乐部") },
    { id: "extended-3", section: "extended", label: "第五节", time: "17:30-17:55", courses: courses("数学", "语文", "语文", "语文", "云脑班") },
  ],
};

export function cloneSchoolTimetable(value: SchoolTimetable): SchoolTimetable {
  return {
    version: 3,
    term: value.term,
    slots: value.slots.map((slot) => ({ ...slot, courses: { ...slot.courses } })),
  };
}

/** 固定课节骨架，只接受可编辑的学期、时间和课程内容，避免坏设置让整行消失。 */
export function normalizeSchoolTimetable(value: SchoolTimetable | null): SchoolTimetable {
  const incomingSlots = Array.isArray(value?.slots) ? value.slots : [];
  const legacy = !value || value.version !== 3;
  return {
    version: 3,
    term: typeof value?.term === "string" && value.term.trim() ? value.term.trim() : DEFAULT_SCHOOL_TIMETABLE.term,
    slots: DEFAULT_SCHOOL_TIMETABLE.slots.map((fallback) => {
      const incoming = incomingSlots.find((slot) => slot?.id === fallback.id);
      const incomingCourses: Partial<Record<TimetableDay, unknown>> = incoming?.courses && typeof incoming.courses === "object" ? incoming.courses : {};
      return {
        ...fallback,
        time: legacy && (!incoming?.time || incoming.time === "15:05-16:35")
          ? fallback.time
          : typeof incoming?.time === "string" ? incoming.time : fallback.time,
        courses: Object.fromEntries(TIMETABLE_DAYS.map((day) => [
          day,
          legacy && (
            (day === "wednesday" && ["extended-1", "extended-2"].includes(fallback.id) && incomingCourses[day] === "俱乐部")
            || (day === "friday" && fallback.id === "extended-3" && incomingCourses[day] === "看班")
          )
            ? fallback.courses[day]
            : typeof incomingCourses[day] === "string"
              ? legacy && fallback.section !== "extended"
                ? decorateCourseName(incomingCourses[day] as string)
                : incomingCourses[day]
              : fallback.courses[day],
        ])) as Record<TimetableDay, string>,
      };
    }),
  };
}

function decorateCourseName(value: string): string {
  if (value === "音乐") return "音乐（葫芦丝）";
  if (["科学", "英语", "道法"].includes(value)) return `${value}（课本）`;
  return value;
}

export async function loadSchoolTimetable(): Promise<SchoolTimetable> {
  return normalizeSchoolTimetable(await loadJsonSetting<SchoolTimetable>(SCHOOL_TIMETABLE_KEY));
}

export async function saveSchoolTimetable(value: SchoolTimetable): Promise<void> {
  return saveJsonSetting(SCHOOL_TIMETABLE_KEY, normalizeSchoolTimetable(value), "课表云端同步失败");
}
