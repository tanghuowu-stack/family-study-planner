/**
 * 记账数据层（TASK_10，data/ledgerService.ts）：本地模式（localStorage + fake-indexeddb）。
 * 兑现积分（1 分 = 1 元，家长手动兑现，2026-11-26）；孩子余额不足拦截；存取款；孩子只能改删当天自己记的；
 * 软删除；期初余额；对账调整；改利率只有家长。时间固定 2026-11-30（周一）Asia/Shanghai。
 */
declare const process: { env: Record<string, string | undefined> };
process.env.TZ = "Asia/Shanghai";
const memStore = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => void memStore.set(k, String(v)),
  removeItem: (k: string) => void memStore.delete(k),
  clear: () => memStore.clear(),
};
import "fake-indexeddb/auto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../lib/supabase", () => ({ supabaseConfigured: false, supabase: null }));

import { db } from "../db";
import { taskRepository } from "../taskRepository";
import type { Task, TaskDraft } from "../../types/task";
import { addBonus, loadPointsContext, markPointsDataReady, settlePendingWeeks } from "../pointsService";
import {
  addReconcileAdjustments, confirmTransfer, deleteLedgerEntry, loadLedgerContext, redeemPoints, saveLedgerEntry, setMonthlyRate, setOpeningBalances,
} from "../ledgerService";
import { loadLedgerSettings } from "../ledgerRepository";
import { rateForMonth } from "../../utils/ledger";

const TODAY = "2026-11-30";
const child = { parent: false, today: TODAY };
const parent = { parent: true, today: TODAY };

const practice = (overrides: Partial<Task> = {}): TaskDraft => ({
  title: "钢琴练习", mainCategory: "interestClass", subCategory: "pianoPractice", timeType: "weeklyTimes", startDate: "2026-11-02",
  weeklyQuota: { enabled: true, targetCount: 3, unit: "次", isWeeklyRecurring: true, allowAutoDistribute: false, allowRollover: false },
  status: "todo", rolloverMode: "keepOverdue", allowRollover: false, childVisible: true, practicePoints: 2, ...overrides,
} as TaskDraft);

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(`${TODAY}T10:00:00+08:00`)); markPointsDataReady(); });
afterAll(() => { vi.useRealTimers(); });
beforeEach(async () => {
  memStore.clear();
  vi.setSystemTime(new Date(`${TODAY}T10:00:00+08:00`));
  await Promise.all([db.tasks.clear(), db.ledgerEntries.clear(), db.activityLogs.clear()]);
});

