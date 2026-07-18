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
// 注：stats_revive_cards / stats_daily_overrides 为 2026-07-18 重构前的历史键，
// 代码不再读写（云端旧数据不清理，任其保留）。

/** 休息日列表（YYYY-MM-DD），该天打卡跳过不断卡 */
export async function loadRestDays(): Promise<string[]> {
  return (await loadJsonSetting<string[]>(REST_DAYS_KEY)) ?? [];
}

export async function saveRestDays(days: string[]): Promise<void> {
  return saveJsonSetting(REST_DAYS_KEY, [...new Set(days)].sort(), "休息日设置云端同步失败");
}
