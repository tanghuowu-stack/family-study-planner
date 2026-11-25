import { useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties } from "react";
import {
  ArrowDownToLine, ArrowUpFromLine, Award, BookOpen, ChevronDown, Ellipsis, Flag, Gift, PencilLine, PiggyBank, Plus, Puzzle, Receipt, Scale, TrendingUp, Utensils,
} from "lucide-react";
import { Sheet } from "../components/Sheet";
import { loadPointsContext, settlePendingWeeks } from "../data/pointsService";
import {
  addReconcileAdjustments, confirmTransfer, deleteLedgerEntry, loadLedgerContext, saveLedgerEntry, setMonthlyRate, setOpeningBalances, type LedgerContext,
} from "../data/ledgerService";
import { formatCompactDate, formatLongDate } from "../utils/date";
import { isParentDevice } from "../utils/device";
import {
  ACCOUNT_LABEL, activeEntries, canModifyEntry, EXPENSE_CATEGORIES, entryEffect, formatRate, formatYuan, LEDGER_TYPE_LABEL, monthLabel, monthOf, monthSummary, parseYuan,
  rateForMonth, reconcileDiff, type ExpenseCategory, type LedgerAccount, type LedgerEntry, type LedgerType, type MonthSummary,
} from "../utils/ledger";

/**
 * 记账页（TASK_10，docs/TASK_10_ledger.md）。版式参照常见记账软件（2026-11-24 用户要求“更专业”）：
 * 顶部总资产卡（零钱 + 存款）→ 本月收入 / 支出 / 结余 → 三个快捷记账按钮 → 待转账 →
 * 按月分组的流水（每月表头带当月收支；过完的月份默认收起，点开再看）+ 右栏本月支出构成（环形图）与和微信对账。
 * 孩子（iPad）能记支出、存进存款、从存款取出，只能改删当天自己记的；家长（Mac）还能确认转账、设期初余额、对账调整、改利率。
 */

const primaryButton = "min-h-11 rounded-lg bg-primary px-4 text-sm font-bold text-white disabled:opacity-40";
const inputClass = "min-h-11 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-base text-ink outline-none focus:border-primary";
const labelClass = "block text-[13px] font-semibold text-muted";

type IconType = ComponentType<{ className?: string; strokeWidth?: number; style?: CSSProperties }>;

/** 支出分类的图标和颜色（色值取自学科色点一系的柔和色，只用在 36px 圆形图标和构成图上） */
export const CATEGORY_META: Record<ExpenseCategory, { icon: IconType; color: string }> = {
  吃的: { icon: Utensils, color: "#E0883A" },
  文具: { icon: PencilLine, color: "#5868C8" },
  书: { icon: BookOpen, color: "#9364C7" },
  玩具: { icon: Puzzle, color: "#D96A52" },
  礼物: { icon: Gift, color: "#C9567D" },
  其他: { icon: Ellipsis, color: "#8A948F" },
};

const TYPE_META: Record<Exclude<LedgerType, "expense">, { icon: IconType; color: string }> = {
  allowance: { icon: Award, color: "#2B7656" },
  interest: { icon: TrendingUp, color: "#2B7656" },
  deposit: { icon: PiggyBank, color: "#3F8F86" },
  withdraw: { icon: ArrowUpFromLine, color: "#3F8F86" },
  opening: { icon: Flag, color: "#6E7772" },
  adjust: { icon: Scale, color: "#6E7772" },
};

function entryMeta(entry: LedgerEntry) {
  return entry.type === "expense" ? CATEGORY_META[entry.category ?? "其他"] : TYPE_META[entry.type];
}

/** 36px 圆形图标：浅色底 + 同色图标 */
function EntryIcon({ icon: Icon, color, size = "h-9 w-9" }: { icon: IconType; color: string; size?: string }) {
  return (
    <span aria-hidden className={`flex shrink-0 items-center justify-center rounded-full ${size}`} style={{ backgroundColor: `${color}1A`, color }}>
      <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
    </span>
  );
}

