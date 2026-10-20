import { supabase } from "../lib/supabase";
import { isCloudMode } from "./repositoryProvider";
import { cloudRepository, notifySyncError } from "./cloudRepository";
import type { TaskSubjectGroup } from "../utils/taskGrouping";

const SETTINGS_KEY = "group_sort_order";

/** 通用 jsonb 设置读取：本地 localStorage 缓存 + 云端 app_settings（family_id+key 唯一） */
async function loadJsonSetting<T>(key: string, reconcile?: (cached: T | null, remote: T) => T): Promise<T | null> {
  const cacheKey = `app_settings:${key}`;
  const cached = localStorage.getItem(cacheKey);
  let cachedValue: T | null = null;
  if (cached) {
    try { cachedValue = JSON.parse(cached) as T; }
    catch { localStorage.removeItem(cacheKey); }
  }

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
      const remoteValue = data.value as T;
      // 请求发出后可能又有本机写入；不能用请求开始时的旧缓存回滚新备忘录/历史。
      const currentCache = localStorage.getItem(cacheKey);
      const currentValue = reconcile && currentCache ? JSON.parse(currentCache) as T : cachedValue;
      const value = reconcile ? reconcile(currentValue, remoteValue) : remoteValue;
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

// ── 侧栏备忘录 ───────────────────────────────────────────────────────────────

const SIDEBAR_MEMO_KEY = "sidebar_memo";
export const MEMO_HISTORY_LIMIT = 50;

export interface MemoHistoryEntry {
  id: string;
  text: string;
  completedAt: string;
}

export interface SidebarMemoSetting {
  text: string;
  updatedAt: string;
  history: MemoHistoryEntry[];
}

export function normalizeSidebarMemoSetting(value: unknown): SidebarMemoSetting {
  // 兼容可能曾手工写入的纯字符串值；正式写入统一使用带时间戳的对象，
  // 这样云端旧内容不会盖掉刚在本机输入、但暂时未成功同步的文字。
  if (typeof value === "string") return { text: value, updatedAt: "", history: [] };
  if (value && typeof value === "object") {
    const setting = value as Partial<SidebarMemoSetting>;
    return {
      text: typeof setting.text === "string" ? setting.text : "",
      updatedAt: typeof setting.updatedAt === "string" ? setting.updatedAt : "",
      history: Array.isArray(setting.history) ? setting.history
        .filter((entry): entry is MemoHistoryEntry => !!entry && typeof entry.id === "string" && !!entry.id && typeof entry.text === "string" && !!entry.text.trim() && typeof entry.completedAt === "string" && Number.isFinite(Date.parse(entry.completedAt)))
        .filter((entry, index, all) => all.findIndex((other) => other.id === entry.id) === index)
        .map(({ id, text, completedAt }) => ({ id, text, completedAt }))
        .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))
        .slice(0, MEMO_HISTORY_LIMIT) : [],
    };
  }
  return { text: "", updatedAt: "", history: [] };
}

export function latestSidebarMemoSetting(cached: unknown, remote: unknown): SidebarMemoSetting {
  const localSetting = normalizeSidebarMemoSetting(cached);
  const remoteSetting = normalizeSidebarMemoSetting(remote);
  return localSetting.updatedAt > remoteSetting.updatedAt ? localSetting : remoteSetting;
}

export async function loadSidebarMemoState(): Promise<SidebarMemoSetting> {
  const setting = await loadJsonSetting<unknown>(SIDEBAR_MEMO_KEY, latestSidebarMemoSetting);
  return normalizeSidebarMemoSetting(setting);
}

export async function loadSidebarMemo(): Promise<string> {
  return (await loadSidebarMemoState()).text;
}

let memoWriteQueue: Promise<unknown> = Promise.resolve();

