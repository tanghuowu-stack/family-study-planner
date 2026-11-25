/**
 * 积分账本（2026-11-24）：家长奖励、提前完成作业的处理结果、已庆祝记录、每周结算快照（含固定下来的零花钱），
 * 全部存在 app_settings 的一个 jsonb 键里（复用现有读写和云端同步，不改数据库结构）。
 * 分数本身不存，由完成记录算出（utils/points.ts）。零花钱的记账在单独的 ledger_entries 表（TASK_10）。
 *
 * 跨设备合并：每条记录只增不删（撤回 = revokedAt），读取时本机缓存和云端按 id 取并集，
 * 同一条取 updatedAt 较新的；已庆祝取并集；快照同一周保留最早结算的那份。
 * 这样 iPad 刚记下"已庆祝"、Mac 同时加了一笔奖励，两边都不会被对方的整包写入盖掉。
 *
 * 已取消的小红花 / 愿望（wishes）：代码不再读写它们的内容，但整包写回时原样带上（legacy），不删云端已有的数据。
 */
import { loadJsonSetting, saveJsonSetting } from "./appSettingsRepository";
import { emptyLedger, type BonusEntry, type EarlyDecision, type PointsLedger, type WeekSnapshot } from "../utils/points";

export const POINTS_LEDGER_KEY = "points_ledger_v1";

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const newer = <T extends { updatedAt: string }>(a: T, b: T) => (b.updatedAt > a.updatedAt ? b : a);

const KNOWN_KEYS = new Set(["version", "bonuses", "earlyDecisions", "celebrated", "snapshots", "legacy"]);

/** 不认识的旧字段（例如 wishes）原样收进 legacy */
function legacyOf(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const legacy: Record<string, unknown> = isObject(value.legacy) ? { ...value.legacy } : {};
  Object.entries(value).forEach(([key, item]) => { if (!KNOWN_KEYS.has(key)) legacy[key] = item; });
  return Object.keys(legacy).length ? legacy : undefined;
}

export function normalizeLedger(value: unknown): PointsLedger {
  if (!isObject(value)) return emptyLedger();
  const list = <T,>(raw: unknown, ok: (item: Record<string, unknown>) => boolean) => (Array.isArray(raw) ? raw.filter((item): item is T => isObject(item) && ok(item)) : []);
  const record = <T,>(raw: unknown, ok: (item: Record<string, unknown>) => boolean) => (isObject(raw) ? Object.fromEntries(Object.entries(raw).filter(([, item]) => isObject(item) && ok(item))) as Record<string, T> : {});
  return {
    version: 1,
    bonuses: list<BonusEntry>(value.bonuses, (b) => typeof b.id === "string" && typeof b.points === "number" && typeof b.date === "string" && typeof b.updatedAt === "string"),
    earlyDecisions: record<EarlyDecision>(value.earlyDecisions, (d) => (d.decision === "award" || d.decision === "skip") && typeof d.updatedAt === "string"),
    celebrated: isObject(value.celebrated) ? Object.fromEntries(Object.entries(value.celebrated).filter(([, at]) => typeof at === "string")) as Record<string, string> : {},
    snapshots: record<WeekSnapshot>(value.snapshots, (s) => typeof s.weekStart === "string" && Array.isArray(s.items)),
    ...(legacyOf(value) ? { legacy: legacyOf(value) } : {}),
  };
}

/** 写回 app_settings 的样子：旧字段放回原来的位置（顶层），和取消前写进去的数据保持一致 */
export function serializeLedger(ledger: PointsLedger): Record<string, unknown> {
  const { legacy, ...known } = ledger;
  return { ...(legacy ?? {}), ...known };
}

function mergeById<T extends { id: string; updatedAt: string }>(a: T[], b: T[]): T[] {
  const map = new Map<string, T>();
  [...a, ...b].forEach((item) => { const existing = map.get(item.id); map.set(item.id, existing ? newer(existing, item) : item); });
  return [...map.values()];
}

/** 本机缓存与云端合并（见文件头） */
export function mergeLedgers(localValue: unknown, remoteValue: unknown): PointsLedger {
  const local = normalizeLedger(localValue);
  const remote = normalizeLedger(remoteValue);
  const decisions: Record<string, EarlyDecision> = { ...local.earlyDecisions };
  Object.entries(remote.earlyDecisions).forEach(([key, decision]) => { decisions[key] = decisions[key] ? newer(decisions[key], decision) : decision; });
  const celebrated: Record<string, string> = { ...remote.celebrated };
  Object.entries(local.celebrated).forEach(([key, at]) => { celebrated[key] = celebrated[key] && celebrated[key] < at ? celebrated[key] : at; });
  const snapshots: Record<string, WeekSnapshot> = { ...remote.snapshots };
  Object.entries(local.snapshots).forEach(([week, snapshot]) => { if (!snapshots[week] || snapshot.settledAt < snapshots[week].settledAt) snapshots[week] = snapshot; });
  const legacy = remote.legacy ?? local.legacy;
  return { version: 1, bonuses: mergeById(local.bonuses, remote.bonuses), earlyDecisions: decisions, celebrated, snapshots, ...(legacy ? { legacy } : {}) };
}

export async function loadPointsLedger(): Promise<PointsLedger> {
  return normalizeLedger(await loadJsonSetting<unknown>(POINTS_LEDGER_KEY, (local, remote) => serializeLedger(mergeLedgers(local, remote))));
}

let writeQueue: Promise<unknown> = Promise.resolve();

/** 读最新（含云端合并）→ 改 → 写，按顺序排队，避免本机两次写入互相覆盖 */
export function updatePointsLedger(update: (current: PointsLedger) => PointsLedger): Promise<PointsLedger> {
  const operation = writeQueue.then(async () => {
    const current = await loadPointsLedger();
    const next = normalizeLedger(update(current));
    await saveJsonSetting(POINTS_LEDGER_KEY, serializeLedger(next), "积分记录云端同步失败");
    return next;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}
