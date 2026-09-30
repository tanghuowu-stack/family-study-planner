import { addDays } from "date-fns";
import { db } from "../data/db";
import type { Task } from "../types/task";
import { fromDateKey, todayKey, toDateKey } from "../utils/date";

const day = (offset: number) => toDateKey(addDays(fromDateKey(todayKey()), offset));

export async function seedPreviewData() {
  try {
    if (await db.tasks.where("id").startsWith("preview-").count()) return;

    const today = todayKey();
    const now = new Date().toISOString();
    const weekday = fromDateKey(today).getDay();
    const tomorrowWeekday = addDays(fromDateKey(today), 1).getDay();
    const base = {
      timeType: "singleDate" as const,
      schedulePattern: "singleDate" as const,
      status: "todo" as const,
      rolloverMode: "keepOverdue" as const,
      allowRollover: false,
      childVisible: true,
      calendarVisibility: "show" as const,
      applicablePeriodType: "all" as const,
      createdAt: now,
      updatedAt: now,
    };

    const tasks: Task[] = [
      {
        ...base,
        id: "preview-fce-class",
        title: "FCE 精读课",
        mainCategory: "extraHomework",
        subCategory: "english",
        extraContentType: "class",
        timeType: "recurring",
        schedulePattern: "weeklyRecurring",
        recurrence: { frequency: "weekly", weekdays: [weekday], startDate: day(-21), endDate: day(35) },
        startTime: "16:30",
        endTime: "18:00",
        sortOrder: 10,
        note: "带阅读材料和错题本",
      },
      {
        ...base,
        id: "preview-chinese-homework",
        title: "完成语文第 3 单元复习",
        mainCategory: "school",
        subCategory: "chinese",
        date: today,
        sortOrder: 20,
        checklistItems: [
          { id: "preview-cn-1", title: "订正练习册错题", done: true, completedDate: today, sortOrder: 0 },
          { id: "preview-cn-2", title: "背诵《山居秋暝》", done: false, sortOrder: 1 },
          { id: "preview-cn-3", title: "整理本单元易错字", done: false, sortOrder: 2 },
        ],
      },
      {
        ...base,
        id: "preview-math-homework",
        title: "奥数专题：行程问题 8 题",
        mainCategory: "extraHomework",
        subCategory: "math",
        extraContentType: "homework",
        date: today,
        startTime: "19:15",
        sortOrder: 30,
      },
      {
        ...base,
        id: "preview-english-daily",
        title: "英语听写与跟读",
        mainCategory: "extraHomework",
        subCategory: "english",
        extraContentType: "homework",
        timeType: "recurring",
        schedulePattern: "dailyRecurring",
        recurrence: { frequency: "daily", startDate: day(-14), endDate: day(30) },
        calendarVisibility: "hide",
        rolloverMode: "skipIfMissed",
        checklistItems: [
          { id: "preview-en-1", title: "Unit 4 单词听写", done: false, sortOrder: 0 },
          { id: "preview-en-2", title: "课文跟读 3 遍", done: false, sortOrder: 1 },
        ],
        sortOrder: 40,
      },
      {
        ...base,
        id: "preview-piano-practice",
        title: "钢琴练习：车尔尼 599 No.32",
        mainCategory: "interestClass",
        subCategory: "pianoPractice",
        timeType: "recurring",
        schedulePattern: "dailyRecurring",
        recurrence: { frequency: "daily", startDate: day(-10), endDate: day(20) },
        calendarVisibility: "hide",
        rolloverMode: "skipIfMissed",
        startTime: "20:10",
        sortOrder: 50,
      },
      {
        ...base,
        id: "preview-pack-bag",
        title: "整理明天上课资料和水杯",
        mainCategory: "temporary",
        subCategory: "other",
        date: today,
        sortOrder: 60,
      },
      {
        ...base,
        id: "preview-done-english",
        title: "阅读英文短篇 20 分钟",
        mainCategory: "school",
        subCategory: "english",
        date: today,
        status: "done",
        completedAt: now,
        sortOrder: 70,
      },
      {
        ...base,
        id: "preview-overdue-math",
        title: "订正数学周测错题",
        mainCategory: "school",
        subCategory: "math",
        date: day(-1),
        important: true,
        sortOrder: 80,
      },
      {
        ...base,
        id: "preview-swimming-class",
        title: "游泳课",
        mainCategory: "interestClass",
        subCategory: "swimming",
        timeType: "recurring",
        schedulePattern: "weeklyRecurring",
        recurrence: { frequency: "weekly", weekdays: [tomorrowWeekday], startDate: day(-7), endDate: day(42) },
        startTime: "17:00",
        endTime: "18:00",
        sortOrder: 90,
      },
      {
        ...base,
        id: "preview-family-trip",
        title: "周末自然博物馆",
        mainCategory: "temporary",
        subCategory: "leisure",
        timeType: "dateRange",
        startDate: day(3),
        endDate: day(4),
        note: "提前预约停车",
        sortOrder: 100,
      },
    ];

    await db.tasks.bulkPut(tasks);
  } catch (error) {
    console.warn("[preview] 示例任务写入失败", error);
  }
}
