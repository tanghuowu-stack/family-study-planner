/**
 * 学校作息时间（2026-11-25 用户发来学校的作息表照片，课表页“作息时间”按它显示）。
 * 照片上第三节写成“10:30—11:30”，但占用 40 分钟、11:10 开始眼保健操，按 10:30–11:10 记。
 * 改作息时间就改这里（不在课表编辑里）。
 */
export type ScheduleKind = "class" | "break" | "big-break" | "activity";

export interface ScheduleItem {
  label: string;
  start: string;
  end: string;
  kind: ScheduleKind;
  /** 对应课表里的哪一节（作息时间后面写上那天这一节是什么课，2026-11-25） */
  slotId?: string;
}

export interface ScheduleSection {
  title: string;
  items: ScheduleItem[];
}

const item = (label: string, start: string, end: string, kind: ScheduleKind = "break", slotId?: string): ScheduleItem => ({ label, start, end, kind, ...(slotId ? { slotId } : {}) });

export const SCHOOL_MORNING: ScheduleSection = {
  title: "上午",
  items: [
    item("第一节", "8:25", "9:05", "class", "am-1"),
    item("课间活动", "9:05", "9:20"),
    item("第二节", "9:20", "10:00", "class", "am-2"),
    item("大课间", "10:00", "10:30", "big-break"),
    item("第三节", "10:30", "11:10", "class", "am-3"),
    item("眼保健操", "11:10", "11:15"),
    item("课间活动", "11:15", "11:30"),
    item("第四节", "11:30", "12:10", "class", "am-4"),
  ],
};

/** 2026-11-25 用户：午餐 12:10–13:00、午休 13:00–13:50 分开写 */
export const SCHOOL_LUNCH = item("午餐", "12:10", "13:00", "big-break");
export const SCHOOL_NAP = item("午休", "13:00", "13:50", "big-break");

export const SCHOOL_AFTERNOON: ScheduleSection = {
  title: "下午",
  items: [
    item("第五节", "14:00", "14:40", "class", "pm-1"),
    item("眼保健操", "14:40", "14:45"),
    item("课间活动", "14:45", "15:00"),
    item("第六节", "15:00", "15:40", "class", "pm-2"),
    item("课间活动", "15:40", "15:55"),
  ],
};

/**
 * 课后服务（延时）按星期几不同（2026-11-25 用户更正）：
 * - 周一、周二：延时1（15:55–16:35）、课间活动、延时2（16:50–17:30）、延时3（17:30–17:55）；
 * - 周四：同周一，只是第一段是社团；
 * - 周三：云脑班 15:55–17:55；
 * - 周五：俱乐部 15:55–17:00、文学社 17:00–17:55。
 */
const extendedDay = (first: string): ScheduleItem[] => [
  item(first, "15:55", "16:35", "activity", "extended-1"),
  item("课间活动", "16:35", "16:50"),
  item("延时2", "16:50", "17:30", "activity", "extended-2"),
  item("延时3", "17:30", "17:55", "activity", "extended-3"),
];
export const SCHOOL_AFTER_BY_DAY: Record<number, ScheduleItem[]> = {
  1: extendedDay("延时1"),
  2: extendedDay("延时1"),
  3: [item("云脑班", "15:55", "17:55", "activity")],
  4: extendedDay("社团"),
  5: [item("俱乐部", "15:55", "17:00", "activity"), item("文学社", "17:00", "17:55", "activity")],
};

export const SCHOOL_DISMISS = { classEnd: "17:55", leave: "18:00", text: "17:55 下课，18:00 放学" };

/** "8:25" → 505（分钟） */
export const toMinutes = (value: string) => {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
};

/** 分钟数 → "40 分钟" / "2 小时" / "1 小时 5 分" */
export function durationText(entry: ScheduleItem): string {
  const minutes = toMinutes(entry.end) - toMinutes(entry.start);
  if (minutes < 60) return `${minutes} 分钟`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
}

/** 现在正在进行的那一项（today 是周一到周五时才有） */
export function currentScheduleItem(now: Date): ScheduleItem | null {
  const day = now.getDay();
  if (day < 1 || day > 5) return null;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const after = SCHOOL_AFTER_BY_DAY[day] ?? [];
  const all = [...SCHOOL_MORNING.items, SCHOOL_LUNCH, SCHOOL_NAP, ...SCHOOL_AFTERNOON.items, ...after];
  return all.find((entry) => minutes >= toMinutes(entry.start) && minutes < toMinutes(entry.end)) ?? null;
}
