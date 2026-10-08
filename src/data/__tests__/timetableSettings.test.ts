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
    expect(timetable.term).toBe("五年级上学期");
    expect(timetable.slots).toHaveLength(9);
    expect(timetable.slots.find((slot) => slot.id === "pm-1")?.courses.thursday).toBe("英语（课本）");
    expect(timetable.slots.find((slot) => slot.id === "am-1")?.time).toBe("08:25-09:05");
    expect(timetable.slots.find((slot) => slot.id === "extended-3")?.courses.friday).toBe("云脑班");
    expect(timetable.slots.find((slot) => slot.id === "am-4")?.courses.tuesday).toBe("音乐（葫芦丝）");
    expect(timetable.slots.find((slot) => slot.id === "pm-1")?.courses.thursday).toBe("英语（课本）");
    expect(timetable.slots.find((slot) => slot.id === "extended-1")?.courses.monday).toBe("英语");
  });

  it("upgrades a saved old default term without replacing a custom term", () => {
    const saved = cloneSchoolTimetable(DEFAULT_SCHOOL_TIMETABLE);
    saved.term = "2026-2027学年度上学期";
    expect(normalizeSchoolTimetable(saved).term).toBe("五年级上学期");
    saved.term = "六年级上学期";
    expect(normalizeSchoolTimetable(saved).term).toBe("六年级上学期");
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

  it("highlights textbook and tool lessons while leaving Monday extended English plain", () => {
    const timetable = normalizeSchoolTimetable(null);
    const slot = (id: string) => timetable.slots.find((item) => item.id === id)!;
    expect(slot("am-3").highlights.monday).toBe(true);
    expect(slot("am-3").highlights.tuesday).toBe(true);
    expect(slot("am-3").highlights.wednesday).toBe(true);
    expect(slot("am-4").highlights.tuesday).toBe(true);
    expect(slot("am-4").highlights.thursday).toBe(true);
    expect(slot("pm-1").highlights.monday).toBe(true);
    expect(slot("extended-1").highlights.monday).toBe(false);
    expect(slot("extended-1").highlights.friday).toBe(false);
  });

  it("adds highlights to saved courses and preserves manual changes", () => {
    const saved = cloneSchoolTimetable(DEFAULT_SCHOOL_TIMETABLE);
    const club = saved.slots.find((slot) => slot.id === "extended-1")!;
    club.courses.wednesday = "俱乐部";
    club.courses.friday = "走班";
    club.highlights = undefined as unknown as typeof club.highlights;
    const migrated = normalizeSchoolTimetable(saved);
    const highlighted = migrated.slots.find((slot) => slot.id === "extended-1")!;
    expect(highlighted.highlights.wednesday).toBe(true);
    expect(highlighted.highlights.friday).toBe(true);
    highlighted.highlights.wednesday = false;
    expect(normalizeSchoolTimetable(migrated).slots.find((slot) => slot.id === "extended-1")?.highlights.wednesday).toBe(false);
    const copy = cloneSchoolTimetable(migrated);
    copy.slots.find((slot) => slot.id === "extended-1")!.highlights.friday = false;
    expect(highlighted.highlights.friday).toBe(true);
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
    expect(timetable.term).toBe("五年级上学期");
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
