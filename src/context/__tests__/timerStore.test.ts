/**
 * 计时器纯状态转换回归测试（2026-07-19，暂停后继续从 0 重算的回归修复）。
 * 只测 timerStore.ts 的纯函数，不涉及 React/localStorage。
 */
import { describe, expect, it } from "vitest";
import { calcElapsed, pauseStore, resumeStore, startStore } from "../timerStore";

describe("计时器暂停/继续（2026-07-19 回归修复）", () => {
  it("1. 暂停后继续：accumulated 保留，只重开 startedAt，不从 0 重算", () => {
    const t0 = 1_000_000;
    const started = startStore("item-1", "checklist", "task-1", t0);
    const paused = pauseStore(started, t0 + 15_000); // 跑了 15 秒后暂停
    expect(paused.startedAt).toBeNull();
    expect(paused.accumulated).toBe(15);

    const resumed = resumeStore(paused, t0 + 20_000); // 5 秒后点继续
    expect(resumed.accumulated).toBe(15); // 关键：不清零
    expect(resumed.startedAt).toBe(t0 + 20_000);

    // 继续后再跑 10 秒，总计时长应是 15 + 10 = 25 秒，而不是从 0 重算的 10 秒
    expect(calcElapsed(resumed, t0 + 30_000)).toBe(25);
  });

  it("2. 连续多次暂停/继续，accumulated 逐次累加而非丢弃", () => {
    const t0 = 1_000_000; // 避免用 0 做时间戳——0 会被 calcElapsed 的 startedAt 真值判断当成"未在计时"
    let store = startStore("item-1", "checklist", "task-1", t0);
    store = pauseStore(store, t0 + 10_000); // +10s
    store = resumeStore(store, t0 + 15_000);
    store = pauseStore(store, t0 + 25_000); // +10s
    expect(store.accumulated).toBe(20);
    store = resumeStore(store, t0 + 40_000);
    expect(calcElapsed(store, t0 + 45_000)).toBe(25); // 20 + 5
  });

  it("3. startStore（全新开始）accumulated 恒为 0，与 resumeStore 语义不同", () => {
    const fresh = startStore("item-2", "task", "task-2", 5000);
    expect(fresh.accumulated).toBe(0);
    expect(fresh.startedAt).toBe(5000);
  });
});
