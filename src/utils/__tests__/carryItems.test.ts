import { describe, expect, it } from "vitest";
import { cloneSchoolTimetable, DEFAULT_SCHOOL_TIMETABLE } from "../../data/appSettingsRepository";
import { buildCarryList, carryItemsFor, splitCarryEdit } from "../carryItems";

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

  it("清单 = 课表的（去掉那天删掉的）→ 常驻的 → 仅明天补充的；同名只留一个", () => {
    const base = ["道法课本", "美术", "英语课本"];
    const list = buildCarryList(base, ["水杯", "英语课本"], { added: ["跳绳"], removed: ["美术"] });
    expect(list.map((item) => [item.label, item.pinned])).toEqual([["道法课本", false], ["英语课本", false], ["水杯", true], ["跳绳", false]]);
    expect(buildCarryList(base, []).map((item) => item.label)).toEqual(base);
  });

  it("编辑结果拆成：常驻清单、那天补充、那天删掉（常驻的去掉 = 不再常驻，不算删掉）", () => {
    const base = ["道法课本", "美术", "英语课本"];
    const edited = [
      { label: "道法课本", pinned: false, fromTimetable: true },
      { label: "英语课本", pinned: false, fromTimetable: true },
      { label: "水杯", pinned: true, fromTimetable: false },
      { label: "跳绳", pinned: false, fromTimetable: false },
    ];
    expect(splitCarryEdit(base, edited)).toEqual({ pinned: ["水杯"], day: { added: ["跳绳"], removed: ["美术"] } });
    expect(splitCarryEdit(base, edited.filter((item) => item.label !== "水杯")).pinned).toEqual([]);
  });
});
