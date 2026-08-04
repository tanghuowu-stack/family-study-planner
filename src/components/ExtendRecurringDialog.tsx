/**
 * ExtendRecurringDialog：「延长周期」确认框。
 * 只改 recurrence.endDate，任务本体/streakStartDate/历史 occurrence 完全不动，
 * 不创建任何新任务——替代"到期后手动新建同名任务续期"的做法（2026-08-04）。
 */
import { useState } from "react";
import type { Task } from "../types/task";
import { addDays } from "date-fns";
import { todayKey, toDateKey, fromDateKey } from "../utils/date";

export function ExtendRecurringDialog({ task, onClose, onConfirm }: {
  task: Task;
  onClose: () => void;
  onConfirm: (newEndDate: string | undefined) => Promise<void>;
}) {
  const today = todayKey();
  const defaultDate = toDateKey(addDays(fromDateKey(today), 30));
  const [unlimited, setUnlimited] = useState(false);
  const [date, setDate] = useState(defaultDate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const confirm = async () => {
    setSaving(true);
    setError("");
    try {
      await onConfirm(unlimited ? undefined : date);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "延长失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/30 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold">延长周期</h3>
        <p className="mt-1 text-sm text-stone-600">{task.title || "该任务"} 已于 {task.recurrence?.endDate} 结束，选一个新的结束日期继续排期。任务本体、历史记录、打卡月历都不受影响。</p>

        <div className="mt-4 space-y-2">
          <label className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm ${!unlimited ? "border-primary bg-mint/40" : "border-stone-200"}`}>
            <input type="radio" checked={!unlimited} onChange={() => setUnlimited(false)} className="h-4 w-4" />
            <span className="text-ink">延长到</span>
            <input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} onClick={(e) => e.stopPropagation()} disabled={unlimited} className="ml-auto rounded-lg border px-2 py-1 text-sm text-stone-700 disabled:opacity-40" />
          </label>
          <label className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm ${unlimited ? "border-primary bg-mint/40" : "border-stone-200"}`}>
            <input type="radio" checked={unlimited} onChange={() => setUnlimited(true)} className="h-4 w-4" />
            <span className="text-ink">不限期（长期排下去）</span>
          </label>
        </div>

        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

        <div className="mt-4 flex gap-2">
          <button onClick={confirm} disabled={saving || (!unlimited && !date)} className="flex-1 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "保存中…" : "确认延长"}</button>
          <button onClick={onClose} className="rounded-xl border bg-white px-4 py-2 text-sm text-stone-500">取消</button>
        </div>
      </div>
    </div>
  );
}