/** 列表里显示的金额：变多带“+”、变少带“−”，收入用主色；存取款是自己账户之间挪，不带符号 */
function amountDisplay(entry: LedgerEntry): { text: string; tone: string; note: string } {
  if (entry.type === "deposit") return { text: formatYuan(entry.amountCents), tone: "text-ink", note: "零钱 → 存款" };
  if (entry.type === "withdraw") return { text: formatYuan(entry.amountCents), tone: "text-ink", note: "存款 → 零钱" };
  const effect = entryEffect(entry);
  const account: LedgerAccount = effect.savings !== 0 && effect.cash === 0 ? "savings" : "cash";
  const cents = account === "savings" ? effect.savings : effect.cash;
  // 绿色只给真正的收入（练习奖励、利息）；期初余额、对账调整不算收入，用正文色
  const income = entry.type === "allowance" || entry.type === "interest";
  return { text: cents > 0 ? `+${formatYuan(cents)}` : formatYuan(cents), tone: income ? "text-primary" : "text-ink", note: ACCOUNT_LABEL[account] };
}

function entryTitle(entry: LedgerEntry): string {
  if (entry.type === "expense") return entry.content || "支出";
  if (entry.type === "adjust") return `对账调整 · ${ACCOUNT_LABEL[entry.account ?? "cash"]}`;
  if (entry.type === "opening") return `期初余额 · ${ACCOUNT_LABEL[entry.account ?? "cash"]}`;
  if (entry.type === "allowance") return entry.content || "练习奖励";
  return LEDGER_TYPE_LABEL[entry.type];
}

function entrySubtitle(entry: LedgerEntry): string | undefined {
  if (entry.type === "expense") return entry.category ?? "其他";
  if (entry.type === "allowance") return "练习奖励";
  if (entry.type === "interest" || entry.type === "adjust") return entry.content;
  if ((entry.type === "deposit" || entry.type === "withdraw") && entry.content) return entry.content;
  return undefined;
}

