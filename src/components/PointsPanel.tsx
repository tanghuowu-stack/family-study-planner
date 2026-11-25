import { ChevronRight, PiggyBank, Star, Wallet } from "lucide-react";
import { useState, type ReactNode } from "react";
import { addBonus, revokeBonus, type PointsContext } from "../data/pointsService";
import { formatCompactDate, getWeekStartKey, todayKey } from "../utils/date";
import { practiceVerb, SETTLE_HOUR, type BonusEntry, type PracticeWeekScore } from "../utils/points";
import { formatYuan, type Balances } from "../utils/ledger";
import { isParentDevice } from "../utils/device";
import { Sheet } from "./Sheet";

const signed = (value: number) => (value > 0 ? `+${value}` : `${value}`);
const weekLabel = (weekStart: string) => `${formatCompactDate(weekStart)}这周`;
const primaryButton = "min-h-11 rounded-lg bg-primary px-4 text-sm font-bold text-white disabled:opacity-40";
const quietButton = "min-h-10 rounded-lg bg-white px-3 text-sm font-semibold text-primary ring-1 ring-inset ring-primary/30 disabled:opacity-40";

/** 一项练习的灰色小字："N 分"；超出目标但不计分的再加"多读了 N 本" */
export function practiceScoreLabels(score?: PracticeWeekScore): { points: string; extra?: string } | undefined {
  if (!score) return undefined;
  return { points: `已得 ${score.total} 分`, extra: score.extraCount > 0 && !score.extraScores ? `本周多${practiceVerb(score.title)}了 ${score.extraCount} ${score.unit}` : undefined };
}

/**
 * 周日晚上（8 点结算后）到周一：积分条下方显示一周小结，点一下收起（只记在本机）。
 * "上周 N 分，挣了 N 元，M 项达标。"——元取结算快照里固定的零花钱。周日晚上那一周还没过完，说"这周"。
 */
export function weekSummaryFor(ctx: PointsContext, now: Date): { key: string; text: string } | null {
  const day = now.getDay();
  const today = todayKey();
  const history = ctx.summary.history;
  if (day === 0 && now.getHours() >= SETTLE_HOUR) {
    const week = history[history.length - 1];
    if (!week) return null;
    return { key: week.weekStart, text: `这周 ${week.total} 分，挣了 ${week.allowance} 元，${week.reachedCount} 项达标。` };
  }
  if (day === 1) {
    const last = history[history.length - 2];
    if (!last || last.weekStart >= getWeekStartKey(today)) return null;
    return { key: last.weekStart, text: `上周 ${last.total} 分，挣了 ${last.allowance} 元，${last.reachedCount} 项达标。` };
  }
  return null;
}

const SUMMARY_DISMISS_KEY = "points_week_summary_dismissed";

