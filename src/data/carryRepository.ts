import { loadJsonSetting, saveJsonSetting } from "./appSettingsRepository";

/**
 * "明天要带"的手动补充 / 删掉（2026-11-25 用户：后面加一个笔图标，万一要补充或删除）。
 * 同日第二次（用户）：新加的东西可以设成"常驻"（每天都提醒，排在课表那些课本后面，带一个📌角标）或"仅明天"（只提醒一次）。
 * - pinned：常驻的，每天都列；
 * - days：按日期存的那一天的补充（仅明天）/ 删掉（课表里那天的某样不用带），只留最近 30 天。
 * 存在 app_settings（两台设备同步）。旧格式（carry_overrides_v1，只有按日期的）读进来当 days。
 */
export interface CarryOverride { added: string[]; removed: string[]; updatedAt: string }
export interface CarryReminders { pinned: string[]; days: Record<string, CarryOverride>; updatedAt?: string }
export const CARRY_REMINDERS_KEY = "carry_reminders_v2";
const LEGACY_KEY = "carry_overrides_v1";

export async function loadCarryReminders(): Promise<CarryReminders> {
  const saved = await loadJsonSetting<CarryReminders>(CARRY_REMINDERS_KEY);
  if (saved && Array.isArray(saved.pinned) && saved.days && typeof saved.days === "object") return saved;
  const legacy = await loadJsonSetting<Record<string, CarryOverride>>(LEGACY_KEY);
  return { pinned: [], days: legacy ?? {} };
}

/** 保存某一天的补充 / 删掉，以及常驻的清单 */
export async function saveCarryReminders(date: string, day: { added: string[]; removed: string[] }, pinned: string[], today: string): Promise<CarryReminders> {
  const current = await loadCarryReminders();
  const cutoff = new Date(`${today}T00:00:00`);
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
  const now = new Date().toISOString();
  const days = Object.fromEntries(Object.entries(current.days).filter(([key]) => key >= cutoffKey && key !== date));
  if (day.added.length || day.removed.length) days[date] = { added: day.added, removed: day.removed, updatedAt: now };
  const next: CarryReminders = { pinned, days, updatedAt: now };
  await saveJsonSetting(CARRY_REMINDERS_KEY, next, "明天要带云端同步失败");
  return next;
}
