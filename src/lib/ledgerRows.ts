/**
 * 记账记录 ↔ Supabase ledger_entries 行（TASK_10）。
 *
 * ARCHITECTURE_RULES §3.1 的教训是"同一份映射散在 4 个地方，漏一处就静默丢字段"。
 * 记账表只有这一份映射：日常写入（data/ledgerRepository）、日常拉取（cloudRepository.refreshFromCloud）、
 * 维护面板上传（cloudUpload）、维护面板下载（cloudDownload）都调这里的两个函数；
 * 往返对照测试见 lib/__tests__/ledgerRows.test.ts。
 */
import { EXPENSE_CATEGORIES, type ExpenseCategory, type LedgerAccount, type LedgerActor, type LedgerEntry, type LedgerType } from "../utils/ledger";

export const LEDGER_TABLE = "ledger_entries";

const dateOrNull = (value: unknown) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value.trim()) ? value.trim().slice(0, 10) : null);
const textOrNull = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

export function ledgerEntryToRow(entry: LedgerEntry, familyId: string): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: entry.id,
    family_id: familyId,
    entry_date: dateOrNull(entry.date),
    type: entry.type,
    account: entry.account ?? null,
    amount_cents: Math.round(entry.amountCents),
    content: textOrNull(entry.content),
    category: entry.category ?? null,
    ref_key: textOrNull(entry.refKey),
    created_by: entry.createdBy,
    created_at: textOrNull(entry.createdAt) ?? now,
    updated_at: textOrNull(entry.updatedAt) ?? now,
    deleted_at: textOrNull(entry.deletedAt),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToLedgerEntry(row: any): LedgerEntry {
  const category = EXPENSE_CATEGORIES.includes(row.category) ? (row.category as ExpenseCategory) : undefined;
  return {
    id: row.id,
    date: String(row.entry_date ?? "").slice(0, 10),
    type: row.type as LedgerType,
    account: (row.account ?? undefined) as LedgerAccount | undefined,
    amountCents: Number(row.amount_cents ?? 0),
    content: row.content ?? undefined,
    category,
    refKey: row.ref_key ?? undefined,
    createdBy: (row.created_by === "parent" ? "parent" : "child") as LedgerActor,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? undefined,
  };
}