/** 今日页两栏上方的积分条：本周 N 分（= N 元）｜ 零钱 x 元 ｜ 存款 y 元（docs/TASK_09_points.md §9.1） */
export function PointsBar({ ctx, balances, onChanged, onOpenLedger }: { ctx: PointsContext; balances: Balances | null; onChanged: () => void; onOpenLedger: () => void }) {
  const [detail, setDetail] = useState(false);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(SUMMARY_DISMISS_KEY) ?? "");
  const { summary } = ctx;
  const weekSummary = weekSummaryFor(ctx, new Date());
  const showSummary = !!weekSummary && dismissed !== weekSummary.key;
  // 2026-11-25 用户：原来一行字“本周 N 分｜零钱｜存款”太死板 → 三张小卡片：本周积分（实心主色底、白字大数字，同记账页总资产卡）、零钱、存款（点进记账页）
  const tile = "group flex min-h-[4.5rem] min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors sm:min-h-20 sm:px-4";
  const icon = (Icon: typeof Star, bg: string, fg: string) => (
    <span aria-hidden className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full sm:flex" style={{ background: bg, color: fg }}><Icon className="h-5 w-5" strokeWidth={2.25} /></span>
  );
  const money = (label: string, note: string, cents: number | undefined, Icon: typeof Star, color: string) => (
    <button type="button" onClick={onOpenLedger} className={`${tile} border-ink/10 bg-white hover:border-ink/20 hover:bg-stone-50`} data-testid={`bar-${label}`}>
      {icon(Icon, `${color}1A`, color)}
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium leading-4 text-muted">{label}<span className="hidden lg:inline"> · {note}</span></span>
        <span className="mt-1 block truncate leading-7 text-ink"><span className="text-[20px] font-bold tabular-nums sm:text-[22px]">{cents === undefined ? "–" : formatYuan(cents)}</span> <span className="text-[13px] text-muted">元</span></span>
      </span>
      <ChevronRight aria-hidden className="hidden h-4 w-4 shrink-0 text-stone-300 group-hover:text-muted sm:block" />
    </button>
  );
  return (
    <section aria-label="积分与零花钱" className="mb-4">
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <button type="button" onClick={() => setDetail(true)} className={`${tile} border-primary bg-primary shadow-[0_8px_20px_-12px_rgba(43,118,86,0.7)] hover:bg-[#256a4d]`} data-testid="bar-points">
          {icon(Star, "rgba(255,255,255,0.16)", "#EFC66A")}
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium leading-4 text-white/75">本周积分</span>
            <span className="mt-1 block truncate leading-7 text-white"><span className="text-[24px] font-bold tabular-nums sm:text-[26px]">{summary.weekTotal}</span> <span className="text-[13px] font-semibold">分</span><span className="ml-1.5 hidden text-[13px] font-medium text-white/75 sm:inline">= {summary.weekAllowance} 元</span></span>
          </span>
          <ChevronRight aria-hidden className="hidden h-4 w-4 shrink-0 text-white/50 group-hover:text-white sm:block" />
        </button>
        {money("零钱", "可以自由花", balances?.cash, Wallet, "#2B7656")}
        {money("存款", "零钱通", balances?.savings, PiggyBank, "#3F8F86")}
      </div>
      {showSummary && weekSummary && (
        <button type="button" onClick={() => { localStorage.setItem(SUMMARY_DISMISS_KEY, weekSummary.key); setDismissed(weekSummary.key); }}
          className="mt-2 flex w-full items-center gap-2 rounded-lg border border-sun/50 bg-sun/15 px-3 py-2 text-left text-[13px] font-medium leading-5 text-ink/85 hover:bg-sun/25 sm:px-4" title="点一下收起">
          <span aria-hidden>🎉</span>{weekSummary.text}
        </button>
      )}
      {detail && <PointsDetailDialog ctx={ctx} onClose={() => setDetail(false)} />}
    </section>
  );
}

/**
 * 每周练习最下面一行：家长奖励 +N；本周有提前完成的作业时右边"提前完成 +N"（2026-11-25 起自动加，不再有"待处理"）。
 * iPad / 手机上只显示，点击无反应；Mac 上点击打开家长奖励对话框（docs/TASK_09_points.md §7、§9.4）。
 */
