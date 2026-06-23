// 轻量本地日历标注；缺少日期时返回空数据，不影响任务日历。
export type CalendarDisplaySettings = { showSolarTerms: boolean; showFestivals: boolean; showHolidayStatus: boolean };
export type CalendarAnnotation = { date: string; solarTerms: string[]; festivals: string[]; holidayStatus?: "休" | "班" };

const SETTINGS_KEY = "familyPlanner.calendarDisplaySettings.v1";
const DEFAULT_SETTINGS: CalendarDisplaySettings = { showSolarTerms: true, showFestivals: true, showHolidayStatus: true };
const solarTermNames = new Set(["小寒", "大寒", "立春", "雨水", "惊蛰", "春分", "清明", "谷雨", "立夏", "小满", "芒种", "夏至", "小暑", "大暑", "立秋", "处暑", "白露", "秋分", "寒露", "霜降", "立冬", "小雪", "大雪", "冬至"]);
const annotations: Record<string, string[]> = {
  "2026-01-01": ["元旦"], "2026-01-05": ["小寒"], "2026-01-20": ["大寒"], "2026-02-04": ["立春"], "2026-02-14": ["情人节"], "2026-02-17": ["春节"],
  "2026-02-19": ["雨水"], "2026-03-05": ["惊蛰"], "2026-03-08": ["妇女节"], "2026-03-20": ["春分"],
  "2026-04-05": ["清明"], "2026-04-20": ["谷雨"], "2026-05-01": ["劳动节"], "2026-05-05": ["立夏"],
  "2026-05-21": ["小满"], "2026-06-01": ["儿童节"], "2026-06-05": ["芒种"], "2026-06-19": ["端午"],
  "2026-06-21": ["夏至", "父亲节"], "2026-07-07": ["小暑"], "2026-07-23": ["大暑"], "2026-08-07": ["立秋"],
  "2026-08-23": ["处暑"], "2026-09-07": ["白露"], "2026-09-10": ["教师节"], "2026-09-23": ["秋分"],
  "2026-09-25": ["中秋"], "2026-10-01": ["国庆节"], "2026-10-08": ["寒露"], "2026-10-23": ["霜降"],
  "2026-11-07": ["立冬"], "2026-11-22": ["小雪"], "2026-12-07": ["大雪"], "2026-12-22": ["冬至"], "2026-12-25": ["圣诞节"],
  "2027-01-01": ["元旦"], "2027-01-05": ["小寒"], "2027-01-20": ["大寒"], "2027-02-04": ["立春"], "2027-02-06": ["春节"],
  "2027-02-14": ["情人节"], "2027-02-19": ["雨水"], "2027-03-06": ["惊蛰"], "2027-03-08": ["妇女节"],
  "2027-03-21": ["春分"], "2027-04-05": ["清明"], "2027-04-20": ["谷雨"], "2027-05-01": ["劳动节"],
  "2027-05-06": ["立夏"], "2027-05-21": ["小满"], "2027-06-01": ["儿童节"], "2027-06-06": ["芒种"],
  "2027-06-09": ["端午"], "2027-06-20": ["父亲节"], "2027-06-21": ["夏至"], "2027-07-07": ["小暑"], "2027-07-23": ["大暑"],
  "2027-08-08": ["立秋"], "2027-08-23": ["处暑"], "2027-09-08": ["白露"], "2027-09-10": ["教师节"],
  "2027-09-15": ["中秋"], "2027-09-23": ["秋分"], "2027-10-01": ["国庆节"], "2027-10-08": ["寒露"],
  "2027-10-23": ["霜降"], "2027-11-07": ["立冬"], "2027-11-22": ["小雪"], "2027-12-07": ["大雪"],
  "2027-12-22": ["冬至"], "2027-12-25": ["圣诞节"],
};

const holidayStatuses: Record<string, "休" | "班"> = {
  "2026-01-01": "休", "2026-01-02": "休", "2026-01-03": "休", "2026-01-04": "班",
  "2026-02-14": "班", "2026-02-15": "休", "2026-02-16": "休", "2026-02-17": "休", "2026-02-18": "休", "2026-02-19": "休", "2026-02-20": "休", "2026-02-21": "休", "2026-02-22": "休", "2026-02-23": "休", "2026-02-28": "班",
  "2026-04-04": "休", "2026-04-05": "休", "2026-04-06": "休",
  "2026-05-01": "休", "2026-05-02": "休", "2026-05-03": "休", "2026-05-04": "休", "2026-05-05": "休", "2026-05-09": "班",
  "2026-06-19": "休", "2026-06-20": "休", "2026-06-21": "休",
  "2026-09-20": "班", "2026-09-25": "休", "2026-09-26": "休", "2026-09-27": "休",
  "2026-10-01": "休", "2026-10-02": "休", "2026-10-03": "休", "2026-10-04": "休", "2026-10-05": "休", "2026-10-06": "休", "2026-10-07": "休", "2026-10-10": "班",
};

export function getCalendarDisplaySettings(): CalendarDisplaySettings {
  if (typeof localStorage === "undefined") return DEFAULT_SETTINGS;
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") }; } catch { return DEFAULT_SETTINGS; }
}

export function saveCalendarDisplaySettings(settings: CalendarDisplaySettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function getCalendarAnnotation(date: string, settings = getCalendarDisplaySettings()): CalendarAnnotation {
  const values = annotations[date] ?? [];
  return {
    date,
    solarTerms: settings.showSolarTerms ? values.filter((value) => solarTermNames.has(value)) : [],
    festivals: settings.showFestivals ? values.filter((value) => !solarTermNames.has(value)) : [],
    holidayStatus: settings.showHolidayStatus ? holidayStatuses[date] : undefined,
  };
}

export const getCalendarAnnotations = (date: string) => {
  const annotation = getCalendarAnnotation(date);
  return [...annotation.solarTerms, ...annotation.festivals];
};
