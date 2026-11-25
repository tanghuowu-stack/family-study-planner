import { TIMETABLE_DAYS, type SchoolTimetable } from "../data/appSettingsRepository";

/**
 * 明天要带什么（2026-11-25 用户选的建议："明天要带"提醒）：
 * 取课表里明天那一列"高亮显示"（要带课本或工具）的课，按课表顺序、去重：
 * - "英语（课本）" → "英语课本"；"音乐（葫芦丝）" → "葫芦丝"；没写括号的（美术、劳动……）就写课名。
 * 明天是周六、周日，或者是放假（日历标"休"）就没有。调休上班的周末课表上没有那一天，也不提醒。
 */
export interface CarryItem { label: string; course: string }

export function carryItemsFor(timetable: SchoolTimetable, date: Date, isHoliday = false): CarryItem[] {
  const weekday = date.getDay();
  if (isHoliday || weekday < 1 || weekday > 5) return [];
  const day = TIMETABLE_DAYS[weekday - 1];
  const seen = new Set<string>();
  const items: CarryItem[] = [];
  for (const slot of timetable.slots) {
    if (!slot.highlights[day]) continue;
    const course = slot.courses[day]?.trim();
    if (!course || course === "-") continue;
    const match = course.match(/^(.*?)[（(](.+)[）)]$/);
    const name = match ? match[1].trim() : course;
    const note = match ? match[2].trim() : "";
    const label = !note ? name : note === "课本" ? `${name}课本` : note;
    if (seen.has(label)) continue;
    seen.add(label);
    items.push({ label, course: name });
  }
  return items;
}

/** "明天要带"里的一样：fromTimetable = 课表里高亮算出来的；pinned = 常驻（每天都提醒，带📌角标） */
export interface CarryEntry { label: string; pinned: boolean; fromTimetable: boolean }

/**
 * 那一天的清单：课表算出来的（去掉那天删掉的）→ 常驻的（排在课本后面）→ 那一天补充的（仅明天）；同名只留一个。
 */
export function buildCarryList(base: string[], pinned: string[], day?: { added: string[]; removed: string[] }): CarryEntry[] {
  const removed = new Set(day?.removed ?? []);
  const result: CarryEntry[] = [];
  const push = (label: string, entry: Omit<CarryEntry, "label">) => {
    const value = label.trim();
    if (!value || removed.has(value) || result.some((item) => item.label === value)) return;
    result.push({ label: value, ...entry });
  };
  base.forEach((label) => push(label, { pinned: false, fromTimetable: true }));
  pinned.forEach((label) => push(label, { pinned: true, fromTimetable: false }));
  (day?.added ?? []).forEach((label) => push(label, { pinned: false, fromTimetable: false }));
  return result;
}

/**
 * 编辑完的清单 → 常驻清单 + 那一天的补充 / 删掉。
 * 课表里的不在清单里了 = 那天删掉；常驻的不在清单里了 = 不再常驻（不算"删掉"）；没标常驻的新东西 = 仅明天。
 */
export function splitCarryEdit(base: string[], edited: CarryEntry[]): { pinned: string[]; day: { added: string[]; removed: string[] } } {
  return {
    pinned: edited.filter((item) => item.pinned && !item.fromTimetable).map((item) => item.label),
    day: {
      added: edited.filter((item) => !item.pinned && !base.includes(item.label)).map((item) => item.label),
      removed: base.filter((label) => !edited.some((item) => item.label === label)),
    },
  };
}
