/**
 * 计时器状态的纯转换逻辑，从 TimerContext.tsx 抽出以便脱离 React 单测
 * （项目目前只有数据层 Vitest 用例，没有组件测试基础设施）。
 */
export interface TimerStore {
  targetId: string;      // item.id for checklist, task.id for task-level
  taskId: string;        // parent task.id (same as targetId for task-level)
  targetType: "checklist" | "task";
  startedAt: number | null;
  accumulated: number;   // seconds for current session only
}

export function calcElapsed(store: TimerStore, now: number = Date.now()): number {
  const fromStart = store.startedAt ? Math.floor((now - store.startedAt) / 1000) : 0;
  return store.accumulated + fromStart;
}

export function startStore(targetId: string, targetType: "checklist" | "task", taskId: string, now: number = Date.now()): TimerStore {
  return { targetId, taskId, targetType, startedAt: now, accumulated: 0 };
}

export function pauseStore(store: TimerStore, now: number = Date.now()): TimerStore {
  return { ...store, startedAt: null, accumulated: calcElapsed(store, now) };
}

// 恢复暂停中的同一个计时目标：只重开 startedAt，保留 accumulated——
// 不能复用 startStore()，否则会被当成"全新开始"把 accumulated 清零（2026-07-19 修复回归）
export function resumeStore(store: TimerStore, now: number = Date.now()): TimerStore {
  return { ...store, startedAt: now };
}
