/**
 * 记账规则（TASK_10，utils/ledger.ts）：金额、余额、存取款、余额不足拦截、孩子权限、待转账、
 * 利息按"最低日终余额"计算（月中存入、月底存入、取出后再存入）、利率修改只影响之后的月份、本月小结、和微信对账。
 */
declare const process: { env: Record<string, string | undefined> };
process.env.TZ = "Asia/Shanghai";
import { describe, expect, it } from "vitest";
import {
  balancesOf, canModifyEntry, defaultLedgerSettings, formatYuan, formatYuanShort, interestCents, interestFormula, minDailySavings, monthSummary, parseYuan,
  pendingTransfers, projectedInterest, rateForMonth, reconcileDiff, validateEntry, withRateChange, type LedgerEntry, type LedgerSettings,
} from "../ledger";

let seq = 0;
function entry(date: string, type: LedgerEntry["type"], yuan: number, extra: Partial<LedgerEntry> = {}): LedgerEntry {
  seq += 1;
  return { id: `e${seq}`, date, type, amountCents: Math.round(yuan * 100), createdBy: "parent", createdAt: `${date}T10:00:00+08:00`, updatedAt: `${date}T10:00:00+08:00`, ...extra };
}
const opening = (date: string, cash: number, savings: number) => [
  entry(date, "opening", cash, { account: "cash", id: "opening-cash" }),
  entry(date, "opening", savings, { account: "savings", id: "opening-savings" }),
];

describe("金额", () => {
  it("元 ↔ 分：最多两位小数，负数和乱填返回 null", () => {
    expect(parseYuan("12")).toBe(1200);
    expect(parseYuan("12.5")).toBe(1250);
    expect(parseYuan(" 0.05 ")).toBe(5);
    expect(parseYuan("1,200.30")).toBe(120030);
    expect(parseYuan("1.234")).toBeNull();
    expect(parseYuan("-3")).toBeNull();
    expect(parseYuan("abc")).toBeNull();
    expect(formatYuan(123456)).toBe("1,234.56");
    expect(formatYuan(-50)).toBe("−0.50");
    expect(formatYuanShort(10000)).toBe("100");
    expect(formatYuanShort(550)).toBe("5.5");
  });
});

describe("余额由记录算出", () => {
  it("练习奖励进零钱、支出出零钱、存进存款 / 取出在两个账户之间挪、利息进存款；删掉的不算", () => {
    const entries = [
      ...opening("2026-11-23", 20, 100),
      entry("2026-11-29", "allowance", 30),
      entry("2026-11-30", "expense", 12.5, { category: "文具", content: "买文具" }),
      entry("2026-11-30", "deposit", 10),
      entry("2026-12-02", "withdraw", 5),
      entry("2027-01-01", "interest", 5.2),
      entry("2026-12-03", "expense", 99, { category: "玩具", content: "删掉的", deletedAt: "2026-12-03T12:00:00+08:00" }),
    ];
    expect(balancesOf(entries)).toEqual({ cash: 3250, savings: 11020 });
    expect(balancesOf(entries, "2026-11-30")).toEqual({ cash: 2750, savings: 11000 });
  });

  it("对账调整可正可负，调哪个账户就动哪个", () => {
    const entries = [...opening("2026-11-23", 10, 10), entry("2026-11-24", "adjust", -3, { account: "cash", content: "忘记记" }), entry("2026-11-24", "adjust", 2, { account: "savings", content: "对账" })];
    expect(balancesOf(entries)).toEqual({ cash: 700, savings: 1200 });
  });
});

