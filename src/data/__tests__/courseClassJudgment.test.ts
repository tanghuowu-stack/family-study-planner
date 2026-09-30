/**
 * "是否算上课"判定回归（2026-09-29，方案 B：兴趣班加"其他兴趣班"，上课判断不再是纯二级类型硬编码）。
 *
 * 背景：兴趣班原来只有钢琴课/游泳课/轮滑课/钢琴练习四个二级类型，上课与否按二级类型硬编码，
 * 课程上的"算作上课"(isClass) 对兴趣班完全不起作用——"跳绳课"无处安放，被默默存成了"兴趣班·钢琴课"。
 *
 * 新口径（isCourseTask）：课外=内容类型为上课；兴趣班=钢琴/游泳/轮滑（历史口径不变）或任务标记了
 * 算作上课（extraContentType="class"）。这个判定被今日页上课/作业分组、上课标签、月计划显示、
 * 周/月汇总、课程统计共用，所以这里既测纯函数，也用 fake-indexeddb 走真实数据层把各消费方跑一遍。
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { taskRepository } from "../taskRepository";
import { courseOptionLabel, customSubCategoryValue, interestContentType, isCourseTask, isValidSubCategory, subCategoryLabel, SUB_CATEGORY_OPTIONS } from "../../utils/taskMeta";
import { groupDayTasks, type DayGroupable } from "../../utils/taskGrouping";
import type { ExtraContentType, MainCategory, Task, TaskDraft } from "../../types/task";

const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = fmt(new Date());

/** 改动前的 isCourseTask 原样复刻，用来证明历史数据的判定结果没有变化 */
const legacyIsCourseTask = (task: { mainCategory: MainCategory; subCategory: string; extraContentType?: ExtraContentType }) =>
  (task.mainCategory === "extraHomework" && task.extraContentType === "class")
  || (task.mainCategory === "interestClass" && ["piano", "swimming", "rollerSkating"].includes(task.subCategory));

const draft = (overrides: Partial<Task> = {}): TaskDraft => ({
  title: "",
  mainCategory: "interestClass",
  subCategory: "piano",
  timeType: "singleDate",
  date: today,
  status: "todo",
  rolloverMode: "keepOverdue",
  allowRollover: false,
  childVisible: true,
  calendarVisibility: "show",
  ...overrides,
} as TaskDraft);

beforeEach(async () => {
  await Promise.all([db.tasks.clear(), db.taskOccurrenceStatuses.clear(), db.activityLogs.clear(), db.courses.clear()]);
});

