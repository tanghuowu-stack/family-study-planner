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
}

export interface ScheduleSection {
  title: string;
  items: ScheduleItem[];
}

const item = (label: string, start: string, end: string, kind: ScheduleKind = "break"): ScheduleItem => ({ label, start, end, kind });

export const SCHOOL_MORNING: ScheduleSection = {
  title: "上午",
  items: [
    item("第一节", "8:25", "9:05", "class"),
    item("课间活动", "9:05", "9:20"),
    item("第二节", "9:20", "10:00", "class"),
    item("大课间", "10:00", "10:30", "big-break"),
    item("第三节", "10:30", "11:10", "class"),
    item("眼保健操", "11:10", "11:15"),
    item("课间活动", "11:15", "11:30"),
    item("第四节", "11:30", "12:10", "class"),
  ],
};

export const SCHOOL_LUNCH = item("午餐 · 午休", "12:10", "14:00", "big-break");

export const SCHOOL_AFTERNOON: ScheduleSection = {
  title: "下午",
  items: [
    item("第五节", "14:00", "14:40", "class"),
    item("眼保健操", "14:40", "14:45"),
    item("课间活动", "14:45", "15:00"),
    item("第六节", "15:00", "15:40", "class"),
    item("课间活动", "15:40", "15:55"),
  ],
};

/** 课后服务分两种：周一、二、四 / 周三、五（getDay：1 = 周一） */
export const SCHOOL_AFTER: { days: number[]; title: string; items: ScheduleItem[] }[] = [
  { days: [1, 2, 4], title: "周一、二、四", items: [item("社团活动", "15:55", "16:35", "activity"), item("课间活动", "16:35", "16:50"), item("作业", "16:50", "17:30", "activity")] },
  { days: [3, 5], title: "周三、五", items: [item("社团 / 体育活动", "15:55", "17:15", "activity"), item("书法研习", "17:15", "17:35", "activity")] },
];

export const SCHOOL_DISMISS = { classEnd: "17:55", leave: "18:00", text: "17:55 下课，18:00 放学" };

/** "8:25" → 505（分钟） */
export const toMinutes = (value: string) => {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
};

/** 现在正在进行的那一项（today 是周一到周五时才有） */
export function currentScheduleItem(now: Date): ScheduleItem | null {
  const day = now.getDay();
  if (day < 1 || day > 5) return null;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const after = SCHOOL_AFTER.find((group) => group.days.includes(day))?.items ?? [];
  const all = [...SCHOOL_MORNING.items, SCHOOL_LUNCH, ...SCHOOL_AFTERNOON.items, ...after];
  return all.find((entry) => minutes >= toMinutes(entry.start) && minutes < toMinutes(entry.end)) ?? null;
}
