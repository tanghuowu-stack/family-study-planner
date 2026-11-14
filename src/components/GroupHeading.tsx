import { GripVertical } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import type { TaskSubjectGroup } from "../utils/taskGrouping";

/**
 * 学科色点（2026-11 视觉基线）：学科只用 8px 色点加文字区分，不再用整条浅色底和左边线。
 * 今日页、任务管理页共用这一份；课表页的学科文字色与此同源。
 */
export const SUBJECT_DOT: Record<TaskSubjectGroup, string> = {
  chinese: "#D96A52",
  math: "#5868C8",
  english: "#9364C7",
  other: "#8A948F",
};

/** 不属于某个学科的分组（如今日页的"上课"）用的中性色点 */
export const NEUTRAL_DOT = "rgba(32, 41, 37, 0.3)";

interface Props {
  label: string;
  /** 跟在标题后的说明，如"作业"；颜色更浅 */
  suffix?: string;
  count?: number;
  dot?: string;
  /** 拖拽手柄的事件与样式（来自 useSortableList.handleProps）；传了就在最右侧显示可拖的手柄 */
  handle?: HTMLAttributes<HTMLElement> & { "data-no-swipe"?: true };
  /** 拖拽经过时高亮 */
  highlight?: boolean;
  /** 右侧额外操作（如任务管理页的"选择本组"） */
  action?: ReactNode;
}

/** 分组小标题：13px 半粗、无底色，靠色点与留白分区 */
export function GroupHeading({ label, suffix, count, dot, handle, highlight, action }: Props) {
  return (
    <h3 className={`flex items-center gap-2 px-3 pb-1 pt-3 text-[13px] font-semibold transition-colors sm:px-4 ${highlight ? "bg-mint/60" : ""}`}>
      {dot && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: dot }} />}
      <span className="text-ink">{label}</span>
      {suffix && <span className="font-medium text-muted">{suffix}</span>}
      {count !== undefined && <span className="ml-auto font-medium tabular-nums text-muted">{count}</span>}
      {action && <span className={count === undefined ? "ml-auto" : ""}>{action}</span>}
      {/* 手柄放最右侧：放左侧会让有手柄和没手柄的分组色点对不齐 */}
      {handle && <button type="button" aria-label={`拖动调整“${label}”的位置`} title="按住拖动调整顺序" {...handle} className={`-my-2 -mr-2 flex h-9 w-8 shrink-0 items-center justify-center rounded-md text-stone-300 hover:bg-stone-100 hover:text-muted [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-10 ${count === undefined && !action ? "ml-auto" : ""}`}><GripVertical aria-hidden className="h-4 w-4" /></button>}
    </h3>
  );
}
