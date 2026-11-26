/**
 * 记账（零花钱）规则的纯函数（2026-11-24）。规则唯一依据：docs/TASK_10_ledger.md。
 *
 * - 金额一律用"分"（整数）计算和存储，界面显示成元、两位小数，避免小数误差。
 * - 两个账户：零钱 cash（可以自由花，对应微信钱包零钱）、存款 savings（对应微信零钱通）。
 * - 余额不存，由记录算出（R1 思路）：每条记录对两个账户各有一个变化量，见 entryEffect。
 * - 练习奖励：家长在 Mac 上点"兑现本周积分"、填几分就记一条（id 随机），金额从待兑现积分里扣（utils/points.ts
 *   pendingRedeemPoints，2026-11-26 起；原来每周结算后"待转账"已取消）。
 * - 利息仍是"待转账"：由存款记录算出来，家长在 Mac 上点"已转账"才生成一条记录入账。记录 id 固定（interest-月份），
 *   两台设备同时点也只会有一条。
 */
import { addDays, addMonths, format } from "date-fns";
import { fromDateKey, toDateKey, toLocalDateKey } from "./date";

export type LedgerType = "allowance" | "expense" | "deposit" | "withdraw" | "interest" | "opening" | "adjust";
export type LedgerAccount = "cash" | "savings";
export type LedgerActor = "child" | "parent";