function updateSidebarMemo(update: (current: SidebarMemoSetting) => SidebarMemoSetting): Promise<SidebarMemoSetting> {
  // 自动保存、归档、恢复、删除按顺序读取最新基准，单个 jsonb 写入同时保存正文和历史。
  const operation = memoWriteQueue.then(async () => {
    const current = await loadSidebarMemoState();
    const updatedAt = new Date(Math.max(Date.now(), (Date.parse(current.updatedAt) || 0) + 1)).toISOString();
    const next = normalizeSidebarMemoSetting({ ...update(current), updatedAt });
    await saveJsonSetting(SIDEBAR_MEMO_KEY, next, "备忘录云端同步失败");
    return next;
  });
  // 队列自身可以继续；原始 Promise 仍返回调用方处理失败。
  memoWriteQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function saveSidebarMemo(text: string): Promise<void> {
  await updateSidebarMemo((current) => ({ ...current, text }));
}

export function archiveSidebarMemo(text: string): Promise<SidebarMemoSetting> {
  return updateSidebarMemo((current) => {
    if (!text.trim()) return current;
    return { ...current, text: "", history: [{ id: crypto.randomUUID(), text, completedAt: new Date().toISOString() }, ...current.history] };
  });
}

export function restoreSidebarMemo(id: string): Promise<SidebarMemoSetting> {
  return updateSidebarMemo((current) => {
    const entry = current.history.find((item) => item.id === id);
    if (!entry) throw new Error("这条历史备忘已被恢复或删除，请刷新后重试");
    return { ...current, text: current.text.trim() ? `${current.text}\n\n${entry.text}` : entry.text, history: current.history.filter((item) => item.id !== id) };
  });
}

export function deleteSidebarMemoHistory(id: string): Promise<SidebarMemoSetting> {
  // 用户明确要求永久删除历史；移出同一个设置的历史数组并更新时间，跨端同步。
  return updateSidebarMemo((current) => ({ ...current, history: current.history.filter((item) => item.id !== id) }));
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
  highlights: Record<TimetableDay, boolean>;
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

function defaultCourseHighlight(section: TimetableSection, day: TimetableDay, course: string): boolean {
  const name = course.trim();
  if (day === "wednesday" && name.startsWith("俱乐部")) return true;
  if (day === "friday" && name.startsWith("走班")) return true;
  if (section === "extended" && day === "monday" && name.startsWith("英语")) return false;
  return /^(英语|劳动|美术|道法|音乐|科学)(?:[（(]|$)/.test(name);
}

function timetableSlot(id: string, section: TimetableSection, label: string, time: string, names: Record<TimetableDay, string>): TimetableSlot {
  return {
    id, section, label, time, courses: names,
    highlights: Object.fromEntries(TIMETABLE_DAYS.map((day) => [day, defaultCourseHighlight(section, day, names[day])])) as Record<TimetableDay, boolean>,
  };
}

export const DEFAULT_SCHOOL_TIMETABLE: SchoolTimetable = {
  version: 3,
  term: "五年级上学期",
  slots: [
    timetableSlot("am-1", "morning", "第一节", "08:25-09:05", courses("数学", "语文", "数学", "语文", "数学")),
    timetableSlot("am-2", "morning", "第二节", "09:35-10:15", courses("语文", "数学", "语文", "数学", "语文")),
    timetableSlot("am-3", "morning", "第三节", "10:30-11:10", courses("英语（课本）", "道法（课本）", "科学（课本）", "道法（课本）", "体健")),
    timetableSlot("am-4", "morning", "第四节", "11:30-12:10", courses("足球", "音乐（葫芦丝）", "足球", "美术", "书法")),
    timetableSlot("pm-1", "afternoon", "第一节", "14:00-14:40", courses("劳动", "科学（课本）", "信息", "英语（课本）", "队课")),
    timetableSlot("pm-2", "afternoon", "第二节", "15:00-15:40", courses("美术", "心理", "音乐（葫芦丝）", "体健", "英语（课本）")),
    timetableSlot("extended-1", "extended", "第三节", "15:55-16:35", courses("英语", "数学", "云脑班", "社团", "俱乐部")),
    timetableSlot("extended-2", "extended", "第四节", "16:50-17:30", courses("数学", "语文", "云脑班", "语文", "俱乐部")),
    timetableSlot("extended-3", "extended", "第五节", "17:30-17:55", courses("数学", "语文", "语文", "语文", "云脑班")),
  ],
};

export function cloneSchoolTimetable(value: SchoolTimetable): SchoolTimetable {
  return {
    version: 3,
    term: value.term,
    slots: value.slots.map((slot) => ({ ...slot, courses: { ...slot.courses }, highlights: { ...slot.highlights } })),
  };
}

/** 固定课节骨架，只接受可编辑的学期、时间和课程内容，避免坏设置让整行消失。 */
export function normalizeSchoolTimetable(value: SchoolTimetable | null): SchoolTimetable {
  const incomingSlots = Array.isArray(value?.slots) ? value.slots : [];
  const legacy = !value || value.version !== 3;
  const savedTerm = typeof value?.term === "string" && value.term.trim() ? value.term.trim() : DEFAULT_SCHOOL_TIMETABLE.term;
  return {
    version: 3,
    term: savedTerm === "2026-2027学年度上学期" ? DEFAULT_SCHOOL_TIMETABLE.term : savedTerm,
    slots: DEFAULT_SCHOOL_TIMETABLE.slots.map((fallback) => {
      const incoming = incomingSlots.find((slot) => slot?.id === fallback.id);
      const incomingCourses: Partial<Record<TimetableDay, unknown>> = incoming?.courses && typeof incoming.courses === "object" ? incoming.courses : {};
      const incomingHighlights: Partial<Record<TimetableDay, unknown>> = incoming?.highlights && typeof incoming.highlights === "object" ? incoming.highlights : {};
      const normalizedCourses = Object.fromEntries(TIMETABLE_DAYS.map((day) => [
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
      ])) as Record<TimetableDay, string>;
      return {
        ...fallback,
        time: legacy && (!incoming?.time || incoming.time === "15:05-16:35")
          ? fallback.time
          : typeof incoming?.time === "string" ? incoming.time : fallback.time,
        courses: normalizedCourses,
        highlights: Object.fromEntries(TIMETABLE_DAYS.map((day) => [
          day,
          typeof incomingHighlights[day] === "boolean"
            ? incomingHighlights[day]
            : defaultCourseHighlight(fallback.section, day, normalizedCourses[day]),
        ])) as Record<TimetableDay, boolean>,
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
