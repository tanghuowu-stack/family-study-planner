/**
 * 记账的读取和操作（TASK_10）。规则与纯计算在 utils/ledger.ts，存取在 data/ledgerRepository.ts。
 *
 * 家长判断沿用 docs/TASK_09_points.md §7：非触摸设备（Mac）= 家长。每个操作都可以传 parent 覆盖（测试用），
 * 默认按当前设备判断；界面上不给孩子看的按钮，这里也再拦一道。
 */
import { listLedgerEntries, loadLedgerSettings, peekLedgerSettings, putLedgerEntry, saveLedgerSettings } from "./ledgerRepository";
import { loadPointsLedger, peekPointsLedger } from "./pointsLedger";
import { getWeekStartKey, todayKey } from "../utils/date";
import { isParentDevice } from "../utils/device";
import { activeBonuses, allowanceFor, POINTS_START_WEEK, type PointsLedger } from "../utils/points";
import {
  balancesOf, canModifyEntry, monthOf, monthSummary, pendingTransfers, projectedInterest, validateEntry, withRateChange,
  type Balances, type EntryInput, type LedgerAccount, type LedgerEntry, type LedgerSettings, type MonthSummary, type PendingTransfer,
} from "../utils/ledger";

export interface LedgerContext {
  today: string;
  /** 全部记录（含软删的），列表显示用 activeEntries */
  entries: LedgerEntry[];
  balances: Balances;
  settings: LedgerSettings;
  pending: PendingTransfer[];
  month: MonthSummary;
  /** 这个月不取钱的话，下月 1 日能拿到的利息；12 月之前为 null */
  projected: ReturnType<typeof projectedInterest>;
}

/** 已结算周的零花钱（分）：取结算快照里固定的金额（快照之后的补勾、撤回奖励都不影响） */
export function settledAllowances(points: PointsLedger): { weekStart: string; allowanceCents: number }[] {
  return Object.values(points.snapshots).filter((snapshot) => snapshot.weekStart >= POINTS_START_WEEK).map((snapshot) => {
    // 早期快照没有 allowance 字段时，用快照里的练习分 + 那周的家长奖励补算
    const bonus = snapshot.bonus ?? activeBonuses(points).filter((item) => getWeekStartKey(item.date) === snapshot.weekStart).reduce((sum, item) => sum + item.points, 0);
    const yuan = snapshot.allowance ?? allowanceFor(snapshot.total + bonus);
    return { weekStart: snapshot.weekStart, allowanceCents: Math.round(yuan * 100) };
  });
}

/**
 * cached = true：设置和积分账本只用本机缓存、不等云端（记账页先用它马上显示，2026-11-25）；
 * 记录本来就在本机 Dexie。之后页面再不带 cached 读一次，云端有变化就更新。
 */
