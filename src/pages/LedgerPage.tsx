import { useEffect, useMemo, useRef, useState } from "react";
import { Sheet } from "../components/Sheet";
import { loadPointsContext, settlePendingWeeks } from "../data/pointsService";
import {
  addReconcileAdjustments, confirmTransfer, deleteLedgerEntry, loadLedgerContext, saveLedgerEntry, setMonthlyRate, setOpeningBalances, type LedgerContext,
} from "../data/ledgerService";
import { formatCompactDate, relativeDayLabel } from "../utils/date";
import { isParentDevice } from "../utils/device";
import {
  ACCOUNT_LABEL, activeEntries, canModifyEntry, EXPENSE_CATEGORIES, entryEffect, formatRate, formatYuan, LEDGER_TYPE_LABEL, monthLabel, parseYuan, rateForMonth,
  reconcileDiff, type ExpenseCategory, type LedgerAccount, type LedgerEntry, type LedgerType,
} from "../utils/ledger";

/**
 * 记账页（TASK_10，docs/TASK_10_ledger.md）：零钱 / 存款余额、本月收支、待转账、记录列表、本月小结、和微信对账。
 * 孩子（iPad）能记支出、存进存款、从存款取出，只能改删当天自己记的；家长（Mac）还能确认转账、设期初余额、对账调整、改利率。
 */

const primaryButton = "min-h-11 rounded-lg bg-primary px-4 text-sm font-bold text-white disabled:opacity-40";
const secondaryButton = "min-h-11 rounded-lg border border-ink/10 bg-white px-4 text-sm font-semibold text-ink hover:border-primary/40 disabled:opacity-40";
const inputClass = "min-h-11 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-base text-ink outline-none focus:border-primary";
const labelClass = "block text-[13px] font-semibold text-muted";

const signedYuan = (cents: number) => (cents > 0 ? `+${formatYuan(cents)}` : formatYuan(cents));

/** 一条记录在列表里显示的金额：对零钱的变化；存进存款 / 利息这类只动存款的，显示存款的变化 */
function displayEffect(entry: LedgerEntry): { cents: number; account: LedgerAccount } {
  const effect = entryEffect(entry);
  if (entry.type === "deposit") return { cents: entry.amountCents, account: "savings" };
  if (entry.type === "withdraw") return { cents: entry.amountCents, account: "cash" };
  return effect.savings !== 0 && effect.cash === 0 ? { cents: effect.savings, account: "savings" } : { cents: effect.cash, account: "cash" };
}

function entryTitle(entry: LedgerEntry): string {
  if (entry.type === "expense") return entry.content || "支出";
  if (entry.type === "adjust") return `对账调整（${ACCOUNT_LABEL[entry.account ?? "cash"]}）`;
  if (entry.type === "opening") return `期初余额（${ACCOUNT_LABEL[entry.account ?? "cash"]}）`;
  if (entry.type === "allowance") return entry.content || "练习奖励";
  return LEDGER_TYPE_LABEL[entry.type];
}

function entrySubtitle(entry: LedgerEntry): string | undefined {
  if (entry.type === "expense") return entry.category;
  if (entry.type === "interest") return entry.content;
  if (entry.type === "adjust") return entry.content;
  if ((entry.type === "deposit" || entry.type === "withdraw") && entry.content) return entry.content;
  return undefined;
}

type Editor = { mode: "new"; type: LedgerType } | { mode: "edit"; entry: LedgerEntry };

