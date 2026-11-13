import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { addDays, format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { fromDateKey, toDateKey } from "../utils/date";

export interface DateChoice {
  label: string;
  date: string;
}

/** 以某天为基准的常用快捷日期：后一天、后两天、一周后 */
export const quickDatesFrom = (base: string, labels: [string, string, string] = ["明天", "后天", "一周后"]): DateChoice[] =>
  [1, 2, 7].map((offset, index) => ({ label: labels[index], date: toDateKey(addDays(fromDateKey(base), offset)) }));

/**
 * 选一个日期的弹窗（2026-11-13，替代浏览器自带的"请输入 YYYY-MM-DD"输入框）：
 * 快捷按钮 + 日期框，可选一行备注。iPad 上不用再手打日期格式。
 */
export function DatePickDialog({ title, description, initialDate, choices, note, confirmText, onConfirm, onClose }: {
  title: string;
  description?: string;
  initialDate: string;
  choices: DateChoice[];
  /** 传了就显示一行备注输入（如"这一次改到别的日子"的调整说明） */
  note?: { label: string; initial?: string; placeholder?: string };
  confirmText: string;
  onConfirm: (date: string, note: string) => Promise<void>;
  onClose: () => void;
}) {
  const [date, setDate] = useState(initialDate);
  const [noteText, setNoteText] = useState(note?.initial ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const confirm = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError("请选一个日期");
    setSaving(true);
    setError("");
    try {
      await onConfirm(date, noteText.trim());
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败，请重试");
      setSaving(false);
    }
  };
  const chip = (active: boolean) => `min-h-11 rounded-lg px-3 text-sm font-semibold transition-colors ${active ? "bg-primary text-white" : "bg-white text-ink ring-1 ring-inset ring-ink/10 hover:bg-mint/40"}`;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/45 sm:items-center sm:p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-sm rounded-t-lg bg-paper p-5 shadow-xl sm:rounded-lg">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><h3 className="text-base font-bold text-ink">{title}</h3>{description && <p className="mt-1 text-[13px] text-muted">{description}</p>}</div>
          <button type="button" aria-label="关闭" onClick={onClose} className="-m-1 rounded-lg p-2 text-muted hover:bg-white hover:text-ink"><X className="h-5 w-5" /></button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {choices.map((choice) => (
            <button key={choice.label} type="button" onClick={() => setDate(choice.date)} className={chip(date === choice.date)}>
              <span className="block leading-5">{choice.label}</span>
              <span className={`block text-[13px] font-medium leading-4 ${date === choice.date ? "text-white/80" : "text-muted"}`}>{format(fromDateKey(choice.date), "M/d EEE", { locale: zhCN })}</span>
            </button>
          ))}
        </div>
        <label className="mt-3 block text-[13px] font-semibold text-muted">或者选一天
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1.5 block min-h-11 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink" />
        </label>
        {note && <label className="mt-3 block text-[13px] font-semibold text-muted">{note.label}
          <input value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder={note.placeholder} className="mt-1.5 block min-h-11 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm font-normal text-ink" />
        </label>}
        {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-lg border border-ink/10 bg-white text-sm text-muted">取消</button>
          <button type="button" onClick={confirm} disabled={saving} className="min-h-11 flex-[2] rounded-lg bg-primary text-sm font-semibold text-white disabled:opacity-50">{saving ? "保存中…" : confirmText}</button>
        </div>
      </div>
    </div>
  );
}
