import type { Task } from "../types/task";

export type TaskSubjectGroup = "chinese" | "math" | "english" | "other";

export const TASK_SUBJECT_GROUPS: { key: TaskSubjectGroup; label: string }[] = [
  { key: "chinese", label: "语文" },
  { key: "math", label: "数学" },
  { key: "english", label: "英语" },
  { key: "other", label: "其他" },
];

export function taskSubjectGroup(task: Pick<Task, "mainCategory" | "subCategory" | "title">): TaskSubjectGroup {
  if (task.mainCategory === "interestClass" || task.mainCategory === "temporary") return "other";
  if (["chinese", "math", "english"].includes(task.subCategory)) return task.subCategory as TaskSubjectGroup;
  if (/语文|大增|作文|阅读理解|古诗|背诵/.test(task.title)) return "chinese";
  if (/数学|奥数|计算|口算|应用题/.test(task.title)) return "math";
  if (/英语|FCE|听写|Part|语法|单词/i.test(task.title)) return "english";
  return "other";
}