export async function loadLedgerContext(today = todayKey(), cached = false): Promise<LedgerContext> {
  const [entries, settings, points] = cached
    ? [await listLedgerEntries(), peekLedgerSettings(), peekPointsLedger()]
    : await Promise.all([listLedgerEntries(), loadLedgerSettings(), loadPointsLedger()]);
  return {
    today,
    entries,
    balances: balancesOf(entries),
    settings,
    pending: pendingTransfers(entries, settledAllowances(points), settings, today),
    month: monthSummary(entries, monthOf(today)),
    projected: projectedInterest(entries, settings, today),
  };
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

interface Options { parent?: boolean; today?: string }
const resolve = (options: Options = {}) => ({ parent: options.parent ?? isParentDevice(), today: options.today ?? todayKey() });

function requireParent(parent: boolean) {
  if (!parent) throw new Error("这一项只有家长能在 Mac 上操作");
}

/** 记一笔 / 改一笔。孩子只能记今天的支出、存进存款、从存款取出，余额不够不让存 */
export async function saveLedgerEntry(input: EntryInput, options: Options & { editingId?: string } = {}): Promise<{ entry: LedgerEntry; synced: boolean }> {
  const { parent, today } = resolve(options);
  const entries = await listLedgerEntries();
  const existing = options.editingId ? entries.find((entry) => entry.id === options.editingId && !entry.deletedAt) : undefined;
  if (options.editingId && !existing) throw new Error("这条记录已经不在了");
  if (existing && !canModifyEntry(existing, parent, today)) throw new Error("只能改今天自己记的，更早的找妈妈改");
  if (existing && existing.type !== input.type && !parent) throw new Error("不能改类型");
  const error = validateEntry(input, { parent, entries, today, editingId: existing?.id });
  if (error) throw new Error(error);
  const now = new Date().toISOString();
  const entry: LedgerEntry = {
    id: existing?.id ?? newId(),
    date: input.date,
    type: input.type,
    amountCents: input.amountCents,
    account: input.type === "opening" || input.type === "adjust" ? input.account : undefined,
    content: input.content?.trim() || undefined,
    category: input.type === "expense" ? input.category : undefined,
    refKey: existing?.refKey,
    createdBy: existing?.createdBy ?? (parent ? "parent" : "child"),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  return { entry, synced: await putLedgerEntry(entry) };
}

/** 删除一律软删；孩子只能删今天自己记的 */
export async function deleteLedgerEntry(id: string, options: Options = {}): Promise<boolean> {
  const { parent, today } = resolve(options);
  const existing = (await listLedgerEntries()).find((entry) => entry.id === id && !entry.deletedAt);
  if (!existing) throw new Error("这条记录已经不在了");
  if (!canModifyEntry(existing, parent, today)) throw new Error("只能删今天自己记的，更早的找妈妈处理");
  const now = new Date().toISOString();
  return putLedgerEntry({ ...existing, deletedAt: now, updatedAt: now });
}

/** 家长点"已转账"：按最新数据确认这一项还在待转账里，入账（记录 id 固定，重复点不会多记） */
export async function confirmTransfer(transferId: string, options: Options = {}): Promise<boolean> {
  const { parent, today } = resolve(options);
  requireParent(parent);
  const context = await loadLedgerContext(today);
  const item = context.pending.find((pending) => pending.id === transferId);
  if (!item) throw new Error("这一项已经入账了");
  const now = new Date().toISOString();
  const previous = context.entries.find((entry) => entry.id === item.id);
  return putLedgerEntry({
    id: item.id,
    date: today,
    type: item.type,
    amountCents: item.amountCents,
    content: item.type === "interest" ? item.detail : item.title,
    refKey: item.refKey,
    createdBy: "parent",
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  });
}

/** 期初余额（只有家长）：零钱、存款各一条，id 固定；再设一次就是改那一条，设成 0 就删掉 */
export async function setOpeningBalances(values: Partial<Record<LedgerAccount, number>>, date: string, options: Options = {}): Promise<void> {
  const { parent } = resolve(options);
  requireParent(parent);
  const entries = await listLedgerEntries();
  const now = new Date().toISOString();
  for (const account of ["cash", "savings"] as LedgerAccount[]) {
    const cents = values[account];
    if (cents === undefined) continue;
    if (!Number.isInteger(cents) || cents < 0) throw new Error("期初余额不能是负数");
    const id = `opening-${account}`;
    const previous = entries.find((entry) => entry.id === id);
    if (cents === 0) {
      if (previous && !previous.deletedAt) await putLedgerEntry({ ...previous, deletedAt: now, updatedAt: now });
      continue;
    }
    await putLedgerEntry({ id, date, type: "opening", account, amountCents: cents, content: "期初余额", createdBy: "parent", createdAt: previous?.createdAt ?? now, updatedAt: now });
  }
}

/** 和微信对账后一键生成对账调整（只有家长，必须写原因）：差多少就调多少，零钱、存款各一条 */
export async function addReconcileAdjustments(diff: Partial<Balances>, reason: string, options: Options = {}): Promise<number> {
  const { parent, today } = resolve(options);
  requireParent(parent);
  if (!reason.trim()) throw new Error("请写上原因");
  let count = 0;
  for (const account of ["cash", "savings"] as LedgerAccount[]) {
    const cents = diff[account];
    if (!cents) continue;
    await saveLedgerEntry({ type: "adjust", date: today, account, amountCents: cents, content: reason }, { parent, today });
    count += 1;
  }
  return count;
}

/** 改月利率（只有家长）：从这个月起生效，已经过去的月份不变 */
export async function setMonthlyRate(rate: number, options: Options = {}): Promise<LedgerSettings> {
  const { parent, today } = resolve(options);
  requireParent(parent);
  if (!Number.isFinite(rate) || rate < 0 || rate > 0.5) throw new Error("月利率在 0% 到 50% 之间");
  const next = withRateChange(await loadLedgerSettings(), Math.round(rate * 10000) / 10000, today);
  await saveLedgerSettings(next);
  return next;
}