export const EXPENSE_CATEGORIES = ["吃的", "文具", "书", "玩具", "礼物", "其他"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface LedgerEntry {
  id: string;
  /** 记在哪天（YYYY-MM-DD） */
  date: string;
  type: LedgerType;
  /** 期初余额、对账调整：调哪个账户；其他类型由 type 决定，不填 */
  account?: LedgerAccount;
  /** 金额（分）。对账调整可正可负，其余都是正数 */
  amountCents: number;
  /** 内容：支出必填（"买文具"）；对账调整写原因；利息写算法 */
  content?: string;
  /** 支出必选 */
  category?: ExpenseCategory;
  /** 练习奖励：那周的周一；利息：哪个月（YYYY-MM） */
  refKey?: string;
  /** 谁记的：触摸设备 = 孩子，Mac = 家长（docs/TASK_09_points.md §7 的判断） */
  createdBy: LedgerActor;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export const LEDGER_TYPE_LABEL: Record<LedgerType, string> = {
  allowance: "练习奖励",
  expense: "支出",
  deposit: "存进存款",
  withdraw: "从存款取出",
  interest: "利息",
  opening: "期初余额",
  adjust: "对账调整",
};

export const ACCOUNT_LABEL: Record<LedgerAccount, string> = { cash: "零钱", savings: "存款" };

/** 孩子能记的类型（家长也能记）；其余只有家长，或者只由"已转账"生成 */
export const CHILD_TYPES: LedgerType[] = ["expense", "deposit", "withdraw"];

/** 利息从 2026 年 12 月开始算：2027-01-01 生成 12 月的利息，11 月不计息 */
export const INTEREST_START_MONTH = "2026-12";
export const DEFAULT_MONTHLY_RATE = 0.05;
/** 单笔上限 10 万元，防手滑多打几个 0 */
export const MAX_AMOUNT_CENTS = 10_000_000;

// ── 金额 ──────────────────────────────────────────────────────────────────

/** "12" / "12.5" / "12.50" → 1250；不是合法金额（空、负数、超过两位小数）返回 null */
export function parseYuan(text: string): number | null {
  const value = text.trim().replace(/[，,]/g, "").replace(/^¥/, "");
  if (!/^\d+(\.\d{0,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** 1250 → "12.50"；负数带"−" */
export function formatYuan(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

/** 算式里用的短写法：10000 → "100"，550 → "5.5"，1255 → "12.55" */
export function formatYuanShort(cents: number): string {
  return formatYuan(cents).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

/** 0.05 → "5%"，0.035 → "3.5%" */
export const formatRate = (rate: number) => `${Number((rate * 100).toFixed(2))}%`;

// ── 余额 ──────────────────────────────────────────────────────────────────

export interface Balances { cash: number; savings: number }

export const activeEntries = (entries: LedgerEntry[]) => entries.filter((entry) => !entry.deletedAt);

/** 一条记录让两个账户各变多少（分） */
export function entryEffect(entry: Pick<LedgerEntry, "type" | "account" | "amountCents">): Balances {
  const amount = entry.amountCents;
  switch (entry.type) {
    case "allowance": return { cash: amount, savings: 0 };
    case "expense": return { cash: -amount, savings: 0 };
    case "deposit": return { cash: -amount, savings: amount };
    case "withdraw": return { cash: amount, savings: -amount };
    case "interest": return { cash: 0, savings: amount };
    case "opening":
    case "adjust": return entry.account === "savings" ? { cash: 0, savings: amount } : { cash: amount, savings: 0 };
  }
}

/** 余额；给了 untilDate 就只算这天（含）以前的记录。删掉的不算 */
export function balancesOf(entries: LedgerEntry[], untilDate?: string): Balances {
  return activeEntries(entries).reduce((sum, entry) => {
    if (untilDate && entry.date > untilDate) return sum;
    const effect = entryEffect(entry);
    return { cash: sum.cash + effect.cash, savings: sum.savings + effect.savings };
  }, { cash: 0, savings: 0 });
}

// ── 本月小结 ────────────────────────────────────────────────────────────────

export const monthOf = (date: string) => date.slice(0, 7);
export const monthLabel = (month: string) => `${Number(month.slice(5, 7))}月`;
export const nextMonth = (month: string) => format(addMonths(fromDateKey(`${month}-01`), 1), "yyyy-MM");

export interface MonthSummary {
  month: string;
  /** 收入 = 练习奖励 + 利息（存取款是自己账户之间挪，期初和对账调整不算收入支出） */
  incomeCents: number;
  expenseCents: number;
  byCategory: { category: ExpenseCategory; cents: number }[];
}

export function monthSummary(entries: LedgerEntry[], month: string): MonthSummary {
  const inMonth = activeEntries(entries).filter((entry) => monthOf(entry.date) === month);
  const income = inMonth.filter((entry) => entry.type === "allowance" || entry.type === "interest").reduce((sum, entry) => sum + entry.amountCents, 0);
  const expenses = inMonth.filter((entry) => entry.type === "expense");
  const byCategory = EXPENSE_CATEGORIES.map((category) => ({
    category,
    cents: expenses.filter((entry) => (entry.category ?? "其他") === category).reduce((sum, entry) => sum + entry.amountCents, 0),
  })).filter((item) => item.cents > 0).sort((a, b) => b.cents - a.cents);
  return { month, incomeCents: income, expenseCents: expenses.reduce((sum, entry) => sum + entry.amountCents, 0), byCategory };
}

// ── 利息 ──────────────────────────────────────────────────────────────────

/** 月利率的修改记录：from 起（含）用这个利率。只影响 from 以后计算的月份 */
export interface RateChange { from: string; rate: number; updatedAt: string }
export interface LedgerSettings { version: 1; rates: RateChange[] }
export const defaultLedgerSettings = (): LedgerSettings => ({ version: 1, rates: [] });

export function rateForMonth(settings: LedgerSettings, month: string): number {
  const applicable = settings.rates.filter((change) => change.from <= month)
    .sort((a, b) => a.from.localeCompare(b.from) || a.updatedAt.localeCompare(b.updatedAt));
  return applicable.length ? applicable[applicable.length - 1].rate : DEFAULT_MONTHLY_RATE;
}

/**
 * 改利率：从"今天所在的月份"起生效（早于 12 月的按 12 月）。这个月的利息下月 1 日才算，所以会用新利率；
 * 已经过去的月份（利息在 1 日已经算出来了，不管转没转账）不受影响。
 */
export function withRateChange(settings: LedgerSettings, rate: number, today: string, now = new Date().toISOString()): LedgerSettings {
  const month = monthOf(today) < INTEREST_START_MONTH ? INTEREST_START_MONTH : monthOf(today);
  return { version: 1, rates: [...settings.rates.filter((change) => change.from !== month), { from: month, rate, updatedAt: now }] };
}

const daysOfMonth = (month: string, untilDate?: string) => {
  const days: string[] = [];
  let cursor = `${month}-01`;
  while (monthOf(cursor) === month && (!untilDate || cursor <= untilDate)) {
    days.push(cursor);
    cursor = toDateKey(addDays(fromDateKey(cursor), 1));
  }
  return days;
};

/**
 * 某个月存款的"最低日终余额"（分）：这个月每天结束时的存款余额里最小的那个。
 * 月中、月底才存进去的钱，月初那几天余额低，所以拿不到利息——只有存满一整个月的钱才有利息。
 * untilDate：只看到这天为止（预估本月利息用）。
 */
export function minDailySavings(entries: LedgerEntry[], month: string, untilDate?: string): number {
  const active = activeEntries(entries);
  const days = daysOfMonth(month, untilDate);
  if (days.length === 0) return 0;
  let balance = balancesOf(active, toDateKey(addDays(fromDateKey(days[0]), -1))).savings;
  const byDay = new Map<string, number>();
  active.forEach((entry) => { if (monthOf(entry.date) === month) byDay.set(entry.date, (byDay.get(entry.date) ?? 0) + entryEffect(entry).savings); });
  let min = Number.POSITIVE_INFINITY;
  days.forEach((day) => { balance += byDay.get(day) ?? 0; min = Math.min(min, balance); });
  return Math.max(0, min);
}

/** 利息 = 最低日终余额 × 月利率，保留到角（四舍五入） */
export const interestCents = (minCents: number, rate: number) => Math.max(0, Math.round((minCents * rate) / 10) * 10);

/** "12月最低存款 100 元 × 5% = 5 元" */
export function interestFormula(month: string, minCents: number, rate: number): string {
  return `${monthLabel(month)}最低存款 ${formatYuanShort(minCents)} 元 × ${formatRate(rate)} = ${formatYuanShort(interestCents(minCents, rate))} 元`;
}

/** 这个月不取钱的话，下月 1 日能拿到多少利息：本月到今天为止的最低日终余额 × 本月利率。12 月之前返回 null */
export function projectedInterest(entries: LedgerEntry[], settings: LedgerSettings, today: string): { month: string; cents: number; minCents: number; rate: number } | null {
  const month = monthOf(today);
  if (month < INTEREST_START_MONTH) return null;
  const minCents = minDailySavings(entries, month, today);
  const rate = rateForMonth(settings, month);
  return { month, cents: interestCents(minCents, rate), minCents, rate };
}

// ── 待转账 ────────────────────────────────────────────────────────────────

export interface PendingTransfer {
  /** 入账时用的记录 id（固定），两台设备同时点"已转账"也只有一条 */
  id: string;
  type: "interest";
  refKey: string;
  amountCents: number;
  title: string;
  /** 利息的算法说明 */
  detail?: string;
}

export const interestEntryId = (month: string) => `interest-${month}`;

/**
 * 待转账：已经过完、还没入账的月份的利息（12 月起）。金额为 0 的不列。已入账后被删掉（软删）的会重新出现。
 * （练习奖励 2026-11-26 起改为家长手动兑现，不再进待转账。）
 */
export function pendingTransfers(entries: LedgerEntry[], settings: LedgerSettings, today: string): PendingTransfer[] {
  const booked = new Set(activeEntries(entries).filter((entry) => entry.type === "interest").map((entry) => `${entry.type}:${entry.refKey}`));
  const interests: PendingTransfer[] = [];
  for (let month = INTEREST_START_MONTH; month < monthOf(today); month = nextMonth(month)) {
    if (booked.has(`interest:${month}`)) continue;
    const minCents = minDailySavings(entries, month);
    const rate = rateForMonth(settings, month);
    const cents = interestCents(minCents, rate);
    if (cents > 0) interests.push({ id: interestEntryId(month), type: "interest", refKey: month, amountCents: cents, title: `${monthLabel(month)}利息`, detail: interestFormula(month, minCents, rate) });
  }
  return interests;
}

// ── 权限与校验 ────────────────────────────────────────────────────────────

/** 孩子只能改、删当天自己记的支出 / 存取款；家长（Mac）什么都能改 */
export function canModifyEntry(entry: LedgerEntry, parent: boolean, today: string): boolean {
  if (parent) return true;
  return entry.createdBy === "child" && CHILD_TYPES.includes(entry.type) && entry.date === today && toLocalDateKey(entry.createdAt) === today;
}

export interface EntryInput {
  type: LedgerType;
  date: string;
  amountCents: number;
  account?: LedgerAccount;
  content?: string;
  category?: ExpenseCategory;
}

/**
 * 保存前检查，有问题返回提示语，没问题返回 null。
 * entries：现在所有记录（改一条时会先去掉它原来的样子再算余额）。
 */
export function validateEntry(input: EntryInput, options: { parent: boolean; entries: LedgerEntry[]; today: string; editingId?: string }): string | null {
  const { parent, today, editingId } = options;
  if (!parent && !CHILD_TYPES.includes(input.type)) return "这一类只有家长能记";
  if (!parent && input.date !== today) return "只能记今天的";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return "请选日期";
  if (!Number.isInteger(input.amountCents) || input.amountCents === 0 || Math.abs(input.amountCents) > MAX_AMOUNT_CENTS) return "请填写金额";
  if (input.type !== "adjust" && input.amountCents < 0) return input.type === "opening" ? "期初余额不能是负数" : "请填写金额";
  if (input.type === "expense") {
    if (!input.content?.trim()) return "写一下买了什么";
    if (!input.category || !EXPENSE_CATEGORIES.includes(input.category)) return "选一个分类";
  }
  if ((input.type === "adjust" || input.type === "opening") && !input.account) return "选择零钱还是存款";
  if (input.type === "adjust" && !input.content?.trim()) return "请写上原因";
  if (!parent) {
    const others = options.entries.filter((entry) => entry.id !== editingId);
    const before = balancesOf(others);
    const effect = entryEffect(input);
    // 2026-11-25 用户：支出时零钱不够也让记，零钱记成负数，以后挣的零花钱先补上（TASK_10 §4.1）；
    // 存进 / 取出是在两个账户之间挪钱，没有的钱挪不了，仍然拦
    if (input.type === "deposit" && before.cash + effect.cash < 0) return "零钱不够，找妈妈对账";
    if (input.type === "withdraw" && before.savings + effect.savings < 0) return "存款不够，找妈妈对账";
  }
  return null;
}

// ── 和微信对账 ────────────────────────────────────────────────────────────

/** 微信里的实际金额 − 账本金额；正数 = 账本少记了 */
export function reconcileDiff(balances: Balances, wechat: Partial<Balances>): Partial<Balances> {
  return {
    cash: wechat.cash === undefined ? undefined : wechat.cash - balances.cash,
    savings: wechat.savings === undefined ? undefined : wechat.savings - balances.savings,
  };
}
