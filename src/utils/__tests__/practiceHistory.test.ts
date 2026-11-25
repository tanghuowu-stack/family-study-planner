import { describe, expect, it } from "vitest";
import type { Task } from "../../types/task";
import { practiceHistory } from "../weeklyTimes";

const practice = (id: string, extra: Partial<Task>): Task => ({
  id, title: id, mainCategory: "interestClass", subCategory: "pianoPractice", timeType: "weeklyTimes", startDate: "2026-11-02",
  weeklyQuota: { enabled: true, targetCount: 3, unit: "次", isWeeklyRecurring: true, allowAutoDistribute: false, allowRollover: false },
  status: "todo", rolloverMode: "keepOverdue", allowRollover: false, childVisible: true, createdAt: "", updatedAt: "", ...extra,
} as Task);

describe("统计 › 练习：每项一周一周的完成情况", () => {
  it("每格是那周做了几次 / 目标、是否达标；还没开始、或第一次记录之前的周是 null；整段都没在进行的项不列", () => {
    const tasks = [
      practice("钢琴", { weeklyLog: { "2026-11-03": 1, "2026-11-05": 2, "2026-11-10": 1 } }),
      practice("背诗", { startDate: "2026-11-16", weeklyLog: { "2026-11-17": 1 } }),
      practice("已删", { deletedAt: "2026-11-20T00:00:00.000Z" }),
      practice("早停", { startDate: "2026-09-01", endDate: "2026-10-01" }),
    ];
    const rows = practiceHistory(tasks, ["2026-11-02", "2026-11-09", "2026-11-16"]);
    expect(rows.map((row) => row.taskId)).toEqual(["钢琴", "背诗"]);
    expect(rows[0].cells.map((cell) => cell && [cell.done, cell.target, cell.reached])).toEqual([[3, 3, true], [1, 3, false], [0, 3, false]]);
    expect(rows[1].cells[0]).toBeNull();
    expect(rows[1].cells[2]).toMatchObject({ done: 1, target: 3, reached: false });
  });

  it("从来没记过的练习只显示本周；第一次记录之前的周不算没做", () => {
    const rows = practiceHistory([practice("新", {}), practice("晚记", { weeklyLog: { "2026-11-17": 1 } })], ["2026-11-02", "2026-11-09", "2026-11-16"], "2026-11-16");
    expect(rows[0].cells.map((cell) => cell && cell.done)).toEqual([null, null, 0]);
    expect(rows[1].cells.map((cell) => cell && cell.done)).toEqual([null, null, 1]);
  });
});