describe("保存前检查：余额不足、必填、孩子权限", () => {
  const today = "2026-11-30";
  const entries = opening("2026-11-23", 10, 50);
  const child = { parent: false, entries, today };

  it("孩子记支出，零钱不够也让记（零钱记成负数，以后挣的零花钱补上；2026-11-25 用户改）", () => {
    expect(validateEntry({ type: "expense", date: today, amountCents: 1001, content: "买书", category: "书" }, child)).toBeNull();
    expect(validateEntry({ type: "expense", date: today, amountCents: 1000, content: "买书", category: "书" }, child)).toBeNull();
    expect(balancesOf([...entries, entry(today, "expense", 10.01, { createdBy: "child", content: "买书", category: "书" })]).cash).toBe(-1);
  });

  it("孩子从存款取出，存款不够不让存；存进存款，零钱不够不让存", () => {
    expect(validateEntry({ type: "withdraw", date: today, amountCents: 5001 }, child)).toBe("存款不够，找妈妈对账");
    expect(validateEntry({ type: "withdraw", date: today, amountCents: 5000 }, child)).toBeNull();
    expect(validateEntry({ type: "deposit", date: today, amountCents: 1001 }, child)).toBe("零钱不够，找妈妈对账");
  });

  it("改自己的记录时，按去掉原来那条之后的余额算", () => {
    const spent = entry(today, "expense", 8, { createdBy: "child", content: "零食", category: "吃的" });
    expect(validateEntry({ type: "deposit", date: today, amountCents: 1000 }, { ...child, entries: [...entries, spent] })).toMatch(/零钱不够/);
    const saved = entry(today, "deposit", 8, { createdBy: "child" });
    expect(validateEntry({ type: "deposit", date: today, amountCents: 1000 }, { ...child, entries: [...entries, saved], editingId: saved.id })).toBeNull();
  });

  it("支出必须写内容、选分类；对账调整必须写原因；金额不能是 0", () => {
    expect(validateEntry({ type: "expense", date: today, amountCents: 100, category: "书" }, child)).toBe("写一下买了什么");
    expect(validateEntry({ type: "expense", date: today, amountCents: 100, content: "书" }, child)).toBe("选一个分类");
    expect(validateEntry({ type: "adjust", date: today, amountCents: -100, account: "cash" }, { ...child, parent: true })).toBe("请写上原因");
    expect(validateEntry({ type: "deposit", date: today, amountCents: 0 }, child)).toBe("请填写金额");
  });

  it("孩子只能记今天的支出 / 存取款；期初余额、对账调整只有家长", () => {
    expect(validateEntry({ type: "expense", date: "2026-11-29", amountCents: 100, content: "书", category: "书" }, child)).toBe("只能记今天的");
    expect(validateEntry({ type: "opening", date: today, amountCents: 100, account: "cash" }, child)).toBe("这一类只有家长能记");
    expect(validateEntry({ type: "adjust", date: today, amountCents: 100, account: "cash", content: "x" }, child)).toBe("这一类只有家长能记");
  });

  it("家长不受余额限制（例如补记以前忘记的支出），可以选以前的日期", () => {
    expect(validateEntry({ type: "expense", date: "2026-11-25", amountCents: 99999, content: "补记", category: "其他" }, { parent: true, entries, today })).toBeNull();
  });
});

describe("孩子只能改、删当天自己记的", () => {
  const today = "2026-11-30";
  it("当天自己记的能改；昨天的、家长记的、练习奖励都不能改；家长都能改", () => {
    const mine = entry(today, "expense", 3, { createdBy: "child", content: "零食", category: "吃的" });
    const yesterday = entry("2026-11-29", "expense", 3, { createdBy: "child", content: "零食", category: "吃的" });
    const byParent = entry(today, "expense", 3, { createdBy: "parent", content: "零食", category: "吃的" });
    const allowance = entry(today, "allowance", 30, { createdBy: "parent" });
    expect(canModifyEntry(mine, false, today)).toBe(true);
    expect(canModifyEntry(yesterday, false, today)).toBe(false);
    expect(canModifyEntry(byParent, false, today)).toBe(false);
    expect(canModifyEntry(allowance, false, today)).toBe(false);
    expect([mine, yesterday, byParent, allowance].every((item) => canModifyEntry(item, true, today))).toBe(true);
  });
});

describe("利息：上个月存款的最低日终余额 × 月利率，保留到角", () => {
  const settings = defaultLedgerSettings();

  it("整月都在的钱有利息：12 月一直 100 元 → 5 元", () => {
    const entries = opening("2026-11-23", 0, 100);
    expect(minDailySavings(entries, "2026-12")).toBe(10000);
    expect(interestCents(10000, 0.05)).toBe(500);
    expect(interestFormula("2026-12", 10000, 0.05)).toBe("12月最低存款 100 元 × 5% = 5 元");
  });

  it("月中存进去的钱，月初那几天不在，不算利息", () => {
    const entries = [...opening("2026-11-23", 200, 100), entry("2026-12-15", "deposit", 100)];
    expect(minDailySavings(entries, "2026-12")).toBe(10000);
  });

  it("月底才存的钱不算利息；月初就有的照算", () => {
    const entries = [...opening("2026-11-23", 200, 0), entry("2026-12-31", "deposit", 150)];
    expect(minDailySavings(entries, "2026-12")).toBe(0);
    expect(pendingTransfers(entries, settings, "2027-01-01")).toEqual([]); // 0 元不列待转账
    expect(minDailySavings(entries, "2027-01")).toBe(15000); // 下个月整月都在，就有利息了
  });

  it("月中取出后再存回去：取出那几天的低点就是最低日终余额", () => {
    const entries = [...opening("2026-11-23", 0, 100), entry("2026-12-10", "withdraw", 60), entry("2026-12-12", "deposit", 60)];
    expect(minDailySavings(entries, "2026-12")).toBe(4000);
    expect(interestCents(4000, 0.05)).toBe(200);
  });

  it("同一天先取后存，只看那天结束时的余额", () => {
    const entries = [...opening("2026-11-23", 0, 100), entry("2026-12-10", "withdraw", 60), entry("2026-12-10", "deposit", 60)];
    expect(minDailySavings(entries, "2026-12")).toBe(10000);
  });

  it("保留到角（四舍五入）", () => {
    expect(interestCents(3333, 0.05)).toBe(170); // 1.6665 元 → 1.7 元
    expect(interestCents(3299, 0.05)).toBe(160); // 1.6495 元 → 1.6 元
  });

  it("11 月不计息：2027-01-01 才生成 12 月的利息；之后每月 1 日生成上个月的", () => {
    const entries = opening("2026-11-01", 0, 100);
    expect(pendingTransfers(entries, settings, "2026-12-15").filter((item) => item.type === "interest")).toEqual([]);
    const jan = pendingTransfers(entries, settings, "2027-01-01");
    expect(jan.map((item) => [item.id, item.amountCents, item.detail])).toEqual([["interest-2026-12", 500, "12月最低存款 100 元 × 5% = 5 元"]]);
    expect(pendingTransfers(entries, settings, "2027-02-01").map((item) => item.id)).toEqual(["interest-2026-12", "interest-2027-01"]);
  });

  it("利息入账后不再待转账；入账的利息算进下个月的存款", () => {
    const entries = [...opening("2026-11-01", 0, 100), entry("2027-01-01", "interest", 5, { id: "interest-2026-12", refKey: "2026-12" })];
    const feb = pendingTransfers(entries, settings, "2027-02-01");
    expect(feb.map((item) => [item.id, item.amountCents])).toEqual([["interest-2027-01", 530]]); // 105 × 5% = 5.25 → 5.3
  });

  it("这个月不取钱的话下月能拿多少：本月到今天为止的最低日终余额 × 本月利率；12 月前不显示", () => {
    const entries = [...opening("2026-11-01", 0, 100), entry("2026-12-20", "deposit", 0.01, { amountCents: 5000 })];
    expect(projectedInterest(entries, settings, "2026-11-30")).toBeNull();
    expect(projectedInterest(entries, settings, "2026-12-25")).toMatchObject({ month: "2026-12", minCents: 10000, cents: 500 });
  });
});

