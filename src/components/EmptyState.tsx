import { CheckCircle2 } from "lucide-react";

export function EmptyState({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex items-center gap-3 rounded-lg border border-dashed border-ink/15 bg-stone-50/60 text-muted ${compact ? "px-4 py-5" : "justify-center px-5 py-8"}`}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-mint text-primary"><CheckCircle2 className="h-4 w-4" /></span>
      <span><span className="block text-sm font-semibold text-ink">今天的清单很轻</span><span className="mt-0.5 block text-xs">没有安排，也是一种从容。</span></span>
    </div>
  );
}