const yearMonthLabel = (month: string) => `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;

type Editor = { mode: "new"; type: LedgerType } | { mode: "edit"; entry: LedgerEntry };

export function LedgerPage({ refreshKey, onChanged, notify }: { refreshKey: number; onChanged: () => void; notify: (message: string) => void }) {
  const [ctx, setCtx] = useState<LedgerContext | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [dialog, setDialog] = useState<"opening" | "rate" | null>(null);
  // 每个月的流水展开 / 收起；没点过的按默认：这个月（及以后）展开，过完的月份收起
  const [openMonths, setOpenMonths] = useState<Record<string, boolean>>({});
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

  const months = useMemo(() => {
    if (!ctx) return [];
    const sorted = activeEntries(ctx.entries).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    const byMonth = new Map<string, Map<string, LedgerEntry[]>>();
    sorted.forEach((entry) => {
      const days = byMonth.get(monthOf(entry.date)) ?? new Map<string, LedgerEntry[]>();
      days.set(entry.date, [...(days.get(entry.date) ?? []), entry]);
      byMonth.set(monthOf(entry.date), days);
    });
    return [...byMonth.entries()].map(([month, days]) => ({ month, days: [...days.entries()], count: [...days.values()].reduce((sum, items) => sum + items.length, 0), summary: monthSummary(ctx.entries, month) }));
  }, [ctx]);

  if (!ctx) return <main className="mx-auto w-full max-w-5xl px-3 pb-content pt-3 sm:px-7 sm:pt-6 lg:px-10"><header className="page-header"><h1 className="page-title">记账</h1></header></main>;

  const { balances, month, projected, pending, today } = ctx;
  const currentMonth = monthOf(today);
  const rateNow = rateForMonth(ctx.settings, currentMonth < "2026-12" ? "2026-12" : currentMonth);
  const isOpen = (value: string) => openMonths[value] ?? value >= currentMonth;
  const net = month.incomeCents - month.expenseCents;

  const transfer = async (id: string) => {
    setBusyTransfer(id);
    try { await confirmTransfer(id); changed("已入账"); } catch (error) { notify(error instanceof Error ? error.message : "入账失败，请重试"); } finally { setBusyTransfer(""); }
  };

  const quick: { type: LedgerType; label: string; icon: IconType; color: string }[] = [
    { type: "expense", label: "记一笔支出", icon: Receipt, color: "#E36B4E" },
    { type: "deposit", label: "存进存款", icon: ArrowDownToLine, color: "#3F8F86" },
    { type: "withdraw", label: "从存款取出", icon: ArrowUpFromLine, color: "#3F8F86" },
  ];

  return (
    <main className="mx-auto w-full max-w-5xl px-3 pb-content pt-3 sm:px-7 sm:pt-6 lg:px-10">
      <header className="page-header">
        <h1 className="page-title">记账</h1>
        {parent && <div className="flex items-center gap-2">
          <button type="button" onClick={() => setDialog("opening")} className="min-h-11 rounded-lg border border-ink/10 bg-white px-3 text-sm font-semibold text-muted hover:text-ink">期初余额</button>
          <button type="button" onClick={() => setDialog("rate")} className="min-h-11 rounded-lg border border-ink/10 bg-white px-3 text-sm font-semibold text-muted hover:text-ink">月利率 {formatRate(rateNow)}</button>
        </div>}
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="min-w-0 space-y-4">
          {/* 总资产卡：零钱 + 存款 */}
          <section aria-label="余额" className="overflow-hidden rounded-lg bg-primary text-white shadow-sm">
            <div className="px-5 pb-4 pt-5">
              <p className="text-[13px] font-semibold text-white/70">总资产（元）</p>
              <p className="mt-1 text-[34px] font-bold leading-10 tabular-nums tracking-tight" data-testid="ledger-total">{formatYuan(balances.cash + balances.savings)}</p>
            </div>
            <div className="grid grid-cols-2 border-t border-white/15">
              <div className="border-r border-white/15 px-5 py-3.5">
                <p className="flex items-center gap-1.5 text-[13px] font-semibold text-white/70"><span aria-hidden className="h-2 w-2 rounded-full bg-white" />零钱 · 可以自由花</p>
                <p className="mt-0.5 text-[22px] font-bold leading-8 tabular-nums" data-testid="ledger-cash">{formatYuan(balances.cash)}</p>
              </div>
              <div className="px-5 py-3.5">
                <p className="flex items-center gap-1.5 text-[13px] font-semibold text-white/70"><span aria-hidden className="h-2 w-2 rounded-full bg-sun" />存款 · 零钱通</p>
                <p className="mt-0.5 text-[22px] font-bold leading-8 tabular-nums" data-testid="ledger-savings">{formatYuan(balances.savings)}</p>
              </div>
            </div>
            <p className="border-t border-white/15 bg-black/10 px-5 py-2.5 text-[13px] leading-5 text-white/90" data-testid="projected-interest">
              {projected ? <>这个月不取钱的话，下月 1 日能拿到 <span className="font-bold tabular-nums text-sun">{formatYuan(projected.cents)}</span> 元利息</> : "每月 1 日结算上个月的利息"}
            </p>
          </section>

          {/* 本月收入 / 支出 / 结余 */}
          <section aria-label="本月收支" className="surface grid grid-cols-3 divide-x divide-ink/[0.07]">
            {[
              { label: `${monthLabel(month.month)}收入`, text: formatYuan(month.incomeCents), tone: "text-primary" },
              { label: `${monthLabel(month.month)}支出`, text: formatYuan(month.expenseCents), tone: "text-ink" },
              { label: `${monthLabel(month.month)}结余`, text: formatYuan(net), tone: net < 0 ? "text-alert" : "text-ink" },
            ].map((item) => (
              <div key={item.label} className="px-3 py-3 sm:px-4">
                <p className="text-[13px] text-muted">{item.label}</p>
                <p className={`mt-0.5 text-lg font-bold tabular-nums sm:text-xl ${item.tone}`}>{item.text}</p>
              </div>
            ))}
          </section>

          {/* 快捷记账（2026-11-25 用户：“记一笔支出”要更突出、更大——记账先按它）：
              支出是一个实心大按钮（手机占满一行），存进 / 取出是旁边两个次级按钮 */}
          <section aria-label="记一笔" className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] sm:gap-3">
            <button type="button" onClick={() => setEditor({ mode: "new", type: "expense" })} data-testid="add-expense"
              className="col-span-2 flex min-h-[4.5rem] items-center gap-3 rounded-lg bg-alert px-4 text-left text-white shadow-[0_10px_24px_-12px_rgba(227,107,78,0.9)] transition-colors hover:bg-[#cf5b40] active:scale-[0.99] sm:col-span-1 sm:min-h-[5.5rem] sm:px-5">
              <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/20"><Plus className="h-6 w-6" strokeWidth={2.5} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[18px] font-bold leading-6">记一笔支出</span>
                <span className="block truncate text-[13px] text-white/80">零钱 {formatYuan(balances.cash)} 元 · 买了什么就记一笔</span>
              </span>
              <Receipt aria-hidden className="hidden h-7 w-7 shrink-0 text-white/50 sm:block" />
            </button>
            {quick.filter((item) => item.type !== "expense").map((item) => (
              <button key={item.type} type="button" onClick={() => setEditor({ mode: "new", type: item.type })} className="surface flex min-h-16 items-center justify-center gap-2.5 px-2 py-2 text-[15px] font-semibold text-ink hover:bg-stone-50 sm:min-h-[5.5rem] sm:flex-col sm:gap-1.5">
                <EntryIcon icon={item.icon} color={item.color} />
                {item.label}
              </button>
            ))}
          </section>

          {pending.length > 0 && (
            <section aria-label="待转账" className="surface border-sun/70">
              <div className="flex items-center justify-between gap-3 border-b border-ink/[0.07] bg-sun/15 px-4 py-2.5"><h2 className="text-base font-bold text-ink">待转账</h2><span className="text-right text-[13px] text-muted">{parent ? "转好以后点“已转账”入账" : "妈妈转好后点“已转账”就会记上"}</span></div>
              <ul className="divide-y divide-ink/[0.07]">
                {pending.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 px-4 py-3" data-testid="pending-transfer">
                    <EntryIcon icon={item.type === "interest" ? TrendingUp : Award} color="#2B7656" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold text-ink">{item.title}</p>
                      <p className="truncate text-[13px] text-muted">{item.detail ?? "转到零钱"}</p>
                    </div>
                    <span className="shrink-0 text-base font-bold tabular-nums text-primary">+{formatYuan(item.amountCents)}</span>
                    {parent ? <button type="button" disabled={busyTransfer === item.id} onClick={() => void transfer(item.id)} className={primaryButton}>已转账</button>
                      : <span className="shrink-0 rounded-md bg-stone-100 px-2 py-1 text-[13px] text-muted">等转账</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 流水：按月分组，过完的月份默认收起 */}
          <section aria-label="记录" className="surface overflow-hidden">
            <div className="flex items-center justify-between border-b border-ink/10 px-4 py-3"><h2 className="text-base font-bold text-ink">流水</h2><span className="text-[13px] tabular-nums text-muted">{months.reduce((sum, item) => sum + item.count, 0)} 笔</span></div>
            {months.length === 0 ? <p className="px-4 py-8 text-center text-[15px] text-muted">还没有记录。{parent ? "可以先在右上角设好期初余额。" : ""}</p> : months.map((group) => {
              const open = isOpen(group.month);
              return (
                <div key={group.month} className="border-b border-ink/[0.07] last:border-b-0" data-testid="ledger-month">
                  <button type="button" aria-expanded={open} onClick={() => setOpenMonths((current) => ({ ...current, [group.month]: !open }))}
                    className="flex min-h-12 w-full items-center gap-3 bg-stone-50/80 px-4 py-2 text-left hover:bg-stone-100/70">
                    <ChevronDown aria-hidden className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`} />
                    <span className="text-[15px] font-bold text-ink">{yearMonthLabel(group.month)}</span>
                    {!open && <span className="text-[13px] text-muted">{group.count} 笔</span>}
                    <span className="ml-auto flex shrink-0 gap-3 text-[13px] tabular-nums text-muted">
                      <span>收入 <span className="font-semibold text-primary">{formatYuan(group.summary.incomeCents)}</span></span>
                      <span>支出 <span className="font-semibold text-ink">{formatYuan(group.summary.expenseCents)}</span></span>
                    </span>
                  </button>
                  {open && group.days.map(([date, items]) => {
                    const dayExpense = items.filter((entry) => entry.type === "expense").reduce((sum, entry) => sum + entry.amountCents, 0);
                    return (
                      <div key={date}>
                        <p className="flex items-center justify-between border-t border-ink/[0.05] px-4 pb-1 pt-2.5 text-[13px] text-muted">
                          <span className="font-semibold">{formatLongDate(date).replace("星期", "周")}{date === today ? " · 今天" : ""}</span>
                          {dayExpense > 0 && <span className="tabular-nums">支出 {formatYuan(dayExpense)}</span>}
                        </p>
                        <ul>
                          {items.map((entry) => {
                            const meta = entryMeta(entry);
                            const amount = amountDisplay(entry);
                            const subtitle = entrySubtitle(entry);
                            const editable = canModifyEntry(entry, parent, today);
                            const body = (
                              <>
                                <EntryIcon icon={meta.icon} color={meta.color} />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[15px] font-semibold text-ink">{entryTitle(entry)}</span>
                                  {subtitle && <span className="block truncate text-[13px] text-muted">{subtitle}</span>}
                                </span>
                                <span className="shrink-0 text-right">
                                  <span className={`block text-base font-bold tabular-nums ${amount.tone}`}>{amount.text}</span>
                                  <span className="block text-[13px] text-muted">{amount.note}</span>
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
                    );
                  })}
                </div>
              );
            })}
          </section>
        </div>

        <div className="space-y-4">
          <ExpenseBreakdown summary={month} />
          <ReconcileCard ctx={ctx} parent={parent} onDone={(count) => changed(`已生成 ${count} 条对账调整`)} />
        </div>
      </div>

      {editor && <EntryDialog ctx={ctx} editor={editor} parent={parent} onClose={() => setEditor(null)} onSaved={(message) => { setEditor(null); changed(message); }} />}
      {dialog === "opening" && <OpeningDialog ctx={ctx} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); changed("期初余额已保存"); }} />}
      {dialog === "rate" && <RateDialog ctx={ctx} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); changed("月利率已保存"); }} />}
    </main>
  );
}