export function LedgerPage({ refreshKey, onChanged, notify }: { refreshKey: number; onChanged: () => void; notify: (message: string) => void }) {
  const [ctx, setCtx] = useState<LedgerContext | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [dialog, setDialog] = useState<"opening" | "rate" | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [busyTransfer, setBusyTransfer] = useState("");
  const parent = isParentDevice();
  const request = useRef(0);

  const reload = async () => {
    const id = ++request.current;
    // 记账页也要先补结算（周日晚 8 点后 / 上周还没结算的），"待转账"的练习奖励取自结算快照
    await loadPointsContext().then((points) => settlePendingWeeks(points)).catch(() => false);
    const next = await loadLedgerContext();
    if (id === request.current) setCtx(next);
  };
  useEffect(() => { void reload().catch((error) => console.warn("[ledger] load", error)); }, [refreshKey]);

  const changed = (message?: string) => { if (message) notify(message); onChanged(); void reload(); };

  const entries = useMemo(() => (ctx ? activeEntries(ctx.entries).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)) : []), [ctx]);
  const shown = showAll ? entries : entries.slice(0, 40);
  const groups = useMemo(() => {
    const map = new Map<string, LedgerEntry[]>();
    shown.forEach((entry) => map.set(entry.date, [...(map.get(entry.date) ?? []), entry]));
    return [...map.entries()];
  }, [shown]);

  if (!ctx) return <main className="mx-auto w-full max-w-5xl px-3 pb-content pt-3 sm:px-7 sm:pt-6 lg:px-10"><header className="page-header"><h1 className="page-title">记账</h1></header></main>;

  const { balances, month, projected, pending, today } = ctx;
  const rateNow = rateForMonth(ctx.settings, today.slice(0, 7) < "2026-12" ? "2026-12" : today.slice(0, 7));

  const transfer = async (id: string) => {
    setBusyTransfer(id);
    try { await confirmTransfer(id); changed("已入账"); } catch (error) { notify(error instanceof Error ? error.message : "入账失败，请重试"); } finally { setBusyTransfer(""); }
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-3 pb-content pt-3 sm:px-7 sm:pt-6 lg:px-10">
      <header className="page-header">
        <h1 className="page-title">记账</h1>
        {parent && <div className="flex items-center gap-2">
          <button type="button" onClick={() => setDialog("opening")} className="min-h-11 rounded-lg border border-ink/10 bg-white px-3 text-sm font-semibold text-muted hover:text-ink">期初余额</button>
          <button type="button" onClick={() => setDialog("rate")} className="min-h-11 rounded-lg border border-ink/10 bg-white px-3 text-sm font-semibold text-muted hover:text-ink">月利率 {formatRate(rateNow)}</button>
        </div>}
      </header>

      {/* 顶部：零钱、存款、本月收入、本月支出 */}
      <section aria-label="余额" className="surface grid grid-cols-2 md:grid-cols-4">
        <div className="border-b border-r border-ink/[0.07] px-4 py-3.5 md:border-b-0">
          <p className="text-[13px] font-semibold text-muted">零钱</p>
          <p className="mt-0.5 text-[28px] font-bold leading-9 tabular-nums text-ink" data-testid="ledger-cash">{formatYuan(balances.cash)}<span className="ml-1 text-sm font-semibold text-muted">元</span></p>
          <p className="text-[13px] text-muted">可以自由花（微信零钱）</p>
        </div>
        <div className="border-b border-ink/[0.07] px-4 py-3.5 md:border-b-0 md:border-r">
          <p className="text-[13px] font-semibold text-muted">存款</p>
          <p className="mt-0.5 text-[28px] font-bold leading-9 tabular-nums text-ink" data-testid="ledger-savings">{formatYuan(balances.savings)}<span className="ml-1 text-sm font-semibold text-muted">元</span></p>
          <p className="text-[13px] leading-5 text-primary" data-testid="projected-interest">
            {projected ? `这个月不取钱的话，下月 1 日能拿到 ${formatYuan(projected.cents)} 元利息` : "12 月起开始计息，每月 1 日发上个月的利息"}
          </p>
        </div>
        <div className="border-r border-ink/[0.07] px-4 py-3.5">
          <p className="text-[13px] font-semibold text-muted">{monthLabel(month.month)}收入</p>
          <p className="mt-0.5 text-xl font-bold tabular-nums text-ink">{formatYuan(month.incomeCents)}<span className="ml-1 text-sm font-semibold text-muted">元</span></p>
        </div>
        <div className="px-4 py-3.5">
          <p className="text-[13px] font-semibold text-muted">{monthLabel(month.month)}支出</p>
          <p className="mt-0.5 text-xl font-bold tabular-nums text-ink">{formatYuan(month.expenseCents)}<span className="ml-1 text-sm font-semibold text-muted">元</span></p>
        </div>
      </section>

      <div className="mt-4 grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
        <button type="button" onClick={() => setEditor({ mode: "new", type: "expense" })} className="min-h-11 rounded-lg bg-alert px-4 text-sm font-bold text-white hover:bg-[#cf5b40]">记一笔支出</button>
        <button type="button" onClick={() => setEditor({ mode: "new", type: "deposit" })} className={secondaryButton}>存进存款</button>
        <button type="button" onClick={() => setEditor({ mode: "new", type: "withdraw" })} className={secondaryButton}>从存款取出</button>
      </div>

      {pending.length > 0 && (
        <section aria-label="待转账" className="surface mt-4 border-sun/70">
          <div className="flex items-center justify-between border-b border-ink/[0.07] bg-sun/15 px-4 py-2.5"><h2 className="text-base font-bold text-ink">待转账</h2><span className="text-[13px] text-muted">{parent ? "转好以后点“已转账”入账" : "妈妈转好后在 Mac 上点“已转账”，就会记上"}</span></div>
          <ul className="divide-y divide-ink/[0.07]">
            {pending.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-4 py-3" data-testid="pending-transfer">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-ink">{item.title}<span className="ml-2 text-[13px] font-normal text-muted">→ {item.type === "interest" ? "存款" : "零钱"}</span></p>
                  {item.detail && <p className="text-[13px] text-muted">{item.detail}</p>}
                </div>
                <span className="shrink-0 text-base font-bold tabular-nums text-ink">{formatYuan(item.amountCents)} 元</span>
                {parent ? <button type="button" disabled={busyTransfer === item.id} onClick={() => void transfer(item.id)} className={primaryButton}>已转账</button>
                  : <span className="shrink-0 text-[13px] text-muted">等转账</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <section aria-label="记录" className="surface">
          <div className="flex items-center justify-between border-b border-ink/10 px-4 py-3"><h2 className="text-base font-bold text-ink">记录</h2><span className="text-[13px] tabular-nums text-muted">{entries.length} 条</span></div>
          {entries.length === 0 ? <p className="px-4 py-6 text-[15px] text-muted">还没有记录。{parent ? "可以先在右上角设好期初余额。" : ""}</p> : (
            <div>
              {groups.map(([date, items]) => (
                <div key={date}>
                  <p className="border-b border-ink/[0.07] bg-stone-50/70 px-4 py-1.5 text-[13px] font-semibold text-muted">{formatCompactDate(date)}{date === today ? " · 今天" : relativeDayLabel(date, today) === "昨天" ? " · 昨天" : ""}</p>
                  <ul className="divide-y divide-ink/[0.07]">
                    {items.map((entry) => {
                      const effect = displayEffect(entry);
                      const editable = canModifyEntry(entry, parent, today);
                      const subtitle = entrySubtitle(entry);
                      const body = (
                        <>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-semibold text-ink">{entryTitle(entry)}</span>
                            {subtitle && <span className="block truncate text-[13px] text-muted">{subtitle}</span>}
                          </span>
                          <span className={`shrink-0 text-right text-base font-bold tabular-nums ${effect.cents > 0 && entry.type !== "deposit" && entry.type !== "withdraw" ? "text-primary" : "text-ink"}`}>
                            {entry.type === "deposit" || entry.type === "withdraw" ? formatYuan(entry.amountCents) : signedYuan(effect.cents)}
                            <span className="block text-[13px] font-normal text-muted">{entry.type === "deposit" ? "零钱 → 存款" : entry.type === "withdraw" ? "存款 → 零钱" : ACCOUNT_LABEL[effect.account]}</span>
                          </span>
                        </>
                      );
                      return (
                        <li key={entry.id} data-testid="ledger-row">
                          {editable
                            ? <button type="button" onClick={() => setEditor({ mode: "edit", entry })} className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-stone-50">{body}</button>
                            : <div className="flex min-h-14 items-center gap-3 px-4 py-2">{body}</div>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              {entries.length > shown.length && <button type="button" onClick={() => setShowAll(true)} className="min-h-11 w-full border-t border-ink/[0.07] text-sm font-semibold text-primary hover:bg-stone-50">显示全部 {entries.length} 条</button>}
            </div>
          )}
        </section>

        <div className="space-y-4">
          <MonthSummaryCard ctx={ctx} />
          <ReconcileCard ctx={ctx} parent={parent} onDone={(count) => changed(`已生成 ${count} 条对账调整`)} />
        </div>
      </div>

      {editor && <EntryDialog ctx={ctx} editor={editor} parent={parent} onClose={() => setEditor(null)} onSaved={(message) => { setEditor(null); changed(message); }} />}
      {dialog === "opening" && <OpeningDialog ctx={ctx} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); changed("期初余额已保存"); }} />}
      {dialog === "rate" && <RateDialog ctx={ctx} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); changed("月利率已保存"); }} />}
    </main>
  );
}

function MonthSummaryCard({ ctx }: { ctx: LedgerContext }) {
  const { month } = ctx;
  const max = Math.max(1, ...month.byCategory.map((item) => item.cents));
  return (
    <section aria-label="本月小结" className="surface">
      <div className="border-b border-ink/10 px-4 py-3"><h2 className="text-base font-bold text-ink">{monthLabel(month.month)}小结</h2></div>
      <dl className="grid grid-cols-2 divide-x divide-ink/[0.07] border-b border-ink/[0.07]">
        <div className="px-4 py-2.5"><dt className="text-[13px] text-muted">收入</dt><dd className="text-base font-bold tabular-nums text-primary">+{formatYuan(month.incomeCents)}</dd></div>
        <div className="px-4 py-2.5"><dt className="text-[13px] text-muted">支出</dt><dd className="text-base font-bold tabular-nums text-ink">−{formatYuan(month.expenseCents)}</dd></div>
      </dl>
      {month.byCategory.length === 0 ? <p className="px-4 py-3 text-[13px] text-muted">这个月还没有支出。</p> : (
        <ul className="space-y-2.5 px-4 py-3">
          {month.byCategory.map((item) => (
            <li key={item.category}>
              <div className="flex items-baseline justify-between text-sm"><span className="text-ink">{item.category}</span><span className="font-semibold tabular-nums text-ink">{formatYuan(item.cents)} 元</span></div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-200"><div className="h-full rounded-full bg-primary" style={{ width: `${(item.cents / max) * 100}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-ink/[0.07] px-4 py-2 text-[13px] text-muted">收入 = 练习奖励 + 利息；存取款只是在零钱和存款之间挪。</p>
    </section>
  );
}

/** 和微信对账：输入微信里实际的零钱和零钱通，显示和账本差多少；家长写原因一键生成对账调整 */
function ReconcileCard({ ctx, parent, onDone }: { ctx: LedgerContext; parent: boolean; onDone: (count: number) => void }) {
  const [cash, setCash] = useState("");
  const [savings, setSavings] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const wechat = { cash: cash.trim() ? parseYuan(cash) ?? undefined : undefined, savings: savings.trim() ? parseYuan(savings) ?? undefined : undefined };
  const diff = reconcileDiff(ctx.balances, wechat);
  const hasDiff = !!diff.cash || !!diff.savings;
  const line = (label: string, ledger: number, value: number | undefined, delta: number | undefined) => value === undefined ? null : (
    <p className="text-[13px] leading-5" data-testid={`reconcile-${label}`}>
      <span className="text-muted">{label}：账本 {formatYuan(ledger)} 元，</span>
      {delta === 0 ? <span className="font-semibold text-primary">对上了</span> : <span className="font-semibold text-alert">微信{(delta ?? 0) > 0 ? "多" : "少"} {formatYuan(Math.abs(delta ?? 0))} 元</span>}
    </p>
  );
  const submit = async () => {
    setError("");
    setBusy(true);
    try {
      const count = await addReconcileAdjustments({ cash: diff.cash, savings: diff.savings }, reason);
      setCash(""); setSavings(""); setReason("");
      onDone(count);
    } catch (reasonError) { setError(reasonError instanceof Error ? reasonError.message : "保存失败，请重试"); } finally { setBusy(false); }
  };
  return (
    <section aria-label="和微信对账" className="surface">
      <div className="border-b border-ink/10 px-4 py-3"><h2 className="text-base font-bold text-ink">和微信对账</h2><p className="text-[13px] text-muted">填微信里实际的钱，看看和账本差多少</p></div>
      <div className="space-y-3 px-4 py-3">
        <div className="grid grid-cols-2 gap-2">
          <label className={labelClass}>微信零钱<input value={cash} onChange={(event) => setCash(event.target.value)} inputMode="decimal" placeholder="0.00" className={`${inputClass} mt-1 tabular-nums`} /></label>
          <label className={labelClass}>零钱通<input value={savings} onChange={(event) => setSavings(event.target.value)} inputMode="decimal" placeholder="0.00" className={`${inputClass} mt-1 tabular-nums`} /></label>
        </div>
        {(cash.trim() && wechat.cash === undefined) || (savings.trim() && wechat.savings === undefined) ? <p className="text-[13px] text-rose-700">金额最多两位小数</p> : null}
        {line("零钱", ctx.balances.cash, wechat.cash, diff.cash)}
        {line("存款", ctx.balances.savings, wechat.savings, diff.savings)}
        {hasDiff && (parent ? (
          <div className="space-y-2 border-t border-ink/[0.07] pt-3">
            <label className={labelClass}>原因<input value={reason} maxLength={60} onChange={(event) => setReason(event.target.value)} placeholder="例如：忘了记买零食" className={`${inputClass} mt-1`} /></label>
            <button type="button" disabled={busy || !reason.trim()} onClick={() => void submit()} className={`${primaryButton} w-full`}>生成对账调整</button>
            {error && <p className="text-[13px] text-rose-700">{error}</p>}
          </div>
        ) : <p className="text-[13px] text-muted">对不上的话，想想有没有忘记记的，或者找妈妈对账。</p>)}
      </div>
    </section>
  );
}

const TYPE_TITLES: Partial<Record<LedgerType, string>> = { expense: "记一笔支出", deposit: "存进存款", withdraw: "从存款取出" };

function EntryDialog({ ctx, editor, parent, onClose, onSaved }: { ctx: LedgerContext; editor: Editor; parent: boolean; onClose: () => void; onSaved: (message: string) => void }) {
  const existing = editor.mode === "edit" ? editor.entry : undefined;
  const type = existing?.type ?? (editor.mode === "new" ? editor.type : "expense");
  const [amount, setAmount] = useState(existing ? formatYuan(Math.abs(existing.amountCents)).replace(/,/g, "") : "");
  const [negative, setNegative] = useState(!!existing && existing.amountCents < 0);
  const [content, setContent] = useState(existing?.content ?? "");
  const [category, setCategory] = useState<ExpenseCategory | undefined>(existing?.category);
  const [account, setAccount] = useState<LedgerAccount>(existing?.account ?? "cash");
  const [date, setDate] = useState(existing?.date ?? ctx.today);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cents = parseYuan(amount);
  const accountChoice = type === "adjust" || type === "opening";
  const editableDate = parent;
  const title = existing ? `改：${LEDGER_TYPE_LABEL[type]}` : TYPE_TITLES[type] ?? LEDGER_TYPE_LABEL[type];
  const hint = type === "withdraw" ? `存款现在 ${formatYuan(ctx.balances.savings)} 元` : type === "expense" || type === "deposit" ? `零钱现在 ${formatYuan(ctx.balances.cash)} 元` : undefined;

  const save = async () => {
    setError("");
    if (cents === null || cents === 0) { setError("请填写金额（最多两位小数）"); return; }
    setBusy(true);
    try {
      await saveLedgerEntry({ type, date, amountCents: type === "adjust" && negative ? -cents : cents, content, category, account: accountChoice ? account : undefined }, { editingId: existing?.id });
      onSaved(existing ? "已修改" : "已记下");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败，请重试"); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!existing) return;
    setBusy(true);
    try { await deleteLedgerEntry(existing.id); onSaved("已删除"); } catch (reason) { setError(reason instanceof Error ? reason.message : "删除失败"); setBusy(false); }
  };

  return (
    <Sheet title={title} description={hint} onClose={onClose}>
      <div className="space-y-3">
        {type === "adjust" && <div className="inline-flex gap-1.5">{[false, true].map((value) => <button key={String(value)} type="button" onClick={() => setNegative(value)} className={`min-h-11 rounded-lg px-4 text-sm font-semibold ${negative === value ? "bg-primary text-white" : "bg-white text-muted ring-1 ring-inset ring-ink/10"}`}>{value ? "减少" : "增加"}</button>)}</div>}
        <label className={labelClass}>金额
          <span className="mt-1 flex items-center gap-2"><input autoFocus={!existing} value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0.00" aria-label="金额"
            className="min-h-12 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-2xl font-bold tabular-nums text-ink outline-none focus:border-primary" /><span className="shrink-0 text-base font-semibold text-muted">元</span></span>
        </label>
        {type === "expense" && <>
          <label className={labelClass}>买了什么<input value={content} maxLength={40} onChange={(event) => setContent(event.target.value)} placeholder="例如：买文具" className={`${inputClass} mt-1`} /></label>
          <fieldset><legend className={labelClass}>分类</legend>
            <div className="mt-1 grid grid-cols-3 gap-1.5">{EXPENSE_CATEGORIES.map((item) => <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)} className={`min-h-11 rounded-lg text-sm font-semibold ${category === item ? "bg-primary text-white" : "bg-white text-ink ring-1 ring-inset ring-ink/10"}`}>{item}</button>)}</div>
          </fieldset>
        </>}
        {(type === "deposit" || type === "withdraw" || type === "allowance" || type === "interest") && <label className={labelClass}>备注（可以不写）<input value={content} maxLength={60} onChange={(event) => setContent(event.target.value)} className={`${inputClass} mt-1`} /></label>}
        {accountChoice && <fieldset><legend className={labelClass}>账户</legend><div className="mt-1 inline-flex gap-1.5">{(["cash", "savings"] as LedgerAccount[]).map((item) => <button key={item} type="button" onClick={() => setAccount(item)} className={`min-h-11 rounded-lg px-4 text-sm font-semibold ${account === item ? "bg-primary text-white" : "bg-white text-muted ring-1 ring-inset ring-ink/10"}`}>{ACCOUNT_LABEL[item]}</button>)}</div></fieldset>}
        {type === "adjust" && <label className={labelClass}>原因<input value={content} maxLength={60} onChange={(event) => setContent(event.target.value)} className={`${inputClass} mt-1`} /></label>}
        {editableDate ? <label className={labelClass}>日期<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={`${inputClass} mt-1`} /></label>
          : <p className="text-[13px] text-muted">记在今天（{formatCompactDate(ctx.today)}）</p>}
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p>}
        <button type="button" disabled={busy} onClick={() => void save()} className={`${primaryButton} w-full`}>{existing ? "保存修改" : "记下来"}</button>
        {existing && (confirmDelete
          ? <div className="flex gap-2"><button type="button" disabled={busy} onClick={() => void remove()} className="min-h-11 flex-1 rounded-lg bg-white text-sm font-bold text-rose-700 ring-1 ring-inset ring-rose-200">确定删掉</button><button type="button" onClick={() => setConfirmDelete(false)} className="min-h-11 rounded-lg px-4 text-sm font-semibold text-muted hover:bg-white">不删</button></div>
          : <button type="button" onClick={() => setConfirmDelete(true)} className="min-h-11 w-full rounded-lg text-sm font-semibold text-rose-700 hover:bg-rose-50">删掉这条</button>)}
      </div>
    </Sheet>
  );
}

/** 期初余额（只有家长）：零钱、存款各填一个，再设一次就是改 */
function OpeningDialog({ ctx, onClose, onSaved }: { ctx: LedgerContext; onClose: () => void; onSaved: () => void }) {
  const current = (account: LedgerAccount) => ctx.entries.find((entry) => entry.id === `opening-${account}` && !entry.deletedAt);
  const [cash, setCash] = useState(current("cash") ? formatYuan(current("cash")!.amountCents).replace(/,/g, "") : "");
  const [savings, setSavings] = useState(current("savings") ? formatYuan(current("savings")!.amountCents).replace(/,/g, "") : "");
  const [date, setDate] = useState(current("cash")?.date ?? current("savings")?.date ?? ctx.today);
  const [error, setError] = useState("");
  const save = async () => {
    const values = { cash: cash.trim() ? parseYuan(cash) : 0, savings: savings.trim() ? parseYuan(savings) : 0 };
    if (values.cash === null || values.savings === null) { setError("金额最多两位小数"); return; }
    try { await setOpeningBalances({ cash: values.cash, savings: values.savings }, date); onSaved(); } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); }
  };
  return (
    <Sheet title="期初余额" description="开始记账那天，微信零钱和零钱通里各有多少钱。之后的余额都从这里往下算。" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <label className={labelClass}>零钱<input value={cash} onChange={(event) => setCash(event.target.value)} inputMode="decimal" placeholder="0.00" className={`${inputClass} mt-1 tabular-nums`} /></label>
          <label className={labelClass}>存款<input value={savings} onChange={(event) => setSavings(event.target.value)} inputMode="decimal" placeholder="0.00" className={`${inputClass} mt-1 tabular-nums`} /></label>
        </div>
        <label className={labelClass}>日期<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={`${inputClass} mt-1`} /></label>
        {error && <p className="text-[13px] text-rose-700">{error}</p>}
        <button type="button" onClick={() => void save()} className={`${primaryButton} w-full`}>保存</button>
      </div>
    </Sheet>
  );
}

/** 月利率（只有家长）：从这个月起生效，已经过去的月份不变 */
function RateDialog({ ctx, onClose, onSaved }: { ctx: LedgerContext; onClose: () => void; onSaved: () => void }) {
  const month = ctx.today.slice(0, 7) < "2026-12" ? "2026-12" : ctx.today.slice(0, 7);
  const [percent, setPercent] = useState(String(Number((rateForMonth(ctx.settings, month) * 100).toFixed(2))));
  const [error, setError] = useState("");
  const save = async () => {
    const value = Number(percent);
    if (!percent.trim() || !Number.isFinite(value)) { setError("请填写数字"); return; }
    try { await setMonthlyRate(value / 100); onSaved(); } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); }
  };
  return (
    <Sheet title="月利率" description={`从${monthLabel(month)}起按新利率算（${monthLabel(month)}的利息下月 1 日算）；已经过去的月份不变。`} onClose={onClose}>
      <div className="space-y-3">
        <label className={labelClass}>每月<span className="mt-1 flex items-center gap-2"><input value={percent} onChange={(event) => setPercent(event.target.value)} inputMode="decimal" className={`${inputClass} tabular-nums`} /><span className="shrink-0 text-base font-semibold text-muted">%</span></span></label>
        {ctx.settings.rates.length > 0 && <ul className="divide-y divide-ink/[0.07] rounded-lg bg-white px-3 text-[13px]">{[...ctx.settings.rates].reverse().map((change) => <li key={change.from} className="flex justify-between py-2"><span className="text-muted">{change.from.replace("-", " 年 ")} 月起</span><span className="font-semibold tabular-nums text-ink">{formatRate(change.rate)}</span></li>)}</ul>}
        {error && <p className="text-[13px] text-rose-700">{error}</p>}
        <button type="button" onClick={() => void save()} className={`${primaryButton} w-full`}>保存</button>
      </div>
    </Sheet>
  );
}

