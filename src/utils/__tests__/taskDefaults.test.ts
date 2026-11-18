/**
 * 新建任务默认设置（2026-11-18）：getTaskDefaults 覆盖规则表每一行、学校作业按所选日期的星期、
 * 课外班作业截止日（课程有 / 无固定上课星期）；mergeTaskDefaults 只填没被手动改过的字段。
 * 日期：2026-11-16 周一，11-19 周四，11-20 周五，11-21 周六，11-22 周日。
 */
import { describe, expect, it } from "vitest";
import type { Course, TaskDraft } from "../../types/task";
import { WEEKLY_TIMES_DEFAULT, courseHomeworkDeadline, getTaskDefaults, mergeTaskDefaults, type TouchedField } from "../taskDefaults";

const course = (overrides: Partial<Course> = {}): Course => ({
  id: "c1", name: "大增语文", mainCategory: "extraHomework", subCategory: "chinese", isClass: true, status: "active",
  schedule: { weekdays: [6], startTime: "08:30", endTime: "10:00" }, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", ...overrides,
});
const NEXT = { rolloverMode: "autoNextDay", allowRollover: true };
const END = { rolloverMode: "skipIfMissed", allowRollover: false };

describe("getTaskDefaults：规则表", () => {
  it.each(["2026-11-16", "2026-11-19"])("学校作业 周一至周四（%s）：单日、顺延至次日", (date) => {
    expect(getTaskDefaults("school", "chinese", date)).toMatchObject({ timeType: "singleDate", date, ...NEXT });
  });
  it("学校作业 周五：时段 周五至周日、顺延至次日", () => {
    expect(getTaskDefaults("school", "math", "2026-11-20")).toMatchObject({ timeType: "dateRange", startDate: "2026-11-20", endDate: "2026-11-22", ...NEXT });
  });
  it("学校作业 周六（所选日期，不按录入当天）：单日", () => {
    expect(getTaskDefaults("school", "english", "2026-11-21")).toMatchObject({ timeType: "singleDate", date: "2026-11-21", ...NEXT });
  });
  it("学校作业 还没选学科也能按日期给安排", () => {
    expect(getTaskDefaults("school", "", "2026-11-20")).toMatchObject({ timeType: "dateRange", endDate: "2026-11-22" });
  });

  it.each([["chinese"], ["math"], ["english"]])("课外班 %s 作业：时段、顺延至次日（课程库没有这门课 → 所选日期加 6 天）", (sub) => {
    expect(getTaskDefaults("extraHomework", sub, "2026-11-19", { extraContentType: "homework", courses: [] }))
      .toMatchObject({ timeType: "dateRange", startDate: "2026-11-19", endDate: "2026-11-25", ...NEXT });
  });
  it("课外班作业：课程有固定上课星期（周六）→ 截止到下次上课前一天", () => {
    const courses = [course()];
    // 周六上课当天录的作业：截止到下周五
    expect(getTaskDefaults("extraHomework", "chinese", "2026-11-21", { extraContentType: "homework", courses })).toMatchObject({ startDate: "2026-11-21", endDate: "2026-11-27" });
    // 周四录：截止到周五
    expect(getTaskDefaults("extraHomework", "chinese", "2026-11-19", { extraContentType: "homework", courses })).toMatchObject({ endDate: "2026-11-20" });
    // 周五录（明天上课）：截止就是当天
    expect(getTaskDefaults("extraHomework", "chinese", "2026-11-20", { extraContentType: "homework", courses })).toMatchObject({ endDate: "2026-11-20" });
  });
  it("课外班作业：课程没有固定上课星期 / 已结课 / 别的学科 → 加 6 天", () => {
    for (const courses of [[course({ schedule: undefined })], [course({ status: "ended" })], [course({ subCategory: "math" })]]) {
      expect(getTaskDefaults("extraHomework", "chinese", "2026-11-21", { extraContentType: "homework", courses })).toMatchObject({ endDate: "2026-11-27" });
    }
    expect(getTaskDefaults("extraHomework", "math", "2026-11-19", { extraContentType: "homework", courses: [course({ subCategory: "math", schedule: { weekdays: [] } })] })).toMatchObject({ endDate: "2026-11-25" });
  });
  it("课外班作业：选中的课程优先（每周日上课）", () => {
    expect(getTaskDefaults("extraHomework", "math", "2026-11-19", { extraContentType: "homework", course: course({ subCategory: "math", schedule: { weekdays: [0] } }) }))
      .toMatchObject({ endDate: "2026-11-21" });
  });
  it("截止日计算：多个上课日取最近的一次", () => {
    expect(courseHomeworkDeadline("2026-11-16", [3, 6])).toBe("2026-11-17");
    expect(courseHomeworkDeadline("2026-11-16", undefined)).toBe("2026-11-22");
  });

  it("课外班上课：单日、到期结束，上课时间从课程库带出", () => {
    expect(getTaskDefaults("extraHomework", "chinese", "2026-11-21", { extraContentType: "class", courses: [course()] }))
      .toMatchObject({ timeType: "singleDate", date: "2026-11-21", ...END, startTime: "08:30", endTime: "10:00" });
    expect(getTaskDefaults("extraHomework", "english", "2026-11-21", { extraContentType: "class", courses: [course()] }))
      .toMatchObject({ timeType: "singleDate", ...END, startTime: undefined });
  });

  it.each(["piano", "swimming", "rollerSkating"])("兴趣班上课 %s：单日、到期结束", (sub) => {
    expect(getTaskDefaults("interestClass", sub, "2026-11-19")).toMatchObject({ timeType: "singleDate", date: "2026-11-19", ...END });
  });
  it("兴趣班 勾了算作上课的自定义项：单日、到期结束", () => {
    expect(getTaskDefaults("interestClass", "custom:跳绳课", "2026-11-19", { extraContentType: "class" })).toMatchObject({ timeType: "singleDate", ...END });
  });
  it("兴趣班 钢琴练习：每周几次，沿用现有默认（每周 3 次），不设未完成处理", () => {
    const defaults = getTaskDefaults("interestClass", "pianoPractice", "2026-11-19");
    expect(defaults).toMatchObject({ timeType: "weeklyTimes", startDate: "2026-11-19", weeklyQuota: WEEKLY_TIMES_DEFAULT });
    expect(defaults.rolloverMode).toBeUndefined();
    expect(WEEKLY_TIMES_DEFAULT.targetCount).toBe(3);
  });

  it("其他安排 其他（提醒）：单日、顺延至次日", () => {
    expect(getTaskDefaults("temporary", "other", "2026-11-19")).toMatchObject({ timeType: "singleDate", date: "2026-11-19", ...NEXT });
  });
  it.each(["examCompetition", "leisure"])("其他安排 %s：单日、到期结束", (sub) => {
    expect(getTaskDefaults("temporary", sub, "2026-11-19")).toMatchObject({ timeType: "singleDate", ...END });
  });
  it("其他安排 旅游：时段、到期结束", () => {
    expect(getTaskDefaults("temporary", "travel", "2026-11-19")).toMatchObject({ timeType: "dateRange", startDate: "2026-11-19", endDate: "2026-11-19", ...END });
  });
  it("没选二级类型的课外班 / 兴趣班 / 其他安排：不给默认", () => {
    expect(getTaskDefaults("extraHomework", "", "2026-11-19")).toEqual({});
    expect(getTaskDefaults("interestClass", "", "2026-11-19")).toEqual({});
    expect(getTaskDefaults("temporary", "", "2026-11-19")).toEqual({});
  });
});

