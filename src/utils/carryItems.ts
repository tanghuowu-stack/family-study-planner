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
