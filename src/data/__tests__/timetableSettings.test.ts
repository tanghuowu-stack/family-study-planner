import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCHOOL_TIMETABLE,
  cloneSchoolTimetable,
  normalizeSchoolTimetable,
  type SchoolTimetable,
} from "../appSettingsRepository";

describe("school timetable settings", () => {
  it("uses the supplied timetable when no saved setting exists", () => {
    const timetable = normalizeSchoolTimetable(null);
    expect(timetable.term).toBe("2026-2027学年度上学期");
    expect(timetable.slots).toHaveLength(9);
    expect(timetable.slots.find((slot) => slot.id === "pm-1")?.courses.thursday).toBe("英语（课本）");
    expect(timetable.slots.find((slot) => slot.id === "am-1")?.time).toBe("08:25-09:05");
    expect(timetable.slots.find((slot) => slot.id === "extended-3")?.courses.friday).toBe("云脑班");
    expect(timetable.slots.find((slot) => slot.id === "am-4")?.courses.tuesday).toBe("音乐（葫芦丝）");
    expect(timetable.slots.find((slot) => slot.id === "pm-1")?.courses.thursday).toBe("英语（课本）");
    expect(timetable.slots.find((slot) => slot.id === "extended-1")?.courses.monday).toBe("英语");
  });

  it("keeps the fixed row structure while accepting edited cells", () => {
    const partial = {
      version: 3,
      term: "新学期",
      slots: [{
        ...DEFAULT_SCHOOL_TIMETABLE.slots[0],
        time: "08:00-08:40",
        courses: { ...DEFAULT_SCHOOL_TIMETABLE.slots[0].courses, monday: "班会" },
      }],
    } as SchoolTimetable;
    const timetable = normalizeSchoolTimetable(partial);
    expect(timetable.term).toBe("新学期");
    expect(timetable.slots).toHaveLength(9);
    expect(timetable.slots[0].time).toBe("08:00-08:40");
    expect(timetable.slots[0].courses.monday).toBe("班会");
    expect(timetable.slots[1].courses.tuesday).toBe("数学");
  });

  it("migrates the original timetable corrections without overwriting other cells", () => {
    const legacy = {
      term: "2026-2027学年度上学期",
      slots: DEFAULT_SCHOOL_TIMETABLE.slots.map((slot) => ({
        ...slot,
        time: slot.section === "extended" ? slot.time : "",
        courses: {
          ...slot.courses,
          ...(slot.id === "extended-1" || slot.id === "extended-2" ? { wednesday: "俱乐部" } : {}),
          ...(slot.id === "extended-3" ? { friday: "看班" } : {}),
        },
      })),
    } as unknown as SchoolTimetable;
    const timetable = normalizeSchoolTimetable(legacy);
    expect(timetable.slots[0].time).toBe("08:25-09:05");
    expect(timetable.slots.find((slot) => slot.id === "extended-1")?.courses.wednesday).toBe("云脑班");
    expect(timetable.slots.find((slot) => slot.id === "extended-2")?.courses.wednesday).toBe("云脑班");
    expect(timetable.slots.find((slot) => slot.id === "extended-3")?.courses.friday).toBe("云脑班");
    expect(timetable.slots.find((slot) => slot.id === "am-3")?.courses.monday).toBe("英语（课本）");
    expect(timetable.slots.find((slot) => slot.id === "extended-1")?.courses.monday).toBe("英语");
  });

  it("clones nested course cells before editing", () => {
    const original = normalizeSchoolTimetable(null);
    const copy = cloneSchoolTimetable(original);
    copy.slots[0].courses.monday = "临时调课";
    expect(original.slots[0].courses.monday).toBe("数学");
  });
});
