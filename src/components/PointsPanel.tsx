import { useState, type ReactNode } from "react";
import { addBonus, addWish, confirmWish, deleteWish, redeemWish, revokeBonus, skipEarly, type PointsContext } from "../data/pointsService";
import { formatCompactDate, getWeekStartKey, todayKey } from "../utils/date";
import { POINTS_PER_FLOWER, practiceVerb, type BonusEntry, type PracticeWeekScore, type Wish } from "../utils/points";
import { isParentDevice } from "../utils/device";
import { Sheet } from "./Sheet";

const signed = (value: number) => (value > 0 ? `+${value}` : `${value}`);
const weekLabel = (weekStart: string) => `${formatCompactDate(weekStart)}这周`;
const primaryButton = "min-h-11 rounded-lg bg-primary px-4 text-sm font-bold text-white disabled:opacity-40";
const quietButton = "min-h-10 rounded-lg bg-white px-3 text-sm font-semibold text-primary ring-1 ring-inset ring-primary/30 disabled:opacity-40";

/** 一项练习的灰色小字："N 分"；超出目标但不计分的再加"多读了 N 本" */
export function practiceScoreLabels(score?: PracticeWeekScore): { points: string; extra?: string } | undefined {
  if (!score) return undefined;
  return { points: `${score.total} 分`, extra: score.extraCount > 0 && !score.extraScores ? `本周多${practiceVerb(score.title)}了 ${score.extraCount} ${score.unit}` : undefined };
}

/** 周日晚上（18 点后）到周一：积分条下方显示一周小结，点一下收起（只记在本机） */
function weekSummaryFor(ctx: PointsContext, now: Date): { key: string; text: string } | null {
  const day = now.getDay();
  const today = todayKey();
  const history = ctx.summary.history;
  if (day === 0 && now.getHours() >= 18) {
    const week = history[history.length - 1];
    if (!week) return null;
    return { key: week.weekStart, text: `这周 ${week.total} 分，${week.reachedCount} 项达标。离下一朵小红花还差 ${ctx.summary.toNextFlower} 分。写下下周的愿望吧。` };
  }
  if (day === 1) {
    const last = history[history.length - 2];
    if (!last || last.weekStart >= getWeekStartKey(today)) return null;
    return { key: last.weekStart, text: `上周 ${last.total} 分，${last.reachedCount} 项达标。离下一朵小红花还差 ${ctx.summary.toNextFlower} 分。写下这周的愿望吧。` };
  }
  return null;
}

const SUMMARY_DISMISS_KEY = "points_week_summary_dismissed";

