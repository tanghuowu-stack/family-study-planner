/**
 * 记账表 ledger_entries 的字段映射与同步（TASK_10，ARCHITECTURE_RULES §3.1 / R5）。Supabase 全程 mock。
 * - 字段对照：LedgerEntry → 行 → LedgerEntry 往返不丢任何字段（四个映射面共用 lib/ledgerRows 这一份）。
 * - 日常写入：本地先写，再 upsert 一行。
 * - 日常拉取：按 updatedAt 做 LWW 合并（云端更新的覆盖本地、本地更新的不被回滚、云端软删传到本地），
 *   本地有云端没有的新记录补传。
 * - 维护面板上传 / 下载也带上记账记录。
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cloud = vi.hoisted(() => ({ upserts: {} as Record<string, Record<string, unknown>[]>, rows: {} as Record<string, Record<string, unknown>[]> }));

vi.mock("../supabase", () => {
  const query = (table: string) => {
    const result = () => Promise.resolve({ data: cloud.rows[table] ?? [], error: null });
    const builder: Record<string, unknown> = {
      eq: () => builder,
      order: () => builder,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => result().then(resolve, reject),
    };
    return builder;
  };
  return {
    supabaseConfigured: true,
    supabase: {
      from: (table: string) => ({
        select: () => query(table),
        upsert: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
          (cloud.upserts[table] ??= []).push(...(Array.isArray(rows) ? rows : [rows]));
          return Promise.resolve({ error: null });
        },
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }),
    },
  };
});

import { db } from "../../data/db";
import { cloudRepository } from "../../data/cloudRepository";
import { putLedgerEntry } from "../../data/ledgerRepository";
import { uploadLocalDataToCloud } from "../cloudUpload";
import { downloadCloudDataToLocal } from "../cloudDownload";
import { ledgerEntryToRow, rowToLedgerEntry, LEDGER_TABLE } from "../ledgerRows";
import type { LedgerEntry } from "../../utils/ledger";

const FAMILY = "fam-test";

const fullEntry = (): LedgerEntry => ({
  id: "e-full",
  date: "2026-11-30",
  type: "adjust",
  account: "savings",
  amountCents: -1234,
  content: "对账：忘了记",
  category: "文具",
  refKey: "2026-11",
  createdBy: "parent",
  createdAt: "2026-11-30T02:00:00.000Z",
  updatedAt: "2026-11-30T03:00:00.000Z",
  deletedAt: "2026-11-30T04:00:00.000Z",
});

const expense = (id: string, updatedAt: string, extra: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id, date: "2026-11-30", type: "expense", amountCents: 500, content: "买文具", category: "文具", createdBy: "child",
  createdAt: "2026-11-30T02:00:00.000Z", updatedAt, ...extra,
});

beforeEach(async () => {
  cloud.upserts = {};
  cloud.rows = {};
  await Promise.all([db.ledgerEntries.clear(), db.tasks.clear()]);
  cloudRepository.setFamilyId(FAMILY);
});

describe("字段对照（§3.1）", () => {
  it("每个字段往返都不丢", () => {
    const entry = fullEntry();
    const row = ledgerEntryToRow(entry, FAMILY);
    expect(row).toMatchObject({ id: "e-full", family_id: FAMILY, entry_date: "2026-11-30", type: "adjust", account: "savings", amount_cents: -1234, content: "对账：忘了记", category: "文具", ref_key: "2026-11", created_by: "parent", deleted_at: "2026-11-30T04:00:00.000Z" });
    expect(rowToLedgerEntry(row)).toEqual(entry);
  });

  it("可空字段：没填的写 null，读回来是 undefined；日期只传 YYYY-MM-DD", () => {
    const entry: LedgerEntry = { id: "e-min", date: "2026-11-30", type: "deposit", amountCents: 100, createdBy: "child", createdAt: "2026-11-30T02:00:00.000Z", updatedAt: "2026-11-30T02:00:00.000Z" };
    const row = ledgerEntryToRow(entry, FAMILY);
    expect(row).toMatchObject({ account: null, content: null, category: null, ref_key: null, deleted_at: null });
    expect(rowToLedgerEntry(row)).toEqual(entry);
  });
});

describe("日常写入与拉取", () => {
  it("写一条：本地先写，再 upsert 一行到 ledger_entries", async () => {
    const entry = expense("w1", "2026-11-30T02:00:00.000Z");
    expect(await putLedgerEntry(entry)).toBe(true);
    expect(await db.ledgerEntries.get("w1")).toEqual(entry);
    expect(cloud.upserts[LEDGER_TABLE]).toEqual([ledgerEntryToRow(entry, FAMILY)]);
  });

  it("拉取按 LWW 合并：云端新的覆盖、本地新的不回滚、云端软删传到本地；本地独有的新记录补传", async () => {
    await db.ledgerEntries.bulkPut([
      expense("older-local", "2026-11-30T02:00:00.000Z"),
      expense("newer-local", "2026-11-30T05:00:00.000Z", { amountCents: 700 }),
      expense("deleted-remotely", "2026-11-30T02:00:00.000Z"),
      expense("local-only", "2026-11-30T02:00:00.000Z"),
    ]);
    cloud.rows[LEDGER_TABLE] = [
      ledgerEntryToRow(expense("older-local", "2026-11-30T04:00:00.000Z", { amountCents: 900 }), FAMILY),
      ledgerEntryToRow(expense("newer-local", "2026-11-30T03:00:00.000Z", { amountCents: 100 }), FAMILY),
      ledgerEntryToRow(expense("deleted-remotely", "2026-11-30T04:00:00.000Z", { deletedAt: "2026-11-30T04:00:00.000Z" }), FAMILY),
      ledgerEntryToRow(expense("remote-only", "2026-11-30T04:00:00.000Z"), FAMILY),
    ];
    await cloudRepository.refreshFromCloud();
    expect((await db.ledgerEntries.get("older-local"))?.amountCents).toBe(900);
    expect((await db.ledgerEntries.get("newer-local"))?.amountCents).toBe(700);
    expect((await db.ledgerEntries.get("deleted-remotely"))?.deletedAt).toBe("2026-11-30T04:00:00.000Z");
    expect(await db.ledgerEntries.get("remote-only")).toBeTruthy();
    expect((cloud.upserts[LEDGER_TABLE] ?? []).map((row) => row.id)).toEqual(["local-only"]);
  });
});

describe("维护面板上传 / 下载也带记账记录", () => {
  it("上传本地数据到云端：记账记录按同一份映射上传", async () => {
    const entry = expense("up1", "2026-11-30T02:00:00.000Z");
    await db.ledgerEntries.put(entry);
    const result = await uploadLocalDataToCloud(FAMILY);
    expect(result.ledgerEntries).toBe(1);
    expect(cloud.upserts[LEDGER_TABLE]).toEqual([ledgerEntryToRow(entry, FAMILY)]);
  });

  it("从云端下载：记账记录按同一份映射写进本地", async () => {
    const entry = fullEntry();
    cloud.rows[LEDGER_TABLE] = [ledgerEntryToRow(entry, FAMILY)];
    const result = await downloadCloudDataToLocal(FAMILY);
    expect(result.ledgerEntries).toBe(1);
    expect(await db.ledgerEntries.get("e-full")).toEqual(entry);
  });
});
