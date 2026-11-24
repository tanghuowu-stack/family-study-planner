import { X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

/** 家长确认要按住多久（2026-11-24 用户定：长按 2 秒） */
export const PARENT_HOLD_MS = 2000;

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

/**
 * 按住一段时间才生效（家长确认用）：按下后底色从左往右填满，按满 2 秒触发；中途松手、移开都取消。
 * 键盘：按住空格 / 回车同样计时。
 */
export function HoldButton({ label, onConfirm, disabled = false, tone = "primary", ms = PARENT_HOLD_MS, className = "" }: { label: string; onConfirm: () => void | Promise<void>; disabled?: boolean; tone?: "primary" | "danger"; ms?: number; className?: string }) {
  const [holding, setHolding] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; setHolding(false); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const start = () => {
    if (disabled || busy || timer.current) return;
    setHolding(true);
    timer.current = setTimeout(async () => {
      timer.current = null;
      setHolding(false);
      setBusy(true);
      try { await onConfirm(); } finally { setBusy(false); }
    }, ms);
  };
  const base = tone === "danger" ? "bg-white text-rose-700 ring-1 ring-inset ring-rose-200" : "bg-white text-primary ring-1 ring-inset ring-primary/30";
  const fill = tone === "danger" ? "bg-rose-100" : "bg-primary/15";
  return (
    <button type="button" disabled={disabled || busy}
      onPointerDown={(event) => { try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* 拿不到捕获也照样计时 */ } start(); }}
      onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}
      onKeyDown={(event) => { if ((event.key === " " || event.key === "Enter") && !event.repeat) { event.preventDefault(); start(); } }}
      onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") stop(); }}
      onContextMenu={(event) => event.preventDefault()}
      className={`relative min-h-11 select-none overflow-hidden rounded-lg px-4 text-sm font-bold [-webkit-touch-callout:none] [touch-action:none] disabled:opacity-40 ${base} ${className}`}>
      <span aria-hidden className={`absolute inset-y-0 left-0 ${fill} ${holding ? "w-full transition-[width] ease-linear" : "w-0"}`} style={holding ? { transitionDuration: `${ms}ms` } : undefined} />
      <span className="relative">{busy ? "保存中…" : holding ? "继续按住…" : label}</span>
    </button>
  );
}

/**
 * 普通元素上的"点一下 / 长按"：点一下走 onTap，按住满 ms 走 onHold；按住期间 holding = true（可显示进度）。
 * 手指移动超过 10px 视为滚动，取消。
 */
export function useHoldPress({ onTap, onHold, ms = PARENT_HOLD_MS }: { onTap?: () => void; onHold: () => void; ms?: number }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; setHolding(false); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return {
    holding,
    handlers: {
      onPointerDown: (event: ReactPointerEvent) => {
        if (event.button !== 0) return;
        fired.current = false;
        origin.current = { x: event.clientX, y: event.clientY };
        setHolding(true);
        timer.current = setTimeout(() => { timer.current = null; fired.current = true; setHolding(false); onHold(); }, ms);
      },
      onPointerMove: (event: ReactPointerEvent) => {
        if (!origin.current || !timer.current) return;
        if (Math.abs(event.clientX - origin.current.x) > 10 || Math.abs(event.clientY - origin.current.y) > 10) { origin.current = null; clear(); }
      },
      onPointerUp: () => {
        const wasPending = !!timer.current;
        clear();
        if (wasPending && !fired.current && origin.current) onTap?.();
        origin.current = null;
      },
      onPointerLeave: () => { origin.current = null; clear(); },
      onPointerCancel: () => { origin.current = null; clear(); },
      onContextMenu: (event: ReactMouseEvent) => event.preventDefault(),
      onKeyDown: (event: ReactKeyboardEvent) => { if (event.key === "Enter") { event.preventDefault(); onTap?.(); } },
    },
  };
}

/** 家长长按确认（补勾以前的日子等）：确认后 resolve(true)，关闭 resolve(false) */
export function ParentConfirmDialog({ title, detail, confirmLabel = "家长长按 2 秒确认", onResult }: { title: string; detail?: string; confirmLabel?: string; onResult: (ok: boolean) => void }) {
  return (
    <Sheet title={title} description={detail} onClose={() => onResult(false)}>
      <div className="flex flex-col gap-2">
        <HoldButton label={confirmLabel} onConfirm={() => onResult(true)} className="w-full" />
        <button type="button" onClick={() => onResult(false)} className="min-h-11 rounded-lg text-sm font-semibold text-muted hover:bg-white">取消</button>
      </div>
    </Sheet>
  );
}
