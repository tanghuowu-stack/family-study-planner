/**
 * 云端上传(taskToRow)/下载(rowToTask) 字段逐一对照回归测试（2026-07-19）。
 * 根因：rowToTask 漏了 actualMinutes 的映射——taskToRow 正确写入 actual_minutes 列，
 * 但 rowToTask 转换云端行回本地 Task 对象时没读回来，导致每次云端 pull 后任务级实际用时
 * 静默消失（本体从未变化，只是本地缓存被"缺字段"的转换结果覆盖）。
 * 本测试对 Task 的每个直接映射字段做"写入→读回"往返，任何一侧漏映射都会在这里炸。
 * （totalAmount/amountUnit/splitCount/amountPerSession/readingTargetCount/readingTargetUnit/
 * allowedWeekdays/allowWeekend/enableTimer 走 metadata jsonb 整体透传，结构上不会出现单向漏
 * 映射，不在本测试逐字段列表里；month 字段云端 schema 目前没有对应列，上传下载都不映射，
 * 是另一类"整体缺失"问题而非本测试要防的"单向漏映射"，已记入 PROJECT_GUIDE 待办。）
 */
import { describe, expect, it } from "vitest";
import { taskToRow } from "../../data/cloudRepository";
import { rowToTask } from "../cloudRead";
import type { Task } from "../../types/task";

const FAMILY_ID = "fam-parity-test";

function fullTask(): Task {
  return {
    id: "task-parity-1",
    title: "字段对照测试任务",
    mainCategory: "extraHomework",
    subCategory: "chinese",
    extraContentType: "homework",
    courseId: "course-1",
    timeType: "recurring",
    date: "2026-07-19",
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    weekStart: "2026-07-13",
    recurrence: { frequency: "daily", startDate: "2026-07-01", endDate: "2026-07-31" },
    schedulePattern: "dailyRecurring",
    specificDates: ["2026-07-01", "2026-07-15"],
    rangeWeekdays: [1, 3, 5],
    assignmentWindow: { sourceClassDate: "2026-07-01", startDate: "2026-07-02", endDate: "2026-07-08" },
    weeklyQuota: { enabled: true, targetCount: 3, unit: "篇", isWeeklyRecurring: true, allowAutoDistribute: true, allowRollover: false },
    applicablePeriodType: "holiday",
    planPeriodId: "period-1",
    status: "todo",
    rolloverMode: "autoNextDay",
    allowRollover: true,
    sortOrder: 7,
    childVisible: true,
    note: "测试备注",
    startTime: "09:30",
    endTime: "10:15",
    estimatedMinutes: 45,
    actualMinutes: 38,
    location: "书房",
    important: true,
    calendarVisibility: "hide",
    parentTaskId: "parent-1",
    sessionIndex: 2,
    allocationWeekStart: "2026-07-13",
    enableStreak: true,
    streakStartDate: "2026-07-02",
    completedAt: "2026-07-19T10:00:00.000Z",
    deletedAt: "2026-07-19T11:00:00.000Z",
    deletedByDevice: "Mac Chrome",
    deletedByActor: "本地用户",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-07-19T12:00:00.000Z",
  };
}

// row 列名 → task 字段名的对照表（time/startTime 两个字段共用 start_time 一列，是刻意的别名，不是漏映射）
const FIELD_PAIRS: [keyof Task, unknown][] = (() => {
  const t = fullTask();
  return [
    ["title", t.title], ["mainCategory", t.mainCategory], ["subCategory", t.subCategory],
    ["extraContentType", t.extraContentType], ["courseId", t.courseId], ["timeType", t.timeType],
    ["date", t.date], ["startDate", t.startDate], ["endDate", t.endDate], ["weekStart", t.weekStart],
    ["recurrence", t.recurrence], ["schedulePattern", t.schedulePattern], ["specificDates", t.specificDates],
    ["rangeWeekdays", t.rangeWeekdays], ["assignmentWindow", t.assignmentWindow], ["weeklyQuota", t.weeklyQuota],
    ["applicablePeriodType", t.applicablePeriodType], ["planPeriodId", t.planPeriodId], ["status", t.status],
    ["rolloverMode", t.rolloverMode], ["allowRollover", t.allowRollover], ["sortOrder", t.sortOrder],
    ["childVisible", t.childVisible], ["note", t.note], ["startTime", t.startTime], ["endTime", t.endTime],
    ["estimatedMinutes", t.estimatedMinutes], ["actualMinutes", t.actualMinutes], ["location", t.location],
    ["important", t.important], ["calendarVisibility", t.calendarVisibility], ["parentTaskId", t.parentTaskId],
    ["sessionIndex", t.sessionIndex], ["allocationWeekStart", t.allocationWeekStart],
    ["enableStreak", t.enableStreak], ["streakStartDate", t.streakStartDate],
    ["completedAt", t.completedAt], ["deletedAt", t.deletedAt], ["deletedByDevice", t.deletedByDevice],
    ["deletedByActor", t.deletedByActor], ["createdAt", t.createdAt], ["updatedAt", t.updatedAt],
  ];
})();

describe("taskToRow / rowToTask 字段逐一对照（2026-07-19，防 actualMinutes 类单向漏映射回归）", () => {
  const task = fullTask();
  const row = taskToRow(task, FAMILY_ID);
  const roundTripped = rowToTask(row);

  it.each(FIELD_PAIRS)("字段 %s 上传后能从云端行正确读回", (field, expected) => {
    expect(roundTripped[field]).toEqual(expected);
  });

  it("id 与 family_id 独立于上述循环，另行确认", () => {
    expect(row.family_id).toBe(FAMILY_ID);
    expect(roundTripped.id).toBe(task.id);
  });
});
