import { ChevronDown, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { MEMO_HISTORY_LIMIT, type MemoHistoryEntry } from "../data/appSettingsRepository";

interface Props {
  entries: MemoHistoryEntry[];
  busy: boolean;
  onRestore: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function MemoHistorySection({ entries, busy, onRestore, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  return <section className="border-t border-ink/10 pt-4" aria-label="历史备忘">
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="memo-history-list" className="flex min-h-11 w-full items-center justify-between gap-3 text-left">
      <span className="text-sm font-semibold">历史备忘 <span className="ml-1 text-xs font-normal tabular-nums text-muted">{entries.length} / {MEMO_HISTORY_LIMIT}</span></span>
      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted">{open ? "收起" : "展开"}<ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} /></span>
    </button>
    {open && <div id="memo-history-list">
      <p className="mb-2 text-xs leading-5 text-muted">按完成时间保留最近 50 条，超出后自动永久删除最早记录。恢复会移回当前备忘，已有内容时追加。</p>
      <div className="max-h-[32rem] divide-y divide-ink/10 overflow-y-auto" aria-busy={busy}>
        {entries.length ? entries.map((entry) => <article key={entry.id} className="py-3">
          <time dateTime={entry.completedAt} className="text-xs text-muted">{new Date(entry.completedAt).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })} 完成</time>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-ink">{entry.text}</p>
          {deleteId === entry.id ? <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="确认永久删除备忘">
            <p className="w-full text-xs text-rose-700">永久删除这条历史备忘？删除后无法恢复。</p>
            <button type="button" disabled={busy} onClick={async () => { await onDelete(entry.id); setDeleteId(null); }} className="min-h-11 rounded-lg bg-rose-600 px-3 text-xs font-semibold text-white disabled:opacity-50">确认永久删除</button>
            <button type="button" disabled={busy} onClick={() => setDeleteId(null)} className="min-h-11 rounded-lg border border-ink/10 px-3 text-xs text-muted">取消</button>
          </div> : <div className="mt-1 flex items-center justify-end gap-2">
            <button type="button" disabled={busy} onClick={() => void onRestore(entry.id)} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-ink/10 px-3 text-xs font-medium text-primary hover:bg-mint/40 disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" />恢复</button>
            <button type="button" disabled={busy} onClick={() => setDeleteId(entry.id)} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />永久删除</button>
          </div>}
        </article>) : <p className="py-4 text-sm text-muted">暂无历史备忘。备忘录打勾完成后会保存在这里。</p>}
      </div>
    </div>}
  </section>;
}
