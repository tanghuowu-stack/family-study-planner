import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

/** 弹窗外壳：手机从底部弹出、宽屏居中（同 DatePickDialog） */
export function Sheet({ title, description, onClose, children, wide = false }: { title: string; description?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/45 sm:items-center sm:p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`flex max-h-[88vh] w-full flex-col rounded-t-lg bg-paper shadow-xl sm:rounded-lg ${wide ? "max-w-lg" : "max-w-sm"}`}>
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0"><h3 className="text-base font-bold text-ink">{title}</h3>{description && <p className="mt-1 text-[13px] text-muted">{description}</p>}</div>
          <button type="button" aria-label="关闭" onClick={onClose} className="-m-1 rounded-lg p-2 text-muted hover:bg-white hover:text-ink"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 pb-5 pt-4">{children}</div>
      </div>
    </div>
  );
}
