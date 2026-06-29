import { supabase } from "../lib/supabase";
import { isCloudMode } from "./repositoryProvider";
import { cloudRepository } from "./cloudRepository";
import type { TaskSubjectGroup } from "../utils/taskGrouping";

const SETTINGS_KEY = "group_sort_order";
const LOCAL_CACHE_KEY = "app_settings:group_sort_order";

export async function loadGroupSortOrder(): Promise<TaskSubjectGroup[] | null> {
  const cached = localStorage.getItem(LOCAL_CACHE_KEY);
  const cachedValue: TaskSubjectGroup[] | null = cached ? JSON.parse(cached) : null;

  if (!isCloudMode() || !supabase) return cachedValue;

  try {
    const familyId = cloudRepository.getFamilyId();
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("family_id", familyId)
      .eq("key", SETTINGS_KEY)
      .maybeSingle();
    if (error) throw error;
    if (data?.value) {
      const order = data.value as TaskSubjectGroup[];
      localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(order));
      return order;
    }
    return cachedValue;
  } catch (e) {
    console.error("[appSettings] loadGroupSortOrder", e);
    return cachedValue;
  }
}

export async function saveGroupSortOrder(order: TaskSubjectGroup[]): Promise<void> {
  localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(order));
  if (!isCloudMode() || !supabase) return;
  try {
    const familyId = cloudRepository.getFamilyId();
    await supabase.from("app_settings").upsert(
      { family_id: familyId, key: SETTINGS_KEY, value: order, updated_at: new Date().toISOString() },
      { onConflict: "family_id,key" }
    );
  } catch (e) {
    console.error("[appSettings] saveGroupSortOrder", e);
  }
}