describe("兑现积分：待兑现 = 已挣积分 − 没删的练习奖励记录", () => {
  // 上周钢琴 3 次 ×2 + 达标 2 = 8 分，再加家长奖励 2 分 → 已挣 10 分
  const setup = async () => {
    const { task } = await taskRepository.create(practice({ weeklyLog: { "2026-11-23": 1, "2026-11-24": 1, "2026-11-25": 1 } }));
    vi.setSystemTime(new Date("2026-11-25T12:00:00+08:00"));
    await addBonus(2, "主动整理书包", undefined, "2026-11-25");
    vi.setSystemTime(new Date(`${TODAY}T10:00:00+08:00`));
    await settlePendingWeeks(await loadPointsContext(TODAY), TODAY); // 快照照拍，但不再出现“待转账：练习奖励”
    return task;
  };

  it("1. 填的数超过待兑现被拒；0、小数也不行；孩子不能兑现", async () => {
    await setup();
    const ctx = await loadLedgerContext(TODAY);
    expect(ctx.redeemable).toBe(10);
    expect(ctx.pending).toEqual([]);
    await expect(redeemPoints(11, parent)).rejects.toThrow("只能填 1 到 10 的整数");
    await expect(redeemPoints(0, parent)).rejects.toThrow("只能填 1 到 10 的整数");
    await expect(redeemPoints(2.5, parent)).rejects.toThrow("只能填 1 到 10 的整数");
    await expect(redeemPoints(5, child)).rejects.toThrow("只有家长");
    expect((await loadLedgerContext(TODAY)).balances.cash).toBe(0);
  });

  it("2. 兑现全部后待兑现为 0：记一条练习奖励（id 随机），零钱 +10 元，算本月收入；今日页胶囊也是 0", async () => {
    await setup();
    await redeemPoints(10, parent);
    const ctx = await loadLedgerContext(TODAY);
    expect(ctx.redeemable).toBe(0);
    expect(ctx.balances.cash).toBe(1000);
    expect(ctx.month.incomeCents).toBe(1000);
    const [entry] = ctx.entries;
    expect(entry).toMatchObject({ type: "allowance", amountCents: 1000, content: "兑现 10 分", date: TODAY, createdBy: "parent" });
    expect(entry.id.startsWith("allowance-")).toBe(false);
    const points = await loadPointsContext(TODAY);
    expect(points.redeemable).toBe(0);
    expect(points.redemptions.map((item) => item.amountCents)).toEqual([1000]);
    await expect(redeemPoints(1, parent)).rejects.toThrow("没有可以兑现");
  });

  it("3. 兑现一部分剩下的还在；兑现后补勾，待兑现增加", async () => {
    const task = await setup();
    await redeemPoints(4, parent);
    expect((await loadLedgerContext(TODAY)).redeemable).toBe(6);
    await redeemPoints(6, parent);
    await taskRepository.writeWeeklyLog(task.id, "2026-11-26", 1); // 家长在 Mac 上补勾上周：多做 1 次 ×2
    expect((await loadLedgerContext(TODAY)).redeemable).toBe(2);
  });

  it("4. 兑现后撤销一个勾，待兑现变负数（多兑了，下次抵扣），不能再兑", async () => {
    const task = await setup();
    await redeemPoints(10, parent);
    await taskRepository.writeWeeklyLog(task.id, "2026-11-25", -1); // 剩 2 次 ×2 = 4，不达标 → 已挣 6 分
    const ctx = await loadLedgerContext(TODAY);
    expect(ctx.redeemable).toBe(-4);
    expect((await loadPointsContext(TODAY)).redeemable).toBe(-4);
    expect(ctx.balances.cash).toBe(1000); // 不自动追回
    await expect(redeemPoints(1, parent)).rejects.toThrow("没有可以兑现");
  });

  it("5. 删掉兑现记录，积分回来、零钱扣回", async () => {
    await setup();
    await redeemPoints(10, parent);
    const [entry] = (await loadLedgerContext(TODAY)).entries;
    await deleteLedgerEntry(entry.id, parent);
    const ctx = await loadLedgerContext(TODAY);
    expect(ctx.redeemable).toBe(10);
    expect(ctx.balances.cash).toBe(0);
  });
});

describe("孩子记账：支出、存进存款、从存款取出", () => {
  it("3. 期初余额设好后可以记；存取款在两个账户之间挪，没有的钱挪不了；支出零钱不够也能记（记成负数）", async () => {
    await expect(setOpeningBalances({ cash: 2000, savings: 10000 }, "2026-11-23", child)).rejects.toThrow("只有家长");
    await setOpeningBalances({ cash: 2000, savings: 10000 }, "2026-11-23", parent);

    await saveLedgerEntry({ type: "expense", date: TODAY, amountCents: 500, content: "买文具", category: "文具" }, child);
    await saveLedgerEntry({ type: "deposit", date: TODAY, amountCents: 1000 }, child);
    await saveLedgerEntry({ type: "withdraw", date: TODAY, amountCents: 300 }, child);
    let ctx = await loadLedgerContext(TODAY);
    expect(ctx.balances).toEqual({ cash: 800, savings: 10700 });
    expect(ctx.month.byCategory).toEqual([{ category: "文具", cents: 500 }]);

    await expect(saveLedgerEntry({ type: "withdraw", date: TODAY, amountCents: 10701 }, child)).rejects.toThrow("存款不够");
    ctx = await loadLedgerContext(TODAY);
    expect(ctx.balances).toEqual({ cash: 800, savings: 10700 }); // 被拦下的没有写进去
    // 零钱 8 元，买 8.01 元的玩具也让记：零钱 −0.01 元；这时存进存款还是不让
    await saveLedgerEntry({ type: "expense", date: TODAY, amountCents: 801, content: "玩具", category: "玩具" }, child);
    ctx = await loadLedgerContext(TODAY);
    expect(ctx.balances).toEqual({ cash: -1, savings: 10700 });
    await expect(saveLedgerEntry({ type: "deposit", date: TODAY, amountCents: 1 }, child)).rejects.toThrow("零钱不够");
    expect(ctx.entries.every((entry) => entry.createdBy === "parent" || entry.createdBy === "child")).toBe(true);
  });

  it("4. 孩子只能改、删当天自己记的；第二天就不行了，家长可以；删除是软删", async () => {
    await setOpeningBalances({ cash: 2000 }, "2026-11-23", parent);
    const { entry } = await saveLedgerEntry({ type: "expense", date: TODAY, amountCents: 300, content: "冰棍", category: "吃的" }, child);
    await saveLedgerEntry({ type: "expense", date: TODAY, amountCents: 400, content: "冰棍两根", category: "吃的" }, { ...child, editingId: entry.id });
    expect((await loadLedgerContext(TODAY)).balances.cash).toBe(1600);

    const opening = (await db.ledgerEntries.get("opening-cash"))!;
    await expect(deleteLedgerEntry(opening.id, child)).rejects.toThrow("只能删今天自己记的");

    vi.setSystemTime(new Date("2026-12-01T09:00:00+08:00"));
    const tomorrow = { parent: false, today: "2026-12-01" };
    await expect(saveLedgerEntry({ type: "expense", date: "2026-12-01", amountCents: 100, content: "改", category: "吃的" }, { ...tomorrow, editingId: entry.id })).rejects.toThrow("只能改今天自己记的");
    await expect(deleteLedgerEntry(entry.id, tomorrow)).rejects.toThrow("只能删今天自己记的");

    await deleteLedgerEntry(entry.id, { parent: true, today: "2026-12-01" });
    const stored = await db.ledgerEntries.get(entry.id);
    expect(stored?.deletedAt).toBeTruthy(); // 软删：记录还在，只是标了删除
    expect((await loadLedgerContext("2026-12-01")).balances.cash).toBe(2000);
  });
});

