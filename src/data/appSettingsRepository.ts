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

// ── 统计设置（TASK_08）────────────────────────────────────────────────────────

const REST_DAYS_KEY = "stats_rest_days";
const REVIVE_CARDS_KEY = "stats_revive_cards";

export interface ReviveCards {
  balance: number;
  usedDates: string[];
  /** 已发过卡的里程碑日期（连续第 7/14/21… 天的那一天），保证发卡幂等 */
  grantedMilestones?: string[];
}

/** 休息日列表（YYYY-MM-DD），该天打卡跳过不断卡 */
export async function loadRestDays(): Promise<string[]> {
  return (await loadJsonSetting<string[]>(REST_DAYS_KEY)) ?? [];
}

export async function saveRestDays(days: string[]): Promise<void> {
  return saveJsonSetting(REST_DAYS_KEY, [...new Set(days)].sort(), "休息日设置云端同步失败");
}

export async function loadReviveCards(): Promise<ReviveCards> {
  return (await loadJsonSetting<ReviveCards>(REVIVE_CARDS_KEY)) ?? { balance: 0, usedDates: [] };
}

export async function saveReviveCards(cards: ReviveCards): Promise<void> {
  return saveJsonSetting(REVIVE_CARDS_KEY, cards, "复活卡数据云端同步失败");
}

const DAILY_OVERRIDES_KEY = "stats_daily_overrides";

export interface DailyCheckOverride {
  added: string[];
  removed: string[];
}

/**
 * 每日打卡项手动覆盖，按日期键整包存一个 jsonb：
 * { "YYYY-MM-DD": { added: taskId[], removed: taskId[] } }。
 * 选整包而非每日一行：覆盖是低频例外操作、数据量小（一年几十个键），
 * 整存整取直接复用 loadJsonSetting 泛型与 (family_id,key) 唯一约束，
 * 免去按日期范围查询和逐行清理；无该日键 = 该日完全走默认口径。
 */
export type DailyOverrides = Record<string, DailyCheckOverride>;

export async function loadDailyOverrides(): Promise<DailyOverrides> {
  return (await loadJsonSetting<DailyOverrides>(DAILY_OVERRIDES_KEY)) ?? {};
}

export async function saveDailyOverrides(overrides: DailyOverrides): Promise<void> {
  return saveJsonSetting(DAILY_OVERRIDES_KEY, overrides, "打卡项设置云端同步失败");
}