describe("isCourseTask：历史口径不变", () => {
  it("钢琴课/游泳课/轮滑课（无内容类型字段）照旧算上课，钢琴练习照旧不算", () => {
    for (const sub of ["piano", "swimming", "rollerSkating"]) expect(isCourseTask({ mainCategory: "interestClass", subCategory: sub })).toBe(true);
    expect(isCourseTask({ mainCategory: "interestClass", subCategory: "pianoPractice" })).toBe(false);
  });

  it("钢琴/游泳/轮滑即使课程没勾'算作上课'（任务无 class 标记）也仍算上课——维持现状", () => {
    expect(isCourseTask({ mainCategory: "interestClass", subCategory: "piano", extraContentType: undefined })).toBe(true);
  });

  it("课外：内容类型=上课算，作业不算；学校作业、事项永远不算", () => {
    expect(isCourseTask({ mainCategory: "extraHomework", subCategory: "math", extraContentType: "class" })).toBe(true);
    expect(isCourseTask({ mainCategory: "extraHomework", subCategory: "math", extraContentType: "homework" })).toBe(false);
    expect(isCourseTask({ mainCategory: "school", subCategory: "math", extraContentType: "class" })).toBe(false);
    expect(isCourseTask({ mainCategory: "temporary", subCategory: "other", extraContentType: "class" })).toBe(false);
  });

  it("穷举：历史写入路径能产生的所有组合，新旧判定结果逐一相等", () => {
    // 历史写入路径从不给兴趣班任务写内容类型（changeMain/selectCourse 对非课外一律置空，
    // db v5 迁移也只给课外补内容类型），所以兴趣班只需覆盖 extraContentType 为空的情况；
    // 其余分类覆盖全部内容类型取值 + 历史遗留二级类型（other/aoshu/dazeng/cambridge 等）。
    const contentTypes: (ExtraContentType | undefined)[] = [undefined, "class", "homework", "practice", "dictation", "recitation", "other", "reading"];
    const mains: MainCategory[] = ["school", "extraHomework", "interestClass", "readingPlan", "temporary"];
    const legacySubs = ["other", "aoshu", "dazeng", "cambridge", "chineseRecitation", "englishDictation"];
    let checked = 0;
    for (const mainCategory of mains) {
      const subs = [...SUB_CATEGORY_OPTIONS[mainCategory].map((o) => o.value), ...legacySubs].filter((s) => s !== "otherInterest");
      for (const subCategory of subs) {
        for (const extraContentType of mainCategory === "interestClass" ? [undefined] : contentTypes) {
          const task = { mainCategory, subCategory, extraContentType };
          expect(isCourseTask(task), `${mainCategory}/${subCategory}/${extraContentType}`).toBe(legacyIsCourseTask(task));
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe("isCourseTask：新增其他兴趣班", () => {
  it("其他兴趣班 + 算作上课 → 上课；不勾 → 不算", () => {
    expect(isCourseTask({ mainCategory: "interestClass", subCategory: "otherInterest", extraContentType: "class" })).toBe(true);
    expect(isCourseTask({ mainCategory: "interestClass", subCategory: "otherInterest", extraContentType: undefined })).toBe(false);
  });

  it("interestContentType：勾选记 class，不勾不写", () => {
    expect(interestContentType(true)).toBe("class");
    expect(interestContentType(false)).toBeUndefined();
  });
});

describe("今日页分组：上课 / 作业", () => {
  let seq = 0;
  const t = (title: string, over: Partial<Task>): DayGroupable & { id: string } => ({
    id: `t${++seq}`, title, mainCategory: "interestClass", subCategory: "piano",
    createdAt: `2026-09-01T00:00:${String(seq).padStart(2, "0")}.000Z`, ...over,
  } as DayGroupable & { id: string });

  it("其他兴趣班+算作上课进上课组；不勾的进作业·其他组；钢琴课/钢琴练习分组不变", () => {
    const { classes, homework } = groupDayTasks([
      t("跳绳课", { subCategory: "otherInterest", extraContentType: "class" }),
      t("画画练习", { subCategory: "otherInterest", extraContentType: undefined }),
      t("钢琴课", { subCategory: "piano" }),
      t("钢琴练习", { subCategory: "pianoPractice" }),
    ], ["chinese", "math", "english", "other"]);
    expect(classes.map((x) => x.title).sort()).toEqual(["跳绳课", "钢琴课"].sort());
    expect(homework).toHaveLength(1);
    expect(homework[0].key).toBe("other");
    expect(homework[0].tasks.map((x) => x.title).sort()).toEqual(["画画练习", "钢琴练习"].sort());
  });
});

describe("数据层消费方（fake-indexeddb 端到端）", () => {
  const seed = async () => {
    const ids: Record<string, string> = {};
    for (const [key, over] of Object.entries({
      jumpClass: { title: "跳绳课", subCategory: "otherInterest", extraContentType: "class" },
      drawNoClass: { title: "画画练习", subCategory: "otherInterest", extraContentType: undefined },
      piano: { title: "钢琴课", subCategory: "piano" },
      pianoPractice: { title: "钢琴练习", subCategory: "pianoPractice" },
      swim: { title: "游泳课", subCategory: "swimming" },
    } as Record<string, Partial<Task>>)) {
      const { task } = await taskRepository.create(draft(over));
      ids[key] = task.id;
    }
    return ids;
  };

  it("月计划（forCalendar）：跳绳课(上课)显示、画画练习(不算上课)不显示；钢琴课/游泳课显示、钢琴练习不显示（不变）", async () => {
    const ids = await seed();
    const shown = new Set((await taskRepository.getTasksForDate(today, { forCalendar: true })).map((x) => x.id));
    expect(shown.has(ids.jumpClass)).toBe(true);
    expect(shown.has(ids.drawNoClass)).toBe(false);
    expect(shown.has(ids.piano)).toBe(true);
    expect(shown.has(ids.swim)).toBe(true);
    expect(shown.has(ids.pianoPractice)).toBe(false);
  });

  it("今日清单（非月计划）：五条都照常出现，不因上课判定被过滤", async () => {
    const ids = await seed();
    const shown = new Set((await taskRepository.getTasksForDate(today)).map((x) => x.id));
    for (const id of Object.values(ids)) expect(shown.has(id)).toBe(true);
  });

  it("课程统计：跳绳课计入上课次数，画画练习/钢琴练习不计；钢琴课/游泳课照旧各计 1 次", async () => {
    await seed();
    const stats = await taskRepository.getCourseStatistics(today, today);
    const labels = stats.items.map((i) => i.label).sort();
    expect(labels).toEqual(["跳绳课", "游泳课", "钢琴课"].sort());
    expect(stats.items.every((i) => i.group === "兴趣班" && i.count === 1)).toBe(true);
    expect(stats.total).toBe(3);
  });

  it("周汇总：跳绳课作为上课项计入（isCourse=true），画画练习/钢琴练习不进周汇总", async () => {
    await seed();
    const overview = await taskRepository.getWeekOverview(today);
    const byLabel = new Map(overview.map((i) => [i.label, i]));
    expect(byLabel.get("跳绳课")?.isCourse).toBe(true);
    expect(byLabel.get("钢琴课")?.isCourse).toBe(true);
    expect(byLabel.has("画画练习")).toBe(false);
    expect(byLabel.has("钢琴练习")).toBe(false);
  });
});

describe("课程表单 / 新建任务表单辅助", () => {
  it("二级类型校验：空值不合法，隐藏旧选项后仍兼容已有课程，跨分类的值不合法", () => {
    expect(isValidSubCategory("interestClass", "")).toBe(false);
    expect(isValidSubCategory("interestClass", "otherInterest")).toBe(true);
    expect(SUB_CATEGORY_OPTIONS.interestClass.some((item) => item.value === "otherInterest")).toBe(false);
    expect(isValidSubCategory("extraHomework", "piano")).toBe(false);
  });

  it("自定义分类可保存并能从 value 还原显示名", () => {
    const value = customSubCategoryValue("跳绳课");
    expect(isValidSubCategory("interestClass", value)).toBe(true);
    expect(subCategoryLabel("interestClass", value)).toBe("跳绳课");
  });

  it("同名课程下拉框带'（分类·二级类型）'后缀，不重名的只显示课程名", () => {
    const a = { id: "a", name: "跳绳课", mainCategory: "interestClass" as const, subCategory: "otherInterest" };
    const b = { id: "b", name: "跳绳课", mainCategory: "extraHomework" as const, subCategory: "chinese" };
    const c = { id: "c", name: "游泳课", mainCategory: "interestClass" as const, subCategory: "swimming" };
    const all = [a, b, c];
    expect(courseOptionLabel(a, all)).toBe("跳绳课（兴趣班·其他兴趣班）");
    expect(courseOptionLabel(b, all)).toBe("跳绳课（课外·语文）");
    expect(courseOptionLabel(c, all)).toBe("游泳课");
  });
});
