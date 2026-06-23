import { Sparkles } from "lucide-react";

export function EmptyState({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex items-center gap-3 rounded-2xl border border-dashed border-stone-200 bg-stone-50/70 text-stone-500 ${compact ? "px-4 py-4" : "px-5 py-8 justify-center"}`}>
      <Sparkles className="h-4 w-4 text-sun" />
      <span className="text-sm">这里还没有安排，留一点从容也很好。</span>
    </div>
  );
}