export function ParentBonusRow({ ctx, onChanged }: { ctx: PointsContext; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const early = ctx.summary.weekEarly;
  const content = (
    <>
      <span>家长奖励 <span className="tabular-nums text-ink">{signed(ctx.summary.weekBonus)}</span></span>
      {early > 0 && <span className="ml-auto text-primary">提前完成 <span className="tabular-nums">+{early}</span></span>}
    </>
  );
  const rowClass = "flex min-h-11 w-full items-center gap-3 border-t border-ink/[0.07] px-3 text-left text-[13px] font-semibold text-muted sm:px-4";
  if (!isParentDevice()) return <div className={rowClass} data-testid="parent-bonus-row">{content}</div>;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${rowClass} hover:bg-stone-50`} data-testid="parent-bonus-row">{content}</button>
      {open && <ParentBonusDialog ctx={ctx} onClose={() => setOpen(false)} onChanged={onChanged} />}
    </>
  );
}

function BonusLine({ bonus, action }: { bonus: BonusEntry; action?: ReactNode }) {
  return (
    <li className={`flex items-start gap-3 py-2 text-sm ${bonus.revokedAt ? "text-stone-400" : "text-ink"}`}>
      <span className={`w-10 shrink-0 font-bold tabular-nums ${bonus.revokedAt ? "line-through" : ""}`}>{signed(bonus.points)}</span>
      <span className="min-w-0 flex-1"><span className={bonus.revokedAt ? "line-through" : ""}>{bonus.reason}</span><span className="block text-[13px] text-muted">{formatCompactDate(bonus.date)}{bonus.revokedAt ? " · 已撤回" : ""}</span></span>
      {action}
    </li>
  );
}

/** 家长奖励：加 / 减分（必须写原因）、撤回本周的某一笔；本周提前完成的作业（自动 +3）列在下面看 */
function ParentBonusDialog({ ctx, onClose, onChanged }: { ctx: PointsContext; onClose: () => void; onChanged: () => void }) {
  const [sign, setSign] = useState<1 | -1>(1);
  const [amount, setAmount] = useState(1);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<unknown>) => {
    setError("");
    setBusy(true);
    try { await work(); onChanged(); } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败，请重试"); } finally { setBusy(false); }
  };
  const segment = (active: boolean) => `min-h-10 rounded-lg px-3 text-sm font-semibold ${active ? "bg-primary text-white" : "bg-white text-muted ring-1 ring-inset ring-ink/10"}`;
  return (
    <Sheet wide title="家长奖励" description="加分、减分都要写原因；记错了可以撤回。1 分 = 1 元，算进本周零花钱。" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex gap-1.5"><button type="button" className={segment(sign === 1)} onClick={() => setSign(1)}>加分</button><button type="button" className={segment(sign === -1)} onClick={() => setSign(-1)}>减分</button></div>
          <div className="inline-flex items-center rounded-lg bg-white ring-1 ring-inset ring-ink/10">
            <button type="button" aria-label="少 1 分" disabled={amount <= 1} onClick={() => setAmount(Math.max(1, amount - 1))} className="flex h-10 w-10 items-center justify-center text-lg font-semibold text-muted disabled:opacity-30">−</button>
            <span className="w-8 text-center text-base font-bold tabular-nums">{amount}</span>
            <button type="button" aria-label="多 1 分" disabled={amount >= 50} onClick={() => setAmount(Math.min(50, amount + 1))} className="flex h-10 w-10 items-center justify-center text-lg font-semibold text-muted disabled:opacity-30">+</button>
          </div>
          <span className="text-sm text-muted">分</span>
        </div>
        <label className="block text-[13px] font-semibold text-muted">原因<input value={reason} maxLength={60} onChange={(event) => setReason(event.target.value)} placeholder={sign === 1 ? "例如：主动整理书包" : "例如：练琴时间不够"} className="mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus:border-primary" /></label>
        <button type="button" className={`${primaryButton} w-full`} disabled={!reason.trim() || busy} onClick={() => run(async () => { await addBonus(sign * amount, reason); setReason(""); setAmount(1); })}>{sign === 1 ? "加" : "减"} {amount} 分</button>
        {error && <p className="text-[13px] text-rose-700">{error}</p>}
      </div>

      {ctx.summary.weekEarlyItems.length > 0 && (
        <div className="mt-5 border-t border-ink/10 pt-4">
          <h4 className="text-sm font-bold text-ink">本周提前完成（每项自动 +3）</h4>
          <ul className="mt-1 divide-y divide-ink/[0.07]">
            {ctx.summary.weekEarlyItems.map((item) => (
              <li key={item.taskId} className="flex items-center gap-3 py-2 text-sm text-ink">
                <span className="w-10 shrink-0 font-bold tabular-nums text-primary">+{item.points}</span>
                <span className="min-w-0 flex-1">{item.title}<span className="block text-[13px] text-muted">{formatCompactDate(item.completedDate)}做完 · {formatCompactDate(item.endDate)}截止</span></span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[13px] text-muted">检查发现没做好，可以在今日页把这项取消勾选（3 分自动去掉），或在上面减分。</p>
        </div>
      )}

      <div className="mt-5 border-t border-ink/10 pt-4">
        <h4 className="text-sm font-bold text-ink">本周的奖励</h4>
        {ctx.summary.weekBonuses.length === 0 ? <p className="mt-1 text-sm text-muted">还没有。</p> : (
          <ul className="mt-1 divide-y divide-ink/[0.07]">{ctx.summary.weekBonuses.map((bonus) => <BonusLine key={bonus.id} bonus={bonus} action={!bonus.revokedAt && <button type="button" disabled={busy} onClick={() => run(() => revokeBonus(bonus.id))} className="min-h-9 shrink-0 rounded-lg px-2 text-[13px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-40">撤回</button>} />)}</ul>
        )}
      </div>
    </Sheet>
  );
}

/** 积分明细：本周每项（完成分 / 达标奖励 / 多做分）、家长奖励、以前每周的得分和零花钱 */
function PointsDetailDialog({ ctx, onClose }: { ctx: PointsContext; onClose: () => void }) {
  const { summary } = ctx;
  const past = [...summary.history].reverse().filter((week) => week.weekStart !== summary.weekStart);
  const th = "py-1.5 text-right text-[13px] font-semibold text-muted";
  const td = "py-1.5 text-right tabular-nums";
  return (
    <Sheet wide title="积分明细" description="1 分 = 1 元。每周日晚上 8 点结算，这周的得分（练习 + 提前完成 + 家长奖励，不低于 0）就是这周的零花钱。" onClose={onClose}>
      <h4 className="text-sm font-bold text-ink">本周 {summary.weekTotal} 分 · {summary.weekAllowance} 元</h4>
      <table className="mt-1 w-full text-sm">
        <thead><tr><th className="py-1.5 text-left text-[13px] font-semibold text-muted">练习</th><th className={th}>完成</th><th className={th}>达标</th><th className={th}>多做</th><th className={th}>合计</th></tr></thead>
        <tbody className="divide-y divide-ink/[0.07]">
          {summary.weekScores.map((score) => (
            <tr key={score.taskId}>
              <td className="py-1.5 pr-2"><span className="text-ink">{score.title}</span><span className="block text-[13px] text-muted">{score.count}/{score.target} {score.unit} · 每{score.unit === "次" ? "次" : score.unit} {score.points} 分{score.extraScores ? "" : " · 多做不计分"}</span></td>
              <td className={td}>{score.completionPoints}</td><td className={td}>{score.reachBonus || "–"}</td><td className={td}>{score.extraScores ? score.extraPoints || "–" : score.extraCount ? `多${score.extraCount}` : "–"}</td><td className={`${td} font-bold`}>{score.total}</td>
            </tr>
          ))}
          <tr><td className="py-1.5 pr-2 text-ink">提前完成（每项 +3）</td><td /><td /><td /><td className={`${td} font-bold`}>{signed(summary.weekEarly)}</td></tr>
          <tr><td className="py-1.5 pr-2 text-ink">家长奖励</td><td /><td /><td /><td className={`${td} font-bold`}>{signed(summary.weekBonus)}</td></tr>
        </tbody>
      </table>
      {summary.weekBonuses.length > 0 && <ul className="mt-2 divide-y divide-ink/[0.07] rounded-lg bg-white px-3">{summary.weekBonuses.map((bonus) => <BonusLine key={bonus.id} bonus={bonus} />)}</ul>}

      <h4 className="mt-5 text-sm font-bold text-ink">以前每周</h4>
      {past.length === 0 ? <p className="mt-1 text-sm text-muted">这是积分的第一周。</p> : (
        <table className="mt-1 w-full text-sm"><thead><tr><th className="py-1.5 text-left text-[13px] font-semibold text-muted">周</th><th className={th}>练习</th><th className={th}>奖励</th><th className={th}>合计</th><th className={th}>零花钱</th></tr></thead>
          <tbody className="divide-y divide-ink/[0.07]">{past.map((week) => <tr key={week.weekStart}><td className="py-1.5 text-ink">{weekLabel(week.weekStart)}<span className="block text-[13px] text-muted">{week.reachedCount} 项达标</span></td><td className={td}>{week.practice}</td><td className={td}>{signed(week.bonus + week.early)}</td><td className={`${td} font-bold`}>{week.total}</td><td className={`${td} font-bold`}>{week.allowance} 元</td></tr>)}</tbody>
        </table>
      )}
    </Sheet>
  );
}
