const memStore = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => void memStore.set(k, String(v)),
  removeItem: (k: string) => void memStore.delete(k),
  clear: () => memStore.clear(),
};
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../lib/supabase", () => ({ supabaseConfigured: false, supabase: null }));

import { db } from "../db";
import { applyTimetableAfterSchoolFixOnce, cloneSchoolTimetable, DEFAULT_SCHOOL_TIMETABLE, loadSchoolTimetable, saveSchoolTimetable } from "../appSettingsRepository";

/** 2026-11-25 用户更正课后服务：周三课后三段都是云脑班；周五第三段是文学社 */
describe("课后服务更正（只改一次）", () => {
  beforeEach(async () => { memStore.clear(); await Promise.all(db.tables.map((table) => table.clear())); });

  it("已存课表周三课后 3 是语文、周五课后 3 是云脑班的改掉；只改一次，之后编辑的不覆盖", async () => {
    const old = cloneSchoolTimetable(DEFAULT_SCHOOL_TIMETABLE);
    const third = old.slots.find((slot) => slot.id === "extended-3")!;
    third.courses.wednesday = "语文";
    third.courses.friday = "云脑班";
    await saveSchoolTimetable(old);
    const fixed = await applyTimetableAfterSchoolFixOnce(await loadSchoolTimetable());
    expect(fixed.slots.find((slot) => slot.id === "extended-3")?.courses).toMatchObject({ monday: "数学", wednesday: "云脑班", friday: "文学社" });
    expect((await loadSchoolTimetable()).slots.find((slot) => slot.id === "extended-3")?.courses.friday).toBe("文学社");
    // 之后家长又改回来，不再被改
    const edited = cloneSchoolTimetable(fixed);
    edited.slots.find((slot) => slot.id === "extended-3")!.courses.friday = "云脑班";
    await saveSchoolTimetable(edited);
    const again = await applyTimetableAfterSchoolFixOnce(await loadSchoolTimetable());
    expect(again.slots.find((slot) => slot.id === "extended-3")?.courses.friday).toBe("云脑班");
  });

  it("别的课不碰：周三课后 3 已经是别的课就不改", async () => {
    const old = cloneSchoolTimetable(DEFAULT_SCHOOL_TIMETABLE);
    old.slots.find((slot) => slot.id === "extended-3")!.courses.wednesday = "数学";
    await saveSchoolTimetable(old);
    const fixed = await applyTimetableAfterSchoolFixOnce(await loadSchoolTimetable());
    expect(fixed.slots.find((slot) => slot.id === "extended-3")?.courses.wednesday).toBe("数学");
  });
});
