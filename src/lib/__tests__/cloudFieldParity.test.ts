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
import { checklistItemRows, taskToRow } from "../../data/cloudRepository";
import { rowToChecklistItem, rowToTask } from "../cloudRead";
import { buildMetadata as buildUploadMetadata } from "../cloudUpload";
import type { ChecklistItem, Task } from "../../types/task";

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
    pauseDuringTravel: false,
    habitKey: "habit-project-1",
    dayNotes: { "2026-07-18": "语用2篇", "2026-07-19": "听力 Part 1" },
    weeklyLog: { "2026-07-14": 1, "2026-07-16": 2 },
    practicePoints: 2,
    practiceExtraScores: false,
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
    ["enableStreak", t.enableStreak], ["streakStartDate", t.streakStartDate], ["pauseDuringTravel", t.pauseDuringTravel],
    ["habitKey", t.habitKey], ["dayNotes", t.dayNotes], ["weeklyLog", t.weeklyLog],
    ["practicePoints", t.practicePoints], ["practiceExtraScores", t.practiceExtraScores],
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

// ─── 维护面板「上传本地数据」（cloudUpload）的 metadata 映射面（2026-11-24 随积分设置纳入）────
// cloudUpload 的 buildMetadata 是独立的一份，新加的 metadata 字段漏写在这里时，上传后再读回会丢。
describe("cloudUpload.buildMetadata / rowToTask 往返", () => {
  const task = fullTask();
  const roundTripped = rowToTask({ ...taskToRow(task, FAMILY_ID), metadata: buildUploadMetadata(task) });
  it.each([
    ["habitKey", task.habitKey], ["dayNotes", task.dayNotes], ["weeklyLog", task.weeklyLog], ["pauseDuringTravel", task.pauseDuringTravel],
    ["practicePoints", task.practicePoints], ["practiceExtraScores", task.practiceExtraScores],
  ] as [keyof Task, unknown][])("metadata 字段 %s 经维护面板上传后能读回", (field, expected) => {
    expect(roundTripped[field]).toEqual(expected);
  });
});

// ─── 小项：checklistItemRows ↔ rowToChecklistItem（2026-09-19，随 completedDate 列一起纳入 parity）────
// 读侧三个映射面（cloudRepository 拉取 / cloudRead 预览 / cloudDownload 强制下载）已收敛为
// rowToChecklistItem 一个定义，所以这一对覆盖住就等于三处都覆盖住；写侧 cloudUpload 仍是独立内联，改它时手动核对。
function fullChecklistItem(): ChecklistItem {
  return {
    id: "ci-parity-1",
    title: "板块五P35：词语成语听写",
    done: true,
    completedDate: "2026-09-08",
    sortOrder: 3,
    estimatedMinutes: 15,
    actualMinutes: 12,
  };
}

const CHECKLIST_FIELD_PAIRS: [keyof ChecklistItem, unknown][] = (() => {
  const c = fullChecklistItem();
  return [
    ["title", c.title], ["done", c.done], ["completedDate", c.completedDate],
    ["sortOrder", c.sortOrder], ["estimatedMinutes", c.estimatedMinutes], ["actualMinutes", c.actualMinutes],
  ];
})();

describe("checklistItemRows / rowToChecklistItem 字段逐一对照", () => {
  const item = fullChecklistItem();
  const task = { ...fullTask(), checklistItems: [item] };
  const [row] = checklistItemRows(task, FAMILY_ID);
  const roundTripped = rowToChecklistItem(row);

  it.each(CHECKLIST_FIELD_PAIRS)("小项字段 %s 上传后能从云端行正确读回", (field, expected) => {
    expect(roundTripped[field]).toEqual(expected);
  });

  it("id / family_id / task_id 另行确认", () => {
    expect(roundTripped.id).toBe(item.id);
    expect(row.family_id).toBe(FAMILY_ID);
    expect(row.task_id).toBe(task.id);
  });

  it("取消勾选后 completedDate=undefined 必须上传为 null（否则云端旧日期清不掉）", () => {
    const [r] = checklistItemRows({ ...task, checklistItems: [{ ...item, done: false, completedDate: undefined }] }, FAMILY_ID);
    expect(r.completed_date).toBeNull();
    expect(rowToChecklistItem(r).completedDate).toBeUndefined();
  });
});
