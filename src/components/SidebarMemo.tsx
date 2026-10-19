import { Check } from "lucide-react";

interface Props {
  value: string;
  variant: "sidebar" | "narrow";
  onFocus: () => void;
  onChange: (value: string) => void;
  onBlur: () => void;
  onComplete: () => void;
}

export function SidebarMemo({ value, variant, onFocus, onChange, onBlur, onComplete }: Props) {
  const hasContent = value.trim().length > 0;
  if (variant === "narrow" && !hasContent) return null;

  const sidebar = variant === "sidebar";
  return (
    <section className={sidebar ? "mt-4 border-t border-white/10 pt-4" : "surface mb-4 p-3 lg:hidden"} aria-label="备忘录">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className={`text-xs font-semibold ${sidebar ? "text-white/70" : "text-ink"}`}>备忘录:</h2>
        {hasContent && (
          <button
            type="button"
            onClick={onComplete}
            aria-label="完成并清除备忘录"
            title="完成并清除"
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${sidebar ? "border-white/20 text-white/70 hover:bg-white/10 hover:text-white" : "border-primary/30 text-primary hover:bg-mint"}`}
          >
            <Check className="h-4 w-4" />
          </button>
        )}
      </div>
      <textarea
        aria-label="备忘录内容"
        value={value}
        rows={3}
        onFocus={onFocus}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        className={`block w-full resize-none overflow-y-auto rounded-lg border px-2.5 py-2 text-xs leading-5 ${sidebar ? "max-h-28 border-white/15 bg-white/10 text-white placeholder:text-white/35 focus:border-white/35 focus:ring-0" : "max-h-24 border-ink/10 bg-white text-ink placeholder:text-muted/55"}`}
      />
    </section>
  );
}
