/**
 * 勾选链路回归测试（2026-11 界面审查第 2 批）：
 * 1. 本地写完立刻回调（界面即时刷新），不等云端上传；
 * 2. 同一任务的云端上传排队串行，最后推上去的是本地最新状态；
 * 3. 拉取合并时跳过"正在上传 / 拉取期间上传过"的记录，刚勾的小项不被旧的云端数据弹回去。
 * Supabase 全程 mock，上传和拉取都可以用闸门卡住，用来摆出竞态的先后顺序。
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const ctl = vi.hoisted(() => ({
  log: [] as string[],
  upserts: [] as { table: string; rows: Record<string, unknown>[] }[],
  upsertGates: {} as Record<string, Promise<void> | undefined>,
  fetchGate: undefined as Promise<void> | undefined,
  cloud: {} as Record<string, Record<string, unknown>[]>,
}));

vi.mock("../../lib/supabase", () => {
  const select = async (table: string, columns: string) => {
    if (columns === "id") return { data: [], error: null };       // upsertTask 查旧小项 id：没有要清理的
    const data = [...(ctl.cloud[table] ?? [])];                    // 先定格"此刻的云端"，再过闸门：模拟请求已发出、响应晚到
    if (ctl.fetchGate) await ctl.fetchGate;
    return { data, error: null };
  };
  const builder = (table: string, columns: string) => {
    const chain = {
      eq: () => chain,
      order: () => chain,
      in: () => chain,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => select(table, columns).then(resolve, reject),
    };
    return chain;
  };
  return {
    supabaseConfigured: true,
    supabase: {
      from: (table: string) => ({
        upsert: async (rows: Record<string, unknown> | Record<string, unknown>[]) => {
          if (table === "activity_logs") return { error: null }; // 操作日志另走一路上传，与勾选链路无关，不计入
          ctl.log.push(`${table}:start`);
          if (ctl.upsertGates[table]) await ctl.upsertGates[table];
          ctl.upserts.push({ table, rows: Array.isArray(rows) ? rows : [rows] });
          ctl.log.push(`${table}:end`);
          return { error: null };
        },
        select: (columns: string) => builder(table, columns),
      }),
    },
  };
});

import { db } from "../db";
import { taskRepository } from "../taskRepository";
import { checklistItemRows, cloudRepository, taskToRow } from "../cloudRepository";
import type { Task, TaskDraft } from "../../types/task";

const FAMILY = "fam-test";
const DATE = "2026-11-13";
const FUTURE = "2099-01-01T00:00:00.000Z"; // 模拟云端触发器写的服务器时间：比本地任何时间都新，LWW 会放行

const baseDraft = (overrides: Partial<TaskDraft> = {}): TaskDraft => ({
  title: "语文家庭作业", mainCategory: "school", subCategory: "chinese", timeType: "singleDate", date: DATE,
  status: "todo", rolloverMode: "keepOverdue", allowRollover: false, childVisible: true,
  checklistItems: [
    { id: "i1", title: "抄写", done: false, sortOrder: 0 },
    { id: "i2", title: "背诵", done: false, sortOrder: 1 },
    { id: "i3", title: "预习", done: false, sortOrder: 2 },
  ],
  ...overrides,
} as TaskDraft);

const gate = () => { let open!: () => void; const promise = new Promise<void>((resolve) => { open = resolve; }); return { promise, open }; };
const doneIds = async (taskId: string) => (await db.tasks.get(taskId))!.checklistItems!.filter((item) => item.done).map((item) => item.id);
/** 把一份任务快照摆成"云端现状"：任务行的 updated_at 是服务器时间 */
const putCloudTask = (task: Task, updatedAt = FUTURE) => {
  ctl.cloud["tasks"] = [{ ...taskToRow(task, FAMILY), updated_at: updatedAt } as Row];
  ctl.cloud["task_checklist_items"] = checklistItemRows(task, FAMILY) as Row[];
};

beforeEach(async () => {
  ctl.log = []; ctl.upserts = []; ctl.upsertGates = {}; ctl.fetchGate = undefined; ctl.cloud = {};
  await Promise.all([db.tasks.clear(), db.taskOccurrenceStatuses.clear(), db.activityLogs.clear()]);
  cloudRepository.setFamilyId(FAMILY);
});

