/**
 * 积分账本（2026-11-24）：家长奖励、提前完成作业的处理结果、愿望（含兑换）、已庆祝记录、每周结算快照，
 * 全部存在 app_settings 的一个 jsonb 键里（复用现有读写和云端同步，不改数据库结构）。
 * 分数本身不存，由完成记录算出（utils/points.ts）。
 *
 * 跨设备合并：每条记录只增不删（撤回 = revokedAt、删愿望 = deletedAt），读取时本机缓存和云端按 id 取并集，
 * 同一条取 updatedAt 较新的；已庆祝取并集；快照同一周保留最早结算的那份。
 * 这样 iPad 刚记下"已庆祝"、Mac 同时加了一笔奖励，两边都不会被对方的整包写入盖掉。
 */
import { loadJsonSetting, saveJsonSetting } from "./appSettingsRepository";
import { emptyLedger, type BonusEntry, type EarlyDecision, type PointsLedger, type Wish, type WeekSnapshot } from "../utils/points";

export const POINTS_LEDGER_KEY = "points_ledger_v1";

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const newer = <T extends { updatedAt: string }>(a: T, b: T) => (b.updatedAt > a.updatedAt ? b : a);

export function normalizeLedger(value: unknown): PointsLedger {
  if (!isObject(value)) return emptyLedger();
  const list = <T,>(raw: unknown, ok: (item: Record<string, unknown>) => boolean) => (Array.isArray(raw) ? raw.filter((item): item is T => isObject(item) && ok(item)) : []);
  const record = <T,>(raw: unknown, ok: (item: Record<string, unknown>) => boolean) => (isObject(raw) ? Object.fromEntries(Object.entries(raw).filter(([, item]) => isObject(item) && ok(item))) as Record<string, T> : {});
  return {
    version: 1,
    bonuses: list<BonusEntry>(value.bonuses, (b) => typeof b.id === "string" && typeof b.points === "number" && typeof b.date === "string" && typeof b.updatedAt === "string"),
    earlyDecisions: record<EarlyDecision>(value.earlyDecisions, (d) => (d.decision === "award" || d.decision === "skip") && typeof d.updatedAt === "string"),
    wishes: list<Wish>(value.wishes, (w) => typeof w.id === "string" && typeof w.text === "string" && typeof w.updatedAt === "string"),
    celebrated: isObject(value.celebrated) ? Object.fromEntries(Object.entries(value.celebrated).filter(([, at]) => typeof at === "string")) as Record<string, string> : {},
    snapshots: record<WeekSnapshot>(value.snapshots, (s) => typeof s.weekStart === "string" && Array.isArray(s.items)),
  };
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
  return { version: 1, bonuses: mergeById(local.bonuses, remote.bonuses), earlyDecisions: decisions, wishes: mergeById(local.wishes, remote.wishes), celebrated, snapshots };
}

export async function loadPointsLedger(): Promise<PointsLedger> {
  return normalizeLedger(await loadJsonSetting<unknown>(POINTS_LEDGER_KEY, mergeLedgers));
}

let writeQueue: Promise<unknown> = Promise.resolve();

/** 读最新（含云端合并）→ 改 → 写，按顺序排队，避免本机两次写入互相覆盖 */
export function updatePointsLedger(update: (current: PointsLedger) => PointsLedger): Promise<PointsLedger> {
  const operation = writeQueue.then(async () => {
    const current = await loadPointsLedger();
    const next = normalizeLedger(update(current));
    await saveJsonSetting(POINTS_LEDGER_KEY, next, "积分记录云端同步失败");
    return next;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

// ── 按显示名预设分值（只套一次）────────────────────────────────────────────

/**
 * 第一版（practice_points_preset_v1）按标题完全相同匹配，线上钢琴（空标题）和小白欧（标题带页码）都没套上。
 * 第二版换了键，所有设备会再套一次（见 pointsService.applyPracticePresetsOnce）。
 */
export const PRACTICE_PRESET_FLAG_KEY = "practice_points_preset_v2";

export interface PresetMatch {
  id: string;
  /** 显示名（空标题的用分类名） */
  title: string;
  /** 命中的预设项目 */
  preset: string;
  /** 套完以后任务上的分值 */
  points: number;
  extraScores: boolean;
  /** applied = 这次写进了任务；same = 本来就是这个值；kept = 家长手动设过别的值，没覆盖 */
  action: "applied" | "same" | "kept";
}

export interface PresetResult {
  appliedAt: string;
  matched: PresetMatch[];
  /** 没有任何练习命中的预设项目 */
  unmatchedPresets: string[];
  /** 没命中任何预设的练习（显示名） */
  unmatchedTasks: string[];
  /** 同时命中两项以上、没有套的练习 */
  ambiguousTasks?: string[];
}

export async function loadPresetResult(): Promise<PresetResult | null> {
  return loadJsonSetting<PresetResult>(PRACTICE_PRESET_FLAG_KEY);
}

export async function savePresetResult(result: PresetResult): Promise<void> {
  return saveJsonSetting(PRACTICE_PRESET_FLAG_KEY, result, "积分预设记录云端同步失败");
}