describe("mergeTaskDefaults：手动改过的字段不被覆盖", () => {
  const draft = (overrides: Partial<TaskDraft> = {}): TaskDraft => ({
    title: "", mainCategory: "school", subCategory: "chinese", timeType: "singleDate", schedulePattern: "singleDate", date: "2026-11-19",
    calendarVisibility: "show", status: "todo", rolloverMode: "autoNextDay", allowRollover: true, childVisible: true, sortOrder: 0, ...overrides,
  });
  const touched = (...fields: TouchedField[]) => new Set<TouchedField>(fields);

  it("什么都没改：切到旅游 → 时段、到期结束", () => {
    const next = mergeTaskDefaults(draft({ mainCategory: "temporary", subCategory: "travel" }), getTaskDefaults("temporary", "travel", "2026-11-19"), touched());
    expect(next).toMatchObject({ timeType: "dateRange", date: undefined, startDate: "2026-11-19", endDate: "2026-11-19", rolloverMode: "skipIfMissed", allowRollover: false });
  });
  it("手动改过未完成处理：切换分类后保留", () => {
    const current = draft({ rolloverMode: "keepOverdue", allowRollover: false });
    const next = mergeTaskDefaults({ ...current, mainCategory: "temporary", subCategory: "leisure" }, getTaskDefaults("temporary", "leisure", "2026-11-19"), touched("rollover"));
    expect(next).toMatchObject({ rolloverMode: "keepOverdue", allowRollover: false, timeType: "singleDate" });
  });
  it("手动改过安排方式：切到课外班作业仍是单日", () => {
    const next = mergeTaskDefaults(draft({ mainCategory: "extraHomework", extraContentType: "homework" }), getTaskDefaults("extraHomework", "chinese", "2026-11-19", { extraContentType: "homework" }), touched("timeType"));
    expect(next).toMatchObject({ timeType: "singleDate", date: "2026-11-19", rolloverMode: "autoNextDay" });
  });
  it("手动改过截止日：换开始日后截止日保留（不早于开始日时）", () => {
    const current = draft({ mainCategory: "extraHomework", timeType: "dateRange", date: undefined, startDate: "2026-11-19", endDate: "2026-11-30" });
    expect(mergeTaskDefaults(current, getTaskDefaults("extraHomework", "chinese", "2026-11-20", { extraContentType: "homework" }), touched("endDate")).endDate).toBe("2026-11-30");
    expect(mergeTaskDefaults(current, getTaskDefaults("extraHomework", "chinese", "2026-12-05", { extraContentType: "homework" }), touched("endDate")).endDate).toBe("2026-12-11");
  });
  it("手动改过上课时间：带出课程时间时不覆盖；没改过时换成课程时间", () => {
    const current = draft({ mainCategory: "extraHomework", extraContentType: "class", startTime: "19:00", endTime: "20:00" });
    const defaults = getTaskDefaults("extraHomework", "chinese", "2026-11-21", { extraContentType: "class", courses: [course()] });
    expect(mergeTaskDefaults(current, defaults, touched("time"))).toMatchObject({ startTime: "19:00", endTime: "20:00" });
    expect(mergeTaskDefaults(current, defaults, touched())).toMatchObject({ startTime: "08:30", endTime: "10:00" });
  });
  it("学校作业改选周五：没改过安排 → 时段周五至周日；改过 → 保持单日", () => {
    const defaults = getTaskDefaults("school", "chinese", "2026-11-20");
    expect(mergeTaskDefaults(draft({ date: "2026-11-20" }), defaults, touched())).toMatchObject({ timeType: "dateRange", startDate: "2026-11-20", endDate: "2026-11-22" });
    expect(mergeTaskDefaults(draft({ date: "2026-11-20" }), defaults, touched("timeType"))).toMatchObject({ timeType: "singleDate", date: "2026-11-20" });
  });
  it("空默认（没选二级类型）不动草稿的安排", () => {
    const current = draft({ startTime: undefined });
    expect(mergeTaskDefaults(current, {}, touched())).toEqual({ ...current, startTime: undefined, endTime: undefined });
  });
});
