import type { ComponentType } from "react";

export interface SegmentedTab<T extends string> { value: T; label: string; icon?: ComponentType<{ className?: string }> }

/**
 * 页面顶部的分段切换（2026-11-25 页面整理："计划"= 月历 / 全部任务，"统计"= 本周 / 打卡 / 上课）。
 * 圆角胶囊，选中深色底白字，其余白底灰字；每格至少 44px 高。手机上撑满一行等分，宽屏按内容宽。
 */
export function SegmentedTabs<T extends string>({ tabs, value, onChange, label }: { tabs: SegmentedTab<T>[]; value: T; onChange: (value: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }} className="mb-3 grid gap-1 rounded-full border border-ink/10 bg-white p-1 shadow-[0_1px_2px_rgba(32,41,37,0.04)] sm:mb-4 sm:inline-grid sm:w-auto">
      {tabs.map(({ value: tab, label: text, icon: Icon }) => {
        const active = tab === value;
        return (
          <button key={tab} type="button" role="tab" aria-selected={active} onClick={() => onChange(tab)}
            className={`flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-full px-3 text-[15px] font-semibold transition-colors sm:px-5 ${active ? "bg-ink text-white" : "text-muted hover:bg-stone-100 hover:text-ink"}`}>
            {Icon && <Icon className="h-4 w-4 shrink-0" />}<span className="truncate">{text}</span>
          </button>
        );
      })}
    </div>
  );
}
