import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * 键盘弹出时可见区域的底边离屏幕底多远（iPhone / iPad 上键盘盖住页面，`visualViewport` 变矮）。
 * 2026-11-25 用户：记账弹窗被键盘挡住。弹窗整体上移到键盘上方，最大高度跟着可见区域缩。
 */
function useKeyboardInset() {
  const [inset, setInset] = useState({ bottom: 0, height: 0 });
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setInset({ bottom: Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)), height: Math.round(vv.height) });
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => { vv.removeEventListener("resize", update); vv.removeEventListener("scroll", update); };
  }, []);
  return inset;
}

/**
 * 弹窗外壳：手机从底部弹出、宽屏居中（同 DatePickDialog）。
 * 键盘弹出时弹窗停在键盘上方，点到的输入框自动滚到弹窗中间，不会被键盘盖住。
 */
export function Sheet({ title, description, onClose, children, wide = false }: { title: string; description?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const keyboard = useKeyboardInset();
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  // 键盘弹出（或换了输入框）后，把正在输入的框滚到弹窗可见范围中间
  useEffect(() => {
    const active = document.activeElement;
    if (keyboard.bottom > 0 && active instanceof HTMLElement && body.current?.contains(active)) {
      requestAnimationFrame(() => active.scrollIntoView({ block: "center", behavior: "smooth" }));
    }
  }, [keyboard.bottom]);
  const lifted = keyboard.bottom > 0;
  return (
    <div className="fixed inset-x-0 top-0 z-[80] flex items-end justify-center bg-ink/45 sm:items-center sm:p-4" style={{ bottom: keyboard.bottom }}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      onFocus={(event) => { const target = event.target; if (lifted && target instanceof HTMLElement) requestAnimationFrame(() => target.scrollIntoView({ block: "center", behavior: "smooth" })); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`flex max-h-[88vh] w-full flex-col rounded-t-lg bg-paper shadow-xl sm:rounded-lg ${wide ? "max-w-lg" : "max-w-sm"}`}
        style={lifted ? { maxHeight: Math.round(keyboard.height * 0.94) } : undefined}>
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0"><h3 className="text-base font-bold text-ink">{title}</h3>{description && <p className="mt-1 text-[13px] text-muted">{description}</p>}</div>
          <button type="button" aria-label="关闭" onClick={onClose} className="-m-1 rounded-lg p-2 text-muted hover:bg-white hover:text-ink"><X className="h-5 w-5" /></button>
        </div>
        <div ref={body} className="min-h-0 overflow-y-auto px-5 pb-5 pt-4">{children}</div>
      </div>
    </div>
  );
}