describe("本地写完立刻回调，不等云端", () => {
  it("1. 勾小项：回调触发时本地已落库，而云端上传还卡着、方法尚未返回", async () => {
    const { task } = await taskRepository.create(baseDraft());
    const hold = gate();
    ctl.upsertGates["tasks"] = hold.promise;
    const onLocalWrite = vi.fn();
    let returned = false;
    const pending = cloudRepository.toggleChecklistItem(task.id, "i1", undefined, { done: true }, onLocalWrite).then((result) => { returned = true; return result; });

    await vi.waitFor(() => expect(onLocalWrite).toHaveBeenCalledTimes(1));
    expect(await doneIds(task.id)).toEqual(["i1"]);
    await vi.waitFor(() => expect(ctl.log).toContain("tasks:start"));
    expect(returned).toBe(false);

    hold.open();
    expect((await pending).synced).toBe(true);
    expect(onLocalWrite).toHaveBeenCalledTimes(1);
  });

  it("2. 整体勾完成：同样先回调再上传", async () => {
    const { task } = await taskRepository.create(baseDraft({ checklistItems: undefined }));
    const hold = gate();
    ctl.upsertGates["tasks"] = hold.promise;
    const onLocalWrite = vi.fn();
    const pending = cloudRepository.setDisplayStatus({ ...task }, "done", DATE, onLocalWrite);

    await vi.waitFor(() => expect(onLocalWrite).toHaveBeenCalledTimes(1));
    expect((await db.tasks.get(task.id))!.status).toBe("done");
    expect(ctl.upserts).toEqual([]);

    hold.open();
    expect((await pending).synced).toBe(true);
    expect(ctl.upserts.find((entry) => entry.table === "tasks")?.rows[0].status).toBe("done");
  });

  it("3. 本地模式（未登录）与 taskRepository 直接调用：回调各触发一次，不产生上传", async () => {
    const { task } = await taskRepository.create(baseDraft());
    cloudRepository.setFamilyId("");
    const viaCloudWrapper = vi.fn();
    expect((await cloudRepository.toggleChecklistItem(task.id, "i1", undefined, { done: true }, viaCloudWrapper)).synced).toBe(true);
    expect(viaCloudWrapper).toHaveBeenCalledTimes(1);

    const direct = vi.fn();
    await taskRepository.toggleChecklistItem(task.id, "i2", undefined, { done: true }, direct);
    await taskRepository.setDisplayStatus({ ...(await db.tasks.get(task.id))! }, "done", DATE, direct);
    expect(direct).toHaveBeenCalledTimes(2);
    expect(ctl.upserts).toEqual([]);
  });
});

describe("本地并发勾选不丢勾（小项数组在事务内读取）", () => {
  it("3b. 同一任务的三个小项同时勾选：三个勾都保留，全部勾完后任务自动完成", async () => {
    const { task } = await taskRepository.create(baseDraft());
    await Promise.all(["i1", "i2", "i3"].map((id) => taskRepository.toggleChecklistItem(task.id, id, undefined, { done: true })));
    expect(await doneIds(task.id)).toEqual(["i1", "i2", "i3"]);
    expect((await db.tasks.get(task.id))!.status).toBe("done");
  });

  it("3c. 重复类任务同样不丢勾，当天的单日状态随之记为完成", async () => {
    const { task } = await taskRepository.create(baseDraft({ timeType: "recurring", schedulePattern: "dailyRecurring", date: undefined, recurrence: { frequency: "daily", startDate: "2026-11-01" } }));
    await Promise.all(["i1", "i2", "i3"].map((id) => taskRepository.toggleChecklistItem(task.id, id, DATE, { done: true })));
    expect(await doneIds(task.id)).toEqual(["i1", "i2", "i3"]);
    expect((await db.taskOccurrenceStatuses.get(`${task.id}:${DATE}`))!.status).toBe("done");
    expect((await db.tasks.get(task.id))!.status).toBe("todo"); // R1：本体状态不动
  });
});

