import { describe, expect, it } from "vitest";
import { cloneSchoolTimetable, DEFAULT_SCHOOL_TIMETABLE } from "../../data/appSettingsRepository";
import { applyCarryOverride, carryItemsFor, diffCarry } from "../carryItems";

const date = (key: string) => new Date(`${key}T20:00:00`);

describe("明天要带", () => {
  it("取明天那一列高亮的课：课本写成“英语课本”，葫芦丝直接写，没括号写课名；去重", () => {
    // 2026-11-26 是周四：默认课表周四高亮 道法（课本）、美术、英语（课本）
    expect(carryItemsFor(DEFAULT_SCHOOL_TIMETABLE, date("2026-11-26")).map((item) => item.label)).toEqual(["道法课本", "美术", "英语课本"]);
    // 周二：道法（课本）、音乐（葫芦丝）、科学（课本）
    expect(carryItemsFor(DEFAULT_SCHOOL_TIMETABLE, date("2026-11-24")).map((item) => item.label)).toEqual(["道法课本", "葫芦丝", "科学课本"]);
    const twice = cloneSchoolTimetable(DEFAULT_SCHOOL_TIMETABLE);
    const pm2 = twice.slots.find((slot) => slot.id === "pm-2")!;
    pm2.courses.thursday = "英语（课本）";
    pm2.highlights.thursday = true;
    expect(carryItemsFor(twice, date("2026-11-26")).filter((item) => item.label === "英语课本")).toHaveLength(1);
  });

  it("周末、放假没有；没高亮的课不算", () => {
    expect(carryItemsFor(DEFAULT_SCHOOL_TIMETABLE, date("2026-11-28"))).toEqual([]);
    expect(carryItemsFor(DEFAULT_SCHOOL_TIMETABLE, date("2026-11-29"))).toEqual([]);
    expect(carryItemsFor(DEFAULT_SCHOOL_TIMETABLE, date("2026-11-26"), true)).toEqual([]);
    const none = cloneSchoolTimetable(DEFAULT_SCHOOL_TIMETABLE);
    none.slots.forEach((slot) => { slot.highlights.thursday = false; });
    expect(carryItemsFor(none, date("2026-11-26"))).toEqual([]);
  });

  it("手动补充 / 删掉：课表的 + 补充的 − 删掉的，同名只留一个；编辑结果和课表比出补充、删掉", () => {
    const base = ["道法课本", "美术", "英语课本"];
    expect(applyCarryOverride(base, { added: ["跳绳", "英语课本"], removed: ["美术"] })).toEqual(["道法课本", "英语课本", "跳绳"]);
    expect(applyCarryOverride(base)).toEqual(base);
    expect(diffCarry(base, ["道法课本", "英语课本", "跳绳"])).toEqual({ added: ["跳绳"], removed: ["美术"] });
  });
});
