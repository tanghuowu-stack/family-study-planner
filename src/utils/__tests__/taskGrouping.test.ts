/**
 * 今日页"上课 / 作业"分组（2026-09-25）。
 * 分组是纯函数（groupDayTasks），项目没有 React 组件测试基础设施，这里直接测函数；
 * 最后一组用 fake-indexeddb 走真实的 reorderTasks 写入，验证拖拽在新分组下端到端生效。
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../data/db";
import { taskRepository } from "../../data/taskRepository";
import { dayBucketSort, groupDayTasks, normalizeSubjectOrder, type DayGroupable } from "../taskGrouping";
import type { Task, TaskDraft } from "../../types/task";

const DEFAULT_ORDER = ["chinese", "math", "english", "other"];
let seq = 0;
const t = (title: string, over: Partial<Task> = {}): DayGroupable & { id: string } => ({
  id: `t${++seq}`,
  title,
  mainCategory: "extraHomework",
  subCategory: "other",
  extraContentType: "homework",
  createdAt: `2026-09-01T00:00:${String(seq).padStart(2, "0")}.000Z`,
  ...over,
} as DayGroupable & { id: string });

const titles = (list: { title: string }[]) => list.map((x) => x.title);

describe("上课组：不按学科细分", () => {
  it("语文/数学/英语的上课任务混在同一组", () => {
    const tasks = [
      t("大增语文课", { subCategory: "chinese", extraContentType: "class" }),
      t("奥数课", { subCategory: "math", extraContentType: "class" }),
      t("剑桥英语课", { subCategory: "english", extraContentType: "class" }),
    ];
    const { classes, homework } = groupDayTasks(tasks, DEFAULT_ORDER);
    expect(titles(classes).sort()).toEqual(["剑桥英语课", "大增语文课", "奥数课"].sort());
    expect(homework).toHaveLength(0);
  });

  it("游泳/钢琴/轮滑课（兴趣班，没有内容类型字段）也进上课组", () => {
    const tasks = [
      t("游泳课", { mainCategory: "interestClass", subCategory: "swimming", extraContentType: undefined }),
      t("钢琴课", { mainCategory: "interestClass", subCategory: "piano", extraContentType: undefined }),
      t("轮滑课", { mainCategory: "interestClass", subCategory: "rollerSkating", extraContentType: undefined }),
      t("奥数课", { subCategory: "math", extraContentType: "class" }),
    ];
    const { classes, homework } = groupDayTasks(tasks, DEFAULT_ORDER);
    expect(classes).toHaveLength(4);
    expect(homework).toHaveLength(0);
  });

  it("钢琴练习不是上课：进作业组的其他", () => {
    const { classes, homework } = groupDayTasks([
      t("钢琴练习", { mainCategory: "interestClass", subCategory: "pianoPractice", extraContentType: undefined }),
    ], DEFAULT_ORDER);
    expect(classes).toHaveLength(0);
    expect(homework.map((g) => g.key)).toEqual(["other"]);
  });
});

describe("作业组：按学科细分", () => {
  it("课外作业按学科分到语文/数学/英语", () => {
    const { classes, homework } = groupDayTasks([
      t("大增语文课后作业", { subCategory: "chinese" }),
      t("奥数课后作业", { subCategory: "math" }),
      t("FCE听力", { subCategory: "english" }),
    ], DEFAULT_ORDER);
    expect(classes).toHaveLength(0);
    expect(homework.map((g) => [g.key, titles(g.tasks)])).toEqual([
      ["chinese", ["大增语文课后作业"]],
      ["math", ["奥数课后作业"]],
      ["english", ["FCE听力"]],
    ]);
  });

  it("校内任务（本来就没有内容类型）按学科进作业组", () => {
    const { homework } = groupDayTasks([
      t("数感练习本", { mainCategory: "school", subCategory: "math", extraContentType: undefined }),
      t("我爱背诗", { mainCategory: "school", subCategory: "chinese", extraContentType: undefined }),
    ], DEFAULT_ORDER);
    expect(homework.map((g) => g.key)).toEqual(["chinese", "math"]);
  });

  it("空的学科分组不渲染", () => {
    const { homework } = groupDayTasks([t("奥数课后作业", { subCategory: "math" })], DEFAULT_ORDER);
    expect(homework.map((g) => g.key)).toEqual(["math"]);
  });
});

describe("兜底：内容类型缺失或异常，任务绝不能消失", () => {
  it("课外班任务内容类型为空：进作业组，仍按学科分", () => {
    const { classes, homework } = groupDayTasks([t("语文补充", { subCategory: "chinese", extraContentType: undefined })], DEFAULT_ORDER);
    expect(classes).toHaveLength(0);
    expect(homework.map((g) => [g.key, titles(g.tasks)])).toEqual([["chinese", ["语文补充"]]]);
  });

  it("历史遗留内容类型（练习/听写/背诵/阅读/其他）：进作业组", () => {
    const legacy = ["practice", "dictation", "recitation", "reading", "other"] as const;
    const tasks = legacy.map((v) => t(`遗留-${v}`, { subCategory: "english", extraContentType: v }));
    const { classes, homework } = groupDayTasks(tasks, DEFAULT_ORDER);
    expect(classes).toHaveLength(0);
    expect(homework).toHaveLength(1);
    expect(homework[0].tasks).toHaveLength(legacy.length);
  });

  it("完全不认识的内容类型值和二级类型：落到作业组的其他", () => {
    const { homework } = groupDayTasks([
      t("来路不明", { subCategory: "weird-legacy", extraContentType: "bogus" as never }),
    ], DEFAULT_ORDER);
    expect(homework.map((g) => [g.key, titles(g.tasks)])).toEqual([["other", ["来路不明"]]]);
  });

  it("全品类混合：每个任务恰好落进一个分组（总数守恒、无重复）", () => {
    const tasks = [
      t("奥数课", { subCategory: "math", extraContentType: "class" }),
      t("游泳课", { mainCategory: "interestClass", subCategory: "swimming", extraContentType: undefined }),
      t("钢琴练习", { mainCategory: "interestClass", subCategory: "pianoPractice", extraContentType: undefined }),
      t("数感练习本", { mainCategory: "school", subCategory: "math", extraContentType: undefined }),
      t("大增语文课后作业", { subCategory: "chinese" }),
      t("遗留听写", { subCategory: "english", extraContentType: "dictation" }),
      t("空内容类型", { subCategory: "math", extraContentType: undefined }),
      t("看电影", { mainCategory: "temporary", subCategory: "leisure", extraContentType: undefined }),
      t("中文阅读", { mainCategory: "readingPlan", subCategory: "chineseReading", extraContentType: undefined }),
      t("来路不明", { subCategory: "???", extraContentType: "bogus" as never }),
    ];
    const { classes, homework } = groupDayTasks(tasks, DEFAULT_ORDER);
    const placed = [...classes, ...homework.flatMap((g) => g.tasks)];
    expect(placed).toHaveLength(tasks.length);
    expect(new Set(placed.map((x) => x.id)).size).toBe(tasks.length);
    expect(titles(classes).sort()).toEqual(["奥数课", "游泳课"].sort());
  });

  it("存储的学科顺序缺了某一科：那一科照样显示，补在末尾", () => {
    const { homework } = groupDayTasks([
      t("FCE听力", { subCategory: "english" }),
      t("奥数课后作业", { subCategory: "math" }),
    ], ["math", "chinese"]); // 存储值里没有 english / other
    expect(homework.map((g) => g.key)).toEqual(["math", "english"]);
  });
});

describe("学科分组顺序与规整", () => {
  it("作业组的学科顺序跟随用户拖拽保存的顺序", () => {
    const tasks = [t("语", { subCategory: "chinese" }), t("数", { subCategory: "math" }), t("英", { subCategory: "english" })];
    expect(groupDayTasks(tasks, ["english", "math", "chinese", "other"]).homework.map((g) => g.key)).toEqual(["english", "math", "chinese"]);
  });

  it("normalizeSubjectOrder：补齐缺失、去重、丢弃非法值", () => {
    expect(normalizeSubjectOrder(["math", "math", "bogus", "chinese"])).toEqual(["math", "chinese", "english", "other"]);
    expect(normalizeSubjectOrder([])).toEqual(["chinese", "math", "english", "other"]);
  });
});

describe("桶内排序", () => {
  it("带具体时间的任务置顶、按时间先后；上课组和作业子组都一样", () => {
    const tasks = [
      t("无时间的课", { subCategory: "math", extraContentType: "class", sortOrder: 0 }),
      t("10:10-12:30 奥数暑假班", { subCategory: "math", extraContentType: "class", startTime: "10:10" }),
      t("08:00 语文课", { subCategory: "chinese", extraContentType: "class", startTime: "08:00" }),
      t("无时间作业", { subCategory: "math", sortOrder: 0 }),
      t("19:00 数学订正", { subCategory: "math", startTime: "19:00" }),
    ];
    const { classes, homework } = groupDayTasks(tasks, DEFAULT_ORDER);
    expect(titles(classes)).toEqual(["08:00 语文课", "10:10-12:30 奥数暑假班", "无时间的课"]);
    expect(titles(homework[0].tasks)).toEqual(["19:00 数学订正", "无时间作业"]);
  });

  it("旧 time 字段同样算带时间（startTime 上线前的遗留）", () => {
    expect(dayBucketSort(t("a", { time: "09:00" }), t("b", { sortOrder: 0 }))).toBeLessThan(0);
  });

  it("上课组里跨学科的 sortOrder 生效，不会被学科默认序压回去", () => {
    // 语文在学科序里排数学前面；用户把奥数课拖到了语文课上面
    const tasks = [
      t("大增语文课", { subCategory: "chinese", extraContentType: "class", sortOrder: 1 }),
      t("奥数课", { subCategory: "math", extraContentType: "class", sortOrder: 0 }),
    ];
    expect(titles(groupDayTasks(tasks, DEFAULT_ORDER).classes)).toEqual(["奥数课", "大增语文课"]);
  });
});

describe("拖拽排序端到端（真实 reorderTasks 写入 → getTasksForDate → 分组）", () => {
  const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  const draft = (over: Partial<Task>): TaskDraft => ({
    title: "x", mainCategory: "extraHomework", subCategory: "math", extraContentType: "homework",
    timeType: "singleDate", date: today, status: "todo", rolloverMode: "keepOverdue", allowRollover: false, childVisible: true, ...over,
  } as TaskDraft);

  beforeEach(async () => { await Promise.all([db.tasks.clear(), db.taskOccurrenceStatuses.clear(), db.activityLogs.clear()]); });

  it("上课组内跨学科拖拽：写库后今日页按新顺序显示", async () => {
    const { task: chineseClass } = await taskRepository.create(draft({ title: "大增语文课", subCategory: "chinese", extraContentType: "class" }));
    const { task: swim } = await taskRepository.create(draft({ title: "游泳课", mainCategory: "interestClass", subCategory: "swimming", extraContentType: undefined }));
    const { task: mathClass } = await taskRepository.create(draft({ title: "奥数课", subCategory: "math", extraContentType: "class" }));

    // 模拟用户在上课组里拖成：游泳 → 奥数 → 语文（跨了三个学科/两个一级分类）
    await taskRepository.reorderTasks([swim.id, mathClass.id, chineseClass.id]);
    const { classes } = groupDayTasks(await taskRepository.getTasksForDate(today), DEFAULT_ORDER);
    expect(titles(classes)).toEqual(["游泳课", "奥数课", "大增语文课"]);
  });

  it("作业组学科子分组内拖拽：写库后按新顺序显示，其他分组不受影响", async () => {
    const { task: a } = await taskRepository.create(draft({ title: "数学A", subCategory: "math" }));
    const { task: b } = await taskRepository.create(draft({ title: "数学B", subCategory: "math" }));
    await taskRepository.create(draft({ title: "语文C", subCategory: "chinese" }));
    await taskRepository.reorderTasks([b.id, a.id]);
    const { homework } = groupDayTasks(await taskRepository.getTasksForDate(today), DEFAULT_ORDER);
    expect(homework.map((g) => [g.key, titles(g.tasks)])).toEqual([["chinese", ["语文C"]], ["math", ["数学B", "数学A"]]]);
  });
});