describe("同一任务的云端上传排队串行", () => {
  it("4. 连点两个小项：第二次上传等第一次整组请求结束才开始，最后推上去的小项两项都已勾", async () => {
    const { task } = await taskRepository.create(baseDraft());
    const hold = gate();
    ctl.upsertGates["tasks"] = hold.promise;

    const first = cloudRepository.toggleChecklistItem(task.id, "i1", undefined, { done: true });
    const second = cloudRepository.toggleChecklistItem(task.id, "i2", undefined, { done: true });
    await vi.waitFor(async () => expect(await doneIds(task.id)).toEqual(["i1", "i2"]));
    await vi.waitFor(() => expect(ctl.log).toContain("tasks:start"));
    // 第一次上传卡着时，第二次一个请求都不该发出去
    expect(ctl.log.filter((entry) => entry === "tasks:start")).toHaveLength(1);

    hold.open();
    await Promise.all([first, second]);
    // 两组请求首尾相接，没有交错
    expect(ctl.log).toEqual([
      "tasks:start", "tasks:end", "task_checklist_items:start", "task_checklist_items:end",
      "tasks:start", "tasks:end", "task_checklist_items:start", "task_checklist_items:end",
    ]);
    const lastItems = ctl.upserts.filter((entry) => entry.table === "task_checklist_items").at(-1)!.rows;
    expect(lastItems.filter((row) => row.done).map((row) => row.id)).toEqual(["i1", "i2"]);
  });
});

describe("拉取不把正在上传的记录弹回去", () => {
  it("5. 上传途中来了一次拉取，读到「新任务行 + 旧小项行」：本地刚勾的小项保持已勾；上传结束后，别的设备的新改动照常合并", async () => {
    const { task } = await taskRepository.create(baseDraft());
    putCloudTask(task); // 云端小项全是未勾，任务行时间戳却比本地新
    const hold = gate();
    ctl.upsertGates["task_checklist_items"] = hold.promise; // 任务行已上传，小项行卡在路上

    const pending = cloudRepository.toggleChecklistItem(task.id, "i1", undefined, { done: true });
    await vi.waitFor(() => expect(ctl.log).toContain("task_checklist_items:start"));
    await cloudRepository.refreshFromCloud();
    expect(await doneIds(task.id)).toEqual(["i1"]);

    hold.open();
    await pending;
    // 保护已释放：另一台设备把 i3 也勾了（云端更新），下一次拉取正常合并
    const local = (await db.tasks.get(task.id))!;
    putCloudTask({ ...local, checklistItems: local.checklistItems!.map((item) => (item.id === "i3" ? { ...item, done: true, completedDate: DATE } : item)) });
    await cloudRepository.refreshFromCloud();
    expect(await doneIds(task.id)).toEqual(["i1", "i3"]);
  });

  it("6. 拉取先发出、响应晚到，期间一次勾选已经整个上传完：晚到的旧数据不覆盖本地", async () => {
    const { task } = await taskRepository.create(baseDraft());
    putCloudTask(task);
    const hold = gate();
    ctl.fetchGate = hold.promise;
    const pull = cloudRepository.refreshFromCloud(); // 请求发出时云端还是旧状态

    await cloudRepository.toggleChecklistItem(task.id, "i2", undefined, { done: true }); // 整个上传已结束
    hold.open();
    await pull;
    expect(await doneIds(task.id)).toEqual(["i2"]);
  });

  it("7. 重复类任务：单日状态上传途中的拉取读到旧的「未完成」，本地当天保持已完成", async () => {
    const { task } = await taskRepository.create(baseDraft({
      title: "钢琴练习", mainCategory: "interestClass", subCategory: "pianoPractice", checklistItems: undefined,
      timeType: "recurring", schedulePattern: "dailyRecurring", date: undefined, recurrence: { frequency: "daily", startDate: "2026-11-01" },
    }));
    const occurrenceId = `${task.id}:${DATE}`;
    ctl.cloud["task_occurrence_statuses"] = [{ id: occurrenceId, task_id: task.id, occurrence_date: DATE, status: "todo", created_at: FUTURE, updated_at: FUTURE }];
    const hold = gate();
    ctl.upsertGates["task_occurrence_statuses"] = hold.promise;

    const pending = cloudRepository.setDisplayStatus({ ...task, occurrenceDate: DATE }, "done");
    await vi.waitFor(() => expect(ctl.log).toContain("task_occurrence_statuses:start"));
    await cloudRepository.refreshFromCloud();
    expect((await db.taskOccurrenceStatuses.get(occurrenceId))!.status).toBe("done");

    hold.open();
    expect((await pending).synced).toBe(true);
  });

  it("8. 对照：没有任何在途上传时，云端较新的记录照常覆盖本地（保护不影响正常同步）", async () => {
    const { task } = await taskRepository.create(baseDraft());
    putCloudTask({ ...task, checklistItems: task.checklistItems!.map((item) => ({ ...item, done: true, completedDate: DATE })) });
    await cloudRepository.refreshFromCloud();
    expect(await doneIds(task.id)).toEqual(["i1", "i2", "i3"]);
  });
});
