import { loadJsonSetting, saveJsonSetting } from "./appSettingsRepository";

/**
 * "明天要带"的手动补充 / 删掉（2026-11-25 用户：后面加一个笔图标，万一要补充或删除）。
 * 按日期存（那一天要带的），只改那一天；课表上的高亮不动。存在 app_settings（两台设备同步），
 * 只留最近 30 天的，旧的自动清掉。
 */
export interface CarryOverride { added: string[]; removed: string[]; updatedAt: string }
export type CarryOverrides = Record<string, CarryOverride>;
export const CARRY_OVERRIDES_KEY = "carry_overrides_v1";

export async function loadCarryOverrides(): Promise<CarryOverrides> {
  return (await loadJsonSetting<CarryOverrides>(CARRY_OVERRIDES_KEY)) ?? {};
}

export async function saveCarryOverride(date: string, override: Omit<CarryOverride, "updatedAt"> | null, today: string): Promise<CarryOverrides> {
  const current = await loadCarryOverrides();
  const cutoff = new Date(`${today}T00:00:00`);
  cutoff.setDate(cutoff.getDate() - 30);
  const keep = Object.fromEntries(Object.entries(current).filter(([key]) => key >= cutoff.toISOString().slice(0, 10) && key !== date));
  const next: CarryOverrides = override && (override.added.length || override.removed.length)
    ? { ...keep, [date]: { added: override.added, removed: override.removed, updatedAt: new Date().toISOString() } }
    : keep;
  await saveJsonSetting(CARRY_OVERRIDES_KEY, next, "明天要带云端同步失败");
  return next;
}
