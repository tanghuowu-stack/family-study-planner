/**
 * canEndRecurring / isEndedRecurring 边界回归（2026-07-23，2026-07-23 二次修复扩充）。
 *
 * 「结束」≠「完成」：不管是手动点「结束」还是排期本来就有界，R1 铁律下 occurrence 类任务
 * 本体 status 恒为 todo/cancelled、不会变成 done——排期已经过去的任务不会自动落进"已完成"
 * 分组，会一直卡在"待办"列表里（用户反馈发现，见 change-log）。
 *
 * 教训：第一版 isEndedRecurring 只覆盖了 dailyRecurring/weeklyRecurring（判 recurrence.endDate），
 * 漏了 dateRangeDaily/dateRangeWeekdays（判 task.endDate）和 specificDates（判日期列表最大值）——
 * 同一个 bug 换个 schedulePattern 又冒出来一次。本文件对 5 种 recurring schedulePattern 逐一
 * 覆盖"已结束/未结束"边界，防止再次漏某一种模式。
 */
import { describe, expect, it } from "vitest";
import { canEndRecurring, isEndedRecurring } from "../taskMeta";

describe("dailyRecurring/weeklyRecurring：canEndRecurring / isEndedRecurring 互斥边界", () => {
  const dailyTask = (endDate?: string) => ({
    timeType: "recurring" as const,
    schedulePattern: "dailyRecurring" as const,
    recurrence: { endDate },
  });

  it("无 endDate（长期）：可结束，未结束", () => {
    const t = dailyTask(undefined);
    expect(canEndRecurring(t, "2026-07-20")).toBe(true);
    expect(isEndedRecurring(t, "2026-07-20")).toBe(false);
  });

  it("endDate 等于今天：仍可结束（今天还在排期内），未结束", () => {
    const t = dailyTask("2026-07-20");
    expect(canEndRecurring(t, "2026-07-20")).toBe(true);
    expect(isEndedRecurring(t, "2026-07-20")).toBe(false);
  });

  it("endDate 早于今天一天：不可再结束，已结束（互斥边界，两者不同时为 true）", () => {
    const t = dailyTask("2026-07-19");
    expect(canEndRecurring(t, "2026-07-20")).toBe(false);
    expect(isEndedRecurring(t, "2026-07-20")).toBe(true);
  });

  it("weeklyRecurring 同理（只是模式名不同，判定逻辑共用）", () => {
    const t = { timeType: "recurring" as const, schedulePattern: "weeklyRecurring" as const, recurrence: { endDate: "2026-07-19" } };
    expect(canEndRecurring(t, "2026-07-20")).toBe(false);
    expect(isEndedRecurring(t, "2026-07-20")).toBe(true);
  });
});

describe("dateRangeDaily/dateRangeWeekdays：有界排期，靠 task.endDate 判断，不适用「结束」按钮", () => {
  it("真实复现用户报告的 bug：dateRangeDaily 的 task.endDate 早于今天——应判已结束，不显示「结束」按钮", () => {
    // 对应"大增背诵：24课内容+卷子40-41"：07-04～07-25 每天，07-25 早于今天
    const t = { timeType: "recurring" as const, schedulePattern: "dateRangeDaily" as const, startDate: "2026-07-04", endDate: "2026-07-25" };
    expect(isEndedRecurring(t, "2026-07-26")).toBe(true);
    expect(canEndRecurring(t, "2026-07-26")).toBe(false); // 有界排期本来就有终点，不需要手动结束
  });

  it("dateRangeDaily 的 endDate 还没到：未结束", () => {
    const t = { timeType: "recurring" as const, schedulePattern: "dateRangeDaily" as const, startDate: "2026-07-04", endDate: "2026-08-20" };
    expect(isEndedRecurring(t, "2026-07-20")).toBe(false);
  });

  it("dateRangeDaily 只看 task.endDate，不理会同名的 recurrence.endDate（字段来源不能搞混）", () => {
    const t = { timeType: "recurring" as const, schedulePattern: "dateRangeDaily" as const, startDate: "2026-07-04", endDate: "2026-08-20", recurrence: { endDate: "2026-07-01" } };
    expect(isEndedRecurring(t, "2026-07-20")).toBe(false); // task.endDate=08-20 还没到，即使 recurrence.endDate 早已过期也不算
  });

  it("dateRangeWeekdays 同理", () => {
    const t = { timeType: "recurring" as const, schedulePattern: "dateRangeWeekdays" as const, startDate: "2026-06-01", endDate: "2026-06-30" };
    expect(isEndedRecurring(t, "2026-07-20")).toBe(true);
    expect(canEndRecurring(t, "2026-07-20")).toBe(false);
  });
});

describe("specificDates：靠指定日期列表的最大值判断", () => {
  it("列表最大日期早于今天：已结束", () => {
    const t = { timeType: "recurring" as const, schedulePattern: "specificDates" as const, specificDates: ["2026-07-01", "2026-07-10", "2026-07-05"] };
    expect(isEndedRecurring(t, "2026-07-11")).toBe(true);
    expect(canEndRecurring(t, "2026-07-11")).toBe(false);
  });

  it("列表里还有未来日期：未结束", () => {
    const t = { timeType: "recurring" as const, schedulePattern: "specificDates" as const, specificDates: ["2026-07-01", "2026-08-01"] };
    expect(isEndedRecurring(t, "2026-07-20")).toBe(false);
  });
});

describe("非 recurring 类型 / 无排期终点：两者恒为 false", () => {
  it("singleDate 任务不适用「结束」概念", () => {
    const t = { timeType: "singleDate" as const };
    expect(canEndRecurring(t, "2026-07-20")).toBe(false);
    expect(isEndedRecurring(t, "2026-07-20")).toBe(false);
  });

  it("dateRange（非 recurring 的整体任务）不适用", () => {
    const t = { timeType: "dateRange" as const };
    expect(canEndRecurring(t, "2026-07-20")).toBe(false);
    expect(isEndedRecurring(t, "2026-07-20")).toBe(false);
  });
});
