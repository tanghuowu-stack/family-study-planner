/**
 * 记账记录的存取（TASK_10）。
 *
 * 孩子（iPad）和家长（Mac）会同时记账，所以不能像积分账本那样整包存进 app_settings 的一个 jsonb（整包 LWW 会互相覆盖）。
 * 每条记录是 ledger_entries 表的一行：本地 Dexie 先写（页面只读本地），云端模式下再 upsert；
 * 拉取时按 updatedAt 做 LWW 合并（cloudRepository.refreshFromCloud → fetchLedgerEntries）。删除一律软删（deletedAt）。
 *
 * 月利率等设置很少改、只有家长改，存 app_settings 的 `ledger_settings_v1`。
 */
import { db } from "./db";
import { isCloudMode } from "./repositoryProvider";
import { cloudRepository, guardedCloudWrite, notifySyncError } from "./cloudRepository";
import { loadJsonSetting, peekJsonSetting, saveJsonSetting } from "./appSettingsRepository";
import { supabase } from "../lib/supabase";
import { LEDGER_TABLE, ledgerEntryToRow } from "../lib/ledgerRows";
import { defaultLedgerSettings, type LedgerEntry, type LedgerSettings, type RateChange } from "../utils/ledger";

export async function listLedgerEntries(): Promise<LedgerEntry[]> {
  return db.ledgerEntries.toArray();
}

/** 写一条（新建、修改、软删都走这里）。本地先写；云端失败返回 false（数据已在本地，下次拉取时会补传新记录） */
export async function putLedgerEntry(entry: LedgerEntry): Promise<boolean> {
  await db.ledgerEntries.put(entry);
  const familyId = cloudRepository.getFamilyId();
  if (!isCloudMode() || !supabase || !familyId) return true;
  try {
    await guardedCloudWrite([entry.id], async () => {
      const latest = (await db.ledgerEntries.get(entry.id)) ?? entry;
      const { error } = await supabase!.from(LEDGER_TABLE).upsert(ledgerEntryToRow(latest, familyId), { onConflict: "id" });
      if (error) throw error;
    });
    return true;
  } catch (e) {
    notifySyncError("记账云端同步失败", e);
    return false;
  }
}

// ── 设置（月利率）────────────────────────────────────────────────────────────

export const LEDGER_SETTINGS_KEY = "ledger_settings_v1";

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function normalizeLedgerSettings(value: unknown): LedgerSettings {
  if (!isObject(value) || !Array.isArray(value.rates)) return defaultLedgerSettings();
  const rates = value.rates.filter((item): item is RateChange => isObject(item) && typeof item.from === "string" && /^\d{4}-\d{2}$/.test(item.from)
    && typeof item.rate === "number" && item.rate >= 0 && item.rate <= 1 && typeof item.updatedAt === "string");
  return { version: 1, rates };
}

/** 两台设备的利率记录合并：同一个起始月份取较新的 */
export function mergeLedgerSettings(local: unknown, remote: unknown): LedgerSettings {
  const byMonth = new Map<string, RateChange>();
  [...normalizeLedgerSettings(local).rates, ...normalizeLedgerSettings(remote).rates].forEach((change) => {
    const existing = byMonth.get(change.from);
    if (!existing || change.updatedAt > existing.updatedAt) byMonth.set(change.from, change);
  });
  return { version: 1, rates: [...byMonth.values()].sort((a, b) => a.from.localeCompare(b.from)) };
}

/** 本机缓存里的月利率设置（不等网络） */
export const peekLedgerSettings = (): LedgerSettings => normalizeLedgerSettings(peekJsonSetting<unknown>(LEDGER_SETTINGS_KEY));

export async function loadLedgerSettings(): Promise<LedgerSettings> {
  return normalizeLedgerSettings(await loadJsonSetting<unknown>(LEDGER_SETTINGS_KEY, mergeLedgerSettings));
}

export async function saveLedgerSettings(settings: LedgerSettings): Promise<void> {
  const merged = mergeLedgerSettings(await loadLedgerSettings(), settings);
  await saveJsonSetting(LEDGER_SETTINGS_KEY, merged, "记账设置云端同步失败");
}
