/**
 * 记账数据层（TASK_10，data/ledgerService.ts）：本地模式（localStorage + fake-indexeddb）。
 * 1 分 = 1 元的练习奖励待转账 → 家长确认已转账才入账；孩子余额不足拦截；存取款；孩子只能改删当天自己记的；
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
  addReconcileAdjustments, confirmTransfer, deleteLedgerEntry, loadLedgerContext, saveLedgerEntry, setMonthlyRate, setOpeningBalances,
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

describe("练习奖励：结算后待转账，家长点已转账才入账", () => {
  it("1. 1 分 = 1 元：上周 8 分练习 + 2 分奖励 → 待转账 10 元；孩子不能确认，家长确认后进零钱，不能重复入账", async () => {
    await taskRepository.create(practice({ weeklyLog: { "2026-11-23": 1, "2026-11-24": 1, "2026-11-25": 1 } }));
    vi.setSystemTime(new Date("2026-11-25T12:00:00+08:00"));
    await addBonus(2, "主动整理书包", undefined, "2026-11-25");
    vi.setSystemTime(new Date(`${TODAY}T10:00:00+08:00`));
    expect(await settlePendingWeeks(await loadPointsContext(TODAY), TODAY)).toBe(true);

    let ctx = await loadLedgerContext(TODAY);
    expect(ctx.pending.map((item) => [item.id, item.amountCents])).toEqual([["allowance-2026-11-23", 1000]]);
    expect(ctx.balances).toEqual({ cash: 0, savings: 0 });

    await expect(confirmTransfer("allowance-2026-11-23", child)).rejects.toThrow("只有家长");
    await confirmTransfer("allowance-2026-11-23", parent);
    ctx = await loadLedgerContext(TODAY);
    expect(ctx.pending).toEqual([]);
    expect(ctx.balances.cash).toBe(1000);
    expect(ctx.month.incomeCents).toBe(1000);
    await expect(confirmTransfer("allowance-2026-11-23", parent)).rejects.toThrow("已经入账");
  });

  it("2. 待转账金额取自结算快照：结算后再补勾、再加奖励，金额不变", async () => {
    const { task } = await taskRepository.create(practice({ weeklyLog: { "2026-11-23": 1, "2026-11-24": 1, "2026-11-25": 1 } }));
    await settlePendingWeeks(await loadPointsContext(TODAY), TODAY);
    await taskRepository.writeWeeklyLog(task.id, "2026-11-26", 1); // 家长在 Mac 上补勾上周
    await addBonus(5, "结算后才加", undefined, "2026-11-27");
    const ctx = await loadLedgerContext(TODAY);
    expect(ctx.pending.map((item) => item.amountCents)).toEqual([800]);
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