describe("利率修改只影响之后计算的月份", () => {
  it("1 月 3 日改成 10%：12 月（1 日已经算出来的）还是 5%，1 月起 10%", () => {
    const changed = withRateChange(defaultLedgerSettings(), 0.1, "2027-01-03", "2027-01-03T09:00:00Z");
    expect(rateForMonth(changed, "2026-12")).toBe(0.05);
    expect(rateForMonth(changed, "2027-01")).toBe(0.1);
    expect(rateForMonth(changed, "2027-06")).toBe(0.1);
    const entries = opening("2026-11-01", 0, 100);
    const pending = pendingTransfers(entries, changed, "2027-02-01");
    expect(pending.map((item) => [item.refKey, item.amountCents])).toEqual([["2026-12", 500], ["2027-01", 1000]]);
  });

  it("12 月 15 日改：12 月的利息 1 月 1 日才算，用新利率；11 月里改的从 12 月起生效", () => {
    expect(rateForMonth(withRateChange(defaultLedgerSettings(), 0.03, "2026-12-15"), "2026-12")).toBe(0.03);
    expect(withRateChange(defaultLedgerSettings(), 0.04, "2026-11-25").rates[0].from).toBe("2026-12");
  });

  it("同一个月改两次，以后改的为准", () => {
    let settings: LedgerSettings = withRateChange(defaultLedgerSettings(), 0.04, "2027-03-02", "2027-03-02T00:00:00Z");
    settings = withRateChange(settings, 0.06, "2027-03-20", "2027-03-20T00:00:00Z");
    expect(settings.rates).toHaveLength(1);
    expect(rateForMonth(settings, "2027-03")).toBe(0.06);
  });
});

describe("待转账：只有利息（练习奖励 2026-11-26 起改为手动兑现）", () => {
  it("有练习奖励记录、没有利息时，待转账是空的", () => {
    const entries = [...opening("2026-11-23", 10, 0), entry("2026-11-29", "allowance", 18)];
    expect(pendingTransfers(entries, defaultLedgerSettings(), "2026-11-30")).toEqual([]);
  });
});

describe("本月小结与对账", () => {
  it("收入 = 练习奖励 + 利息；支出按分类合计；存取款、期初、调整不算收支", () => {
    const entries = [
      ...opening("2026-12-01", 50, 50),
      entry("2026-12-06", "allowance", 20),
      entry("2026-12-01", "interest", 2),
      entry("2026-12-07", "expense", 3, { category: "吃的", content: "零食" }),
      entry("2026-12-08", "expense", 10, { category: "书", content: "漫画" }),
      entry("2026-12-09", "expense", 2, { category: "吃的", content: "冰棍" }),
      entry("2026-12-09", "deposit", 5),
      entry("2026-12-10", "adjust", -1, { account: "cash", content: "对账" }),
      entry("2026-11-30", "expense", 9, { category: "玩具", content: "上个月的" }),
    ];
    const summary = monthSummary(entries, "2026-12");
    expect(summary).toMatchObject({ incomeCents: 2200, expenseCents: 1500 });
    expect(summary.byCategory).toEqual([{ category: "书", cents: 1000 }, { category: "吃的", cents: 500 }]);
  });

  it("和微信对账：微信 − 账本，正数 = 账本少记了", () => {
    expect(reconcileDiff({ cash: 1000, savings: 5000 }, { cash: 900, savings: 5000 })).toEqual({ cash: -100, savings: 0 });
    expect(reconcileDiff({ cash: 1000, savings: 5000 }, { savings: 5200 })).toEqual({ cash: undefined, savings: 200 });
  });
});