describe("家长：对账调整、改利率", () => {
  it("5. 和微信对账一键生成调整，必须写原因；零钱、存款各一条", async () => {
    await setOpeningBalances({ cash: 1000, savings: 5000 }, "2026-11-23", parent);
    await expect(addReconcileAdjustments({ cash: -200, savings: 300 }, "  ", parent)).rejects.toThrow("请写上原因");
    await expect(addReconcileAdjustments({ cash: -200 }, "忘了记零食", child)).rejects.toThrow("只有家长");
    expect(await addReconcileAdjustments({ cash: -200, savings: 300 }, "忘了记零食", parent)).toBe(2);
    const ctx = await loadLedgerContext(TODAY);
    expect(ctx.balances).toEqual({ cash: 800, savings: 5300 });
    expect(ctx.entries.filter((entry) => entry.type === "adjust").map((entry) => [entry.account, entry.amountCents, entry.content]).sort()).toEqual([["cash", -200, "忘了记零食"], ["savings", 300, "忘了记零食"]]);
  });

  it("6. 改月利率只有家长，从这个月起生效；12 月存满一个月的利息 1 月 1 日待转账，入账进存款", async () => {
    await expect(setMonthlyRate(0.03, child)).rejects.toThrow("只有家长");
    await setOpeningBalances({ savings: 10000 }, "2026-11-23", parent);
    await setMonthlyRate(0.03, { parent: true, today: "2027-01-05" }); // 1 月才改：12 月仍按 5%
    const settings = await loadLedgerSettings();
    expect(rateForMonth(settings, "2026-12")).toBe(0.05);
    expect(rateForMonth(settings, "2027-01")).toBe(0.03);

    vi.setSystemTime(new Date("2027-01-05T09:00:00+08:00"));
    const jan = await loadLedgerContext("2027-01-05");
    expect(jan.pending.map((item) => [item.id, item.amountCents, item.detail])).toEqual([["interest-2026-12", 500, "12月最低存款 100 元 × 5% = 5 元"]]);
    expect(jan.projected).toMatchObject({ month: "2027-01", cents: 300 }); // 1 月到今天最低 100 元 × 3%
    await confirmTransfer("interest-2026-12", { parent: true, today: "2027-01-05" });
    const after = await loadLedgerContext("2027-01-05");
    expect(after.balances.savings).toBe(10500);
    expect(after.entries.find((entry) => entry.id === "interest-2026-12")?.content).toBe("12月最低存款 100 元 × 5% = 5 元");
  });
});