/** 今日页两栏上方的积分条：本周 N 分 | 离下一朵小红花的进度 | 🌸 数量 | 当前愿望 */
export function PointsBar({ ctx, onChanged }: { ctx: PointsContext; onChanged: () => void }) {
  const [detail, setDetail] = useState(false);
  const [wishOpen, setWishOpen] = useState(false);
  const [wishAction, setWishAction] = useState<Wish | null>(null);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(SUMMARY_DISMISS_KEY) ?? "");
  const { summary } = ctx;
  const wish = summary.wish;
  const canRedeem = !!wish && wish.status === "confirmed" && summary.flowers >= wish.cost;
  const weekSummary = weekSummaryFor(ctx, new Date());
  const showSummary = !!weekSummary && dismissed !== weekSummary.key;
  return (
    <section aria-label="积分" className="surface mb-4 overflow-visible">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 sm:px-4">
        <button type="button" onClick={() => setDetail(true)} className="-mx-1.5 min-h-9 shrink-0 rounded-md px-1.5 text-left text-[15px] font-semibold text-ink hover:bg-stone-100/70">
          本周 <span className="text-base font-bold tabular-nums">{summary.weekTotal}</span> 分
        </button>
        <div className="flex min-w-[9rem] flex-1 items-center gap-2" role="meter" aria-label={`离下一朵小红花 ${summary.progress}/${POINTS_PER_FLOWER}`} aria-valuemin={0} aria-valuemax={POINTS_PER_FLOWER} aria-valuenow={summary.progress}>
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-stone-200"><div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${summary.progress}%` }} /></div>
          <span className="shrink-0 text-[13px] tabular-nums text-muted">{summary.progress}/{POINTS_PER_FLOWER}</span>
        </div>
        <span className="shrink-0 text-[15px] font-semibold tabular-nums text-ink" title={`累计 ${summary.cumulative} 分，得到 ${summary.flowersEarned} 朵，兑换了 ${summary.flowersRedeemed} 朵`}><span aria-hidden>🌸</span> {summary.flowers}<span className="sr-only"> 朵小红花</span></span>
        {wish ? (
          <button type="button" onClick={() => setWishOpen(true)}
            className="min-h-9 min-w-0 basis-full rounded-md px-1.5 text-left text-[15px] hover:bg-stone-100/70 sm:-mx-1.5 sm:basis-auto sm:max-w-[45%]">
            <span className="flex min-w-0 items-center gap-2"><span className="truncate text-ink">愿望：{wish.text}</span><span className={`shrink-0 text-[13px] font-semibold ${canRedeem ? "text-primary" : "text-muted"}`}>{wish.status === "pending" ? "待确认" : canRedeem ? "可以兑换" : `要 ${wish.cost} 朵`}</span></span>
          </button>
        ) : (
          <button type="button" onClick={() => setWishOpen(true)} className="min-h-9 basis-full rounded-md px-1.5 text-left text-[15px] font-semibold text-primary hover:bg-primary/5 sm:-mx-1.5 sm:basis-auto">写一个愿望</button>
        )}
      </div>
      {showSummary && weekSummary && (
        <button type="button" onClick={() => { localStorage.setItem(SUMMARY_DISMISS_KEY, weekSummary.key); setDismissed(weekSummary.key); }}
          className="block w-full border-t border-ink/[0.07] px-3 py-2 text-left text-[13px] leading-5 text-ink/80 hover:bg-stone-50 sm:px-4" title="点一下收起">
          {weekSummary.text}
        </button>
      )}
      {detail && <PointsDetailDialog ctx={ctx} onClose={() => setDetail(false)} onChanged={onChanged} />}
      {wishOpen && <WishDialog ctx={ctx} onClose={() => setWishOpen(false)} onChanged={onChanged} onParent={(item) => { setWishOpen(false); setWishAction(item); }} />}
      {wishAction && <WishParentDialog wish={ctx.ledger.wishes.find((item) => item.id === wishAction.id) ?? wishAction} flowers={summary.flowers} onClose={() => setWishAction(null)} onChanged={onChanged} />}
    </section>
  );
}

/**
 * 每周练习最下面一行：家长奖励 +N（有待处理的提前完成作业时"待处理 N 项"）。
 * iPad / 手机上只显示，点击无反应；Mac 上点击打开家长奖励对话框（docs/TASK_09_points.md §7、§9.4）。
 */
