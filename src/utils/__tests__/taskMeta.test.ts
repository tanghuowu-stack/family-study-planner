/**
 * canEndRecurring / isEndedRecurring 边界回归（2026-07-23）。
 * 「结束」≠「完成」：结束只改 recurrence.endDate，occurrence 类任务本体 status 按 R1
 * 恒为 todo/cancelled，不会自动落进"已完成"分组——任务管理页靠 isEndedRecurring 把
 * 已结束的重复任务单独分组，不再和真正待办的任务混在一起（用户反馈发现，见 change-log）。
 * 两个判定必须互斥、边界一致，否则会出现"某任务哪个分组都不在/两个分组都在"的缝隙。
 */
import { describe, expect, it } from "vitest";
import { canEndRecurring, isEndedRecurring } from "../taskMeta";

const dailyTask = (endDate?: string) => ({
  timeType: "recurring" as const,
  schedulePattern: "dailyRecurring" as const,
  recurrence: { endDate },
});

describe("canEndRecurring / isEndedRecurring 互斥边界", () => {
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

  it("非 recurring / 非 daily-weekly 模式：两者恒为 false（有界排期不适用「结束」概念）", () => {
    const singleDate = { timeType: "singleDate" as const, recurrence: undefined };
    const dateRangeDaily = { timeType: "recurring" as const, schedulePattern: "dateRangeDaily" as const, recurrence: { endDate: "2026-07-19" } };
    expect(canEndRecurring(singleDate, "2026-07-20")).toBe(false);
    expect(isEndedRecurring(singleDate, "2026-07-20")).toBe(false);
    expect(canEndRecurring(dateRangeDaily, "2026-07-20")).toBe(false);
    expect(isEndedRecurring(dateRangeDaily, "2026-07-20")).toBe(false);
  });
});
