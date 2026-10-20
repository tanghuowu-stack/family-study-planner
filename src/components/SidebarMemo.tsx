import { Check } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

interface Props {
  value: string;
  variant: "sidebar" | "narrow";
  editorOpen?: boolean;
  focusRequest?: number;
  onFocus: () => void;
  onChange: (value: string) => void;
  onBlur: () => void;
  onComplete: () => void;
}

export function SidebarMemo({ value, variant, editorOpen = false, focusRequest = 0, onFocus, onChange, onBlur, onComplete }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  const hasContent = value.trim().length > 0;
  const sidebar = variant === "sidebar";
  const visible = sidebar || hasContent || editorOpen || focused;

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !visible) return;
    const resize = () => {
      // border-box 高度包含上下边框；先收回高度，让删除内容时也能缩小。
      textarea.style.height = "auto";
      const style = getComputedStyle(textarea);
      textarea.style.height = `${textarea.scrollHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)}px`;
    };
    resize();
    let width = textarea.getBoundingClientRect().width;
    let resizeFrame = 0;
    const observer = new ResizeObserver(() => {
      const nextWidth = textarea.getBoundingClientRect().width;
      if (nextWidth !== width) {
        width = nextWidth;
        // 宽度变化后在下一帧改高度，避免在 ResizeObserver 通知中再次改变尺寸。
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(resize);
      }
    });
    observer.observe(textarea);
    return () => { observer.disconnect(); cancelAnimationFrame(resizeFrame); };
  }, [value, visible]);

  useLayoutEffect(() => {
    if (!sidebar && editorOpen && focusRequest > 0) textareaRef.current?.focus();
  }, [sidebar, editorOpen, focusRequest]);

  if (!visible) return null;

  return (
    <section id={sidebar ? "sidebar-memo" : "today-memo"} className={sidebar ? "mt-4 shrink-0 border-t border-white/10 pt-4" : "surface mb-4 p-3 lg:hidden"} aria-label="备忘录">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className={`text-xs font-semibold ${sidebar ? "text-white/70" : "text-ink"}`}>备忘录:</h2>
        {hasContent && (
          <button
            type="button"
            onClick={onComplete}
            aria-label="完成并清除备忘录"
            title="完成并清除"
            className={`flex shrink-0 items-center justify-center rounded-md border ${sidebar ? "h-7 w-7 border-white/20 text-white/70 hover:bg-white/10 hover:text-white" : "h-11 w-11 border-primary/30 text-primary hover:bg-mint"}`}
          >
            <Check className="h-4 w-4" />
          </button>
        )}
      </div>
      <textarea
        ref={textareaRef}
        aria-label="备忘录内容"
        value={value}
        rows={3}
        onFocus={() => { setFocused(true); onFocus(); }}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => { setFocused(false); onBlur(); }}
        className={`block w-full resize-none overflow-hidden rounded-lg border px-2.5 py-2 leading-5 ${sidebar ? "border-white/15 bg-white/10 text-xs text-white focus:border-white/35 focus:ring-0" : "border-ink/10 bg-white text-sm text-ink"}`}
      />
    </section>
  );
}