export function ParentBonusRow({ ctx, onChanged, onBonusAdded }: { ctx: PointsContext; onChanged: () => void; onBonusAdded: (cumulativeBefore: number) => void }) {
  const [open, setOpen] = useState(false);
  const pending = ctx.summary.pendingEarly.length;
  const content = (
    <>
      <span>家长奖励 <span className="tabular-nums text-ink">{signed(ctx.summary.weekBonus)}</span></span>
      {pending > 0 && <span className="ml-auto text-ink">待处理 {pending} 项</span>}
    </>
  );
  const rowClass = "flex min-h-11 w-full items-center gap-3 border-t border-ink/[0.07] px-3 text-left text-[13px] font-semibold text-muted sm:px-4";
  if (!isParentDevice()) return <div className={rowClass} data-testid="parent-bonus-row">{content}</div>;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${rowClass} hover:bg-stone-50`} data-testid="parent-bonus-row">{content}</button>
      {open && <ParentBonusDialog ctx={ctx} onClose={() => setOpen(false)} onChanged={onChanged} onBonusAdded={onBonusAdded} />}
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

/** 家长奖励：加 / 减分（必须写原因）、撤回本周的某一笔、处理提前完成的作业 */
function ParentBonusDialog({ ctx, onClose, onChanged, onBonusAdded }: { ctx: PointsContext; onClose: () => void; onChanged: () => void; onBonusAdded: (cumulativeBefore: number) => void }) {
  const [sign, setSign] = useState<1 | -1>(1);
  const [amount, setAmount] = useState(1);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [early, setEarly] = useState<{ taskId: string; points: 1 | 2; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<unknown>) => {
    setError("");
    setBusy(true);
    try { await work(); onChanged(); } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败，请重试"); } finally { setBusy(false); }
  };
  const segment = (active: boolean) => `min-h-10 rounded-lg px-3 text-sm font-semibold ${active ? "bg-primary text-white" : "bg-white text-muted ring-1 ring-inset ring-ink/10"}`;
  return (
    <Sheet wide title="家长奖励" description="加分、减分都要写原因；记错了可以撤回。" onClose={onClose}>
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
        <button type="button" className={`${primaryButton} w-full`} disabled={!reason.trim() || busy} onClick={() => run(async () => { const before = ctx.summary.cumulative; await addBonus(sign * amount, reason); setReason(""); setAmount(1); onBonusAdded(before); })}>{sign === 1 ? "加" : "减"} {amount} 分</button>
        {error && <p className="text-[13px] text-rose-700">{error}</p>}
      </div>

      {ctx.summary.pendingEarly.length > 0 && (
        <div className="mt-5 border-t border-ink/10 pt-4">
          <h4 className="text-sm font-bold text-ink">待处理：提前完成的作业</h4>
          <ul className="mt-1 divide-y divide-ink/[0.07]">
            {ctx.summary.pendingEarly.map((item) => (
              <li key={item.taskId} className="py-2.5">
                <p className="text-sm text-ink">{item.title}<span className="ml-2 text-[13px] text-muted">{formatCompactDate(item.completedDate)}做完 · {formatCompactDate(item.endDate)}截止</span></p>
                {early?.taskId === item.taskId ? (
                  <div className="mt-2 space-y-2">
                    <div className="flex gap-1.5">{([1, 2] as const).map((value) => <button key={value} type="button" className={segment(early.points === value)} onClick={() => setEarly({ ...early, points: value })}>给 {value} 分</button>)}</div>
                    <input value={early.reason} maxLength={60} onChange={(event) => setEarly({ ...early, reason: event.target.value })} aria-label="原因" className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm outline-none focus:border-primary" />
                    <div className="flex gap-2">
                      <button type="button" className={`${primaryButton} flex-1`} disabled={!early.reason.trim() || busy} onClick={() => run(async () => { const before = ctx.summary.cumulative; await addBonus(early.points, early.reason, item.taskId); setEarly(null); onBonusAdded(before); })}>给 {early.points} 分</button>
                      <button type="button" onClick={() => setEarly(null)} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-muted hover:bg-white">取消</button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={() => setEarly({ taskId: item.taskId, points: 2, reason: `提前完成：${item.title}` })} className={quietButton}>给分</button>
                    <button type="button" disabled={busy} onClick={() => run(() => skipEarly(item.taskId))} className="min-h-10 rounded-lg px-3 text-sm font-semibold text-muted hover:bg-white disabled:opacity-40">不给（例如要订正）</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
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

/** 积分明细：本周每项（完成分 / 达标奖励 / 多做分）、家长奖励、以前每周、小红花获得与兑换、愿望 */
function PointsDetailDialog({ ctx, onClose, onChanged }: { ctx: PointsContext; onClose: () => void; onChanged: () => void }) {
  const { summary, ledger } = ctx;
  const [wishAction, setWishAction] = useState<Wish | null>(null);
  const parentDevice = isParentDevice();
  const past = [...summary.history].reverse().filter((week) => week.weekStart !== summary.weekStart);
  const redeemed = ledger.wishes.filter((wish) => wish.status === "redeemed").sort((a, b) => (b.redeemedAt ?? "").localeCompare(a.redeemedAt ?? ""));
  const earnedWeeks = summary.history.filter((week) => week.flowersEarned > 0).reverse();
  const wishes = ledger.wishes.filter((wish) => !wish.deletedAt && wish.status !== "redeemed").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const th = "py-1.5 text-right text-[13px] font-semibold text-muted";
  const td = "py-1.5 text-right tabular-nums";
  return (
    <Sheet wide title="积分明细" description={`累计 ${summary.cumulative} 分 · 得到 ${summary.flowersEarned} 朵小红花，兑换 ${summary.flowersRedeemed} 朵，现在 ${summary.flowers} 朵`} onClose={onClose}>
      <h4 className="text-sm font-bold text-ink">本周 {summary.weekTotal} 分</h4>
      <table className="mt-1 w-full text-sm">
        <thead><tr><th className="py-1.5 text-left text-[13px] font-semibold text-muted">练习</th><th className={th}>完成</th><th className={th}>达标</th><th className={th}>多做</th><th className={th}>合计</th></tr></thead>
        <tbody className="divide-y divide-ink/[0.07]">
          {summary.weekScores.map((score) => (
            <tr key={score.taskId}>
              <td className="py-1.5 pr-2"><span className="text-ink">{score.title}</span><span className="block text-[13px] text-muted">{score.count}/{score.target} {score.unit} · 每{score.unit === "次" ? "次" : score.unit} {score.points} 分{score.extraScores ? "" : " · 多做不计分"}</span></td>
              <td className={td}>{score.completionPoints}</td><td className={td}>{score.reachBonus || "–"}</td><td className={td}>{score.extraScores ? score.extraPoints || "–" : score.extraCount ? `多${score.extraCount}` : "–"}</td><td className={`${td} font-bold`}>{score.total}</td>
            </tr>
          ))}
          <tr><td className="py-1.5 pr-2 text-ink">家长奖励</td><td /><td /><td /><td className={`${td} font-bold`}>{signed(summary.weekBonus)}</td></tr>
        </tbody>
      </table>
      {summary.weekBonuses.length > 0 && <ul className="mt-2 divide-y divide-ink/[0.07] rounded-lg bg-white px-3">{summary.weekBonuses.map((bonus) => <BonusLine key={bonus.id} bonus={bonus} />)}</ul>}

      <h4 className="mt-5 text-sm font-bold text-ink">以前每周</h4>
      {past.length === 0 ? <p className="mt-1 text-sm text-muted">这是积分的第一周。</p> : (
        <table className="mt-1 w-full text-sm"><thead><tr><th className="py-1.5 text-left text-[13px] font-semibold text-muted">周</th><th className={th}>练习</th><th className={th}>奖励</th><th className={th}>合计</th><th className={th}>达标</th></tr></thead>
          <tbody className="divide-y divide-ink/[0.07]">{past.map((week) => <tr key={week.weekStart}><td className="py-1.5 text-ink">{weekLabel(week.weekStart)}</td><td className={td}>{week.practice}</td><td className={td}>{signed(week.bonus)}</td><td className={`${td} font-bold`}>{week.total}</td><td className={td}>{week.reachedCount} 项</td></tr>)}</tbody>
        </table>
      )}

      <h4 className="mt-5 text-sm font-bold text-ink">小红花</h4>
      {earnedWeeks.length === 0 && redeemed.length === 0 ? <p className="mt-1 text-sm text-muted">还没有，累计每满 {POINTS_PER_FLOWER} 分得一朵。</p> : (
        <ul className="mt-1 divide-y divide-ink/[0.07] text-sm">
          {earnedWeeks.map((week) => <li key={week.weekStart} className="flex justify-between py-1.5"><span>{weekLabel(week.weekStart)}得到</span><span className="font-semibold tabular-nums">+{week.flowersEarned} 朵</span></li>)}
          {redeemed.map((wish) => <li key={wish.id} className="flex justify-between gap-3 py-1.5"><span className="min-w-0">{formatCompactDate((wish.redeemedAt ?? wish.updatedAt).slice(0, 10))}兑换：{wish.text}</span><span className="shrink-0 font-semibold tabular-nums">−{wish.cost} 朵</span></li>)}
        </ul>
      )}

      <h4 className="mt-5 text-sm font-bold text-ink">愿望</h4>
      {wishes.length === 0 ? <p className="mt-1 text-sm text-muted">还没有愿望。</p> : (
        <ul className="mt-1 divide-y divide-ink/[0.07] text-sm">{wishes.map((wish) => <li key={wish.id} className="flex items-center justify-between gap-3 py-2"><span className="min-w-0">{wish.text}<span className="ml-2 text-[13px] text-muted">{wish.status === "pending" ? "待确认" : `要 ${wish.cost} 朵`}</span></span>{parentDevice && <button type="button" onClick={() => setWishAction(wish)} className="min-h-9 shrink-0 rounded-lg px-2 text-[13px] font-semibold text-primary hover:bg-primary/5">家长处理</button>}</li>)}</ul>
      )}
      {wishAction && <WishParentDialog wish={wishAction} flowers={summary.flowers} onClose={() => setWishAction(null)} onChanged={onChanged} />}
    </Sheet>
  );
}

/** 写愿望（孩子）+ 当前愿望列表 */
function WishDialog({ ctx, onClose, onChanged, onParent }: { ctx: PointsContext; onClose: () => void; onChanged: () => void; onParent: (wish: Wish) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const wishes = ctx.ledger.wishes.filter((wish) => !wish.deletedAt && wish.status !== "redeemed").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const parentDevice = isParentDevice();
  const save = async () => {
    setError("");
    try { await addWish(text); setText(""); onChanged(); onClose(); } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); }
  };
  return (
    <Sheet title="我的愿望" description="写下来以后，家长确认要几朵小红花。" onClose={onClose}>
      {wishes.length > 0 && (
        <ul className="mb-4 divide-y divide-ink/[0.07] rounded-lg bg-white px-3 text-sm">
          {wishes.map((wish) => {
            const ready = wish.status === "confirmed" && ctx.summary.flowers >= wish.cost;
            return <li key={wish.id} className="flex items-center justify-between gap-3 py-2.5"><span className="min-w-0 text-ink">{wish.text}<span className={`ml-2 text-[13px] ${ready ? "font-semibold text-primary" : "text-muted"}`}>{wish.status === "pending" ? "待确认" : ready ? "可以兑换" : `要 ${wish.cost} 朵`}</span></span>{parentDevice && <button type="button" onClick={() => onParent(wish)} className="min-h-9 shrink-0 rounded-lg px-2 text-[13px] font-semibold text-primary hover:bg-primary/5">家长处理</button>}</li>;
          })}
        </ul>
      )}
      <label className="block text-[13px] font-semibold text-muted">新愿望<input autoFocus value={text} maxLength={60} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void save(); } }} placeholder="写一个愿望" className="mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-3.5 py-2.5 text-base text-ink outline-none focus:border-primary" /></label>
      {error && <p className="mt-2 text-[13px] text-rose-700">{error}</p>}
      <button type="button" onClick={() => void save()} disabled={!text.trim()} className="mt-3 min-h-11 w-full rounded-lg bg-primary text-sm font-bold text-white disabled:opacity-40">写好了</button>
    </Sheet>
  );
}

/** 家长处理愿望（只在 Mac 上出现）：待确认 → 设定要几朵并确认；已确认且小红花够 → 兑换；也可以删掉 */
function WishParentDialog({ wish, flowers, onClose, onChanged }: { wish: Wish; flowers: number; onClose: () => void; onChanged: () => void }) {
  const [cost, setCost] = useState(wish.cost || 1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const run = async (work: () => Promise<unknown>) => {
    setError("");
    setBusy(true);
    try { await work(); onChanged(); onClose(); } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败，请重试"); } finally { setBusy(false); }
  };
  const enough = flowers >= wish.cost;
  return (
    <Sheet title={`愿望：${wish.text}`} description={wish.status === "pending" ? "确认后，定好要几朵小红花。" : `需要 ${wish.cost} 朵，现在有 ${flowers} 朵。`} onClose={onClose}>
      <div className="space-y-3">
        {wish.status === "pending" && (
          <>
            <div className="flex items-center gap-2 text-sm text-muted">需要
              <div className="inline-flex items-center rounded-lg bg-white ring-1 ring-inset ring-ink/10">
                <button type="button" aria-label="少一朵" disabled={cost <= 1} onClick={() => setCost(Math.max(1, cost - 1))} className="flex h-10 w-10 items-center justify-center text-lg font-semibold disabled:opacity-30">−</button>
                <span className="w-8 text-center text-base font-bold tabular-nums text-ink">{cost}</span>
                <button type="button" aria-label="多一朵" disabled={cost >= 99} onClick={() => setCost(Math.min(99, cost + 1))} className="flex h-10 w-10 items-center justify-center text-lg font-semibold disabled:opacity-30">+</button>
              </div>朵小红花
            </div>
            <button type="button" className={`${primaryButton} w-full`} disabled={busy} onClick={() => run(() => confirmWish(wish.id, cost))}>确认这个愿望（要 {cost} 朵）</button>
          </>
        )}
        {wish.status === "confirmed" && (enough
          ? <button type="button" className={`${primaryButton} w-full`} disabled={busy} onClick={() => run(() => redeemWish(wish.id))}>兑换（扣 {wish.cost} 朵）</button>
          : <p className="text-sm text-muted">小红花还差 {wish.cost - flowers} 朵，攒够了就能兑换。</p>)}
        {confirmDelete ? (
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => run(() => deleteWish(wish.id))} className="min-h-11 flex-1 rounded-lg bg-white text-sm font-bold text-rose-700 ring-1 ring-inset ring-rose-200 disabled:opacity-40">确定删掉</button>
            <button type="button" onClick={() => setConfirmDelete(false)} className="min-h-11 rounded-lg px-4 text-sm font-semibold text-muted hover:bg-white">不删</button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)} className="min-h-11 w-full rounded-lg text-sm font-semibold text-rose-700 hover:bg-rose-50">删掉这个愿望</button>
        )}
        {error && <p className="text-[13px] text-rose-700">{error}</p>}
      </div>
    </Sheet>
  );
}