/** 本月支出构成：环形图 + 分类列表（图标、占比、金额） */
function ExpenseBreakdown({ summary }: { summary: MonthSummary }) {
  const total = summary.expenseCents;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <section aria-label="本月支出构成" className="surface">
      <div className="border-b border-ink/10 px-4 py-3"><h2 className="text-base font-bold text-ink">{monthLabel(summary.month)}支出构成</h2></div>
      {total === 0 ? <p className="px-4 py-6 text-center text-[13px] text-muted">这个月还没有支出。</p> : (
        <div className="px-4 py-4">
          <div className="relative mx-auto h-36 w-36">
            <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden>
              <circle cx="50" cy="50" r={radius} fill="none" stroke="#EEECE7" strokeWidth="12" />
              {summary.byCategory.map((item) => {
                const length = (item.cents / total) * circumference;
                const dash = <circle key={item.category} cx="50" cy="50" r={radius} fill="none" stroke={CATEGORY_META[item.category].color} strokeWidth="12" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} />;
                offset += length;
                return dash;
              })}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[13px] text-muted">支出</span>
              <span className="text-lg font-bold tabular-nums text-ink">{formatYuan(total)}</span>
            </div>
          </div>
          <ul className="mt-4 space-y-2.5">
            {summary.byCategory.map((item) => (
              <li key={item.category} className="flex items-center gap-3">
                <EntryIcon icon={CATEGORY_META[item.category].icon} color={CATEGORY_META[item.category].color} size="h-8 w-8" />
                <span className="min-w-0 flex-1 text-sm text-ink">{item.category}<span className="ml-2 text-[13px] tabular-nums text-muted">{Math.round((item.cents / total) * 100)}%</span></span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{formatYuan(item.cents)}</span>
              </li>
            ))}
          </ul>
        </div>
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
  // 支出后零钱变成负数时提示一下（允许记，TASK_10 §4.1）；改旧记录时先把它原来的金额加回来
  const cashBefore = ctx.balances.cash + (existing && existing.type === "expense" && !existing.deletedAt ? existing.amountCents : 0);
  const overdraw = type === "expense" && cents !== null && cents > 0 && cashBefore - cents < 0 ? cashBefore - cents : null;
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
            <div className="mt-1 grid grid-cols-3 gap-1.5">{EXPENSE_CATEGORIES.map((item) => {
              const { icon: Icon, color } = CATEGORY_META[item];
              const selected = category === item;
              return <button key={item} type="button" aria-pressed={selected} onClick={() => setCategory(item)}
                className={`flex min-h-12 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold ${selected ? "text-ink" : "bg-white text-ink ring-1 ring-inset ring-ink/10 hover:bg-stone-50"}`}
                style={selected ? { boxShadow: `inset 0 0 0 2px ${color}`, backgroundColor: `${color}14` } : undefined}>
                <Icon className="h-4 w-4" strokeWidth={2} style={{ color }} />{item}
              </button>;
            })}</div>
          </fieldset>
        </>}
        {(type === "deposit" || type === "withdraw" || type === "allowance" || type === "interest") && <label className={labelClass}>备注（可以不写）<input value={content} maxLength={60} onChange={(event) => setContent(event.target.value)} className={`${inputClass} mt-1`} /></label>}
        {accountChoice && <fieldset><legend className={labelClass}>账户</legend><div className="mt-1 inline-flex gap-1.5">{(["cash", "savings"] as LedgerAccount[]).map((item) => <button key={item} type="button" onClick={() => setAccount(item)} className={`min-h-11 rounded-lg px-4 text-sm font-semibold ${account === item ? "bg-primary text-white" : "bg-white text-muted ring-1 ring-inset ring-ink/10"}`}>{ACCOUNT_LABEL[item]}</button>)}</div></fieldset>}
        {type === "adjust" && <label className={labelClass}>原因<input value={content} maxLength={60} onChange={(event) => setContent(event.target.value)} className={`${inputClass} mt-1`} /></label>}
        {editableDate ? <label className={labelClass}>日期<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={`${inputClass} mt-1`} /></label>
          : <p className="text-[13px] text-muted">记在今天（{formatCompactDate(ctx.today)}）</p>}
        {overdraw !== null && <p data-testid="overdraw-note" className="rounded-lg bg-sun/20 px-3 py-2 text-[13px] leading-5 text-amber-900">零钱只有 {formatYuan(cashBefore)} 元，记下后零钱是 <span className="font-bold">{formatYuan(overdraw)}</span> 元；以后挣的零花钱会先把它补上。</p>}
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

