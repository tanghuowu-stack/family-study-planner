import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

const LS_KEY = "familyPlanner.activeTimer";
const STALE_MS = 12 * 60 * 60 * 1000;

interface TimerStore {
  targetId: string;      // item.id for checklist, task.id for task-level
  taskId: string;        // parent task.id (same as targetId for task-level)
  targetType: "checklist" | "task";
  startedAt: number | null;
  accumulated: number;   // seconds for current session only
}

export type TimerSaveFn = (taskId: string, itemId: string | null, minutes: number) => Promise<void>;

interface TimerCtx {
  activeId: string | null;
  activeType: "checklist" | "task" | null;
  elapsed: number;       // current session seconds
  isRunning: boolean;
  start: (targetId: string, targetType: "checklist" | "task", taskId: string, saveFn: TimerSaveFn) => Promise<void>;
  pause: () => void;
  stop: (saveFn: TimerSaveFn) => Promise<void>;
}

const Ctx = createContext<TimerCtx | null>(null);

function readStore(): TimerStore | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const store = JSON.parse(raw) as TimerStore;
    if (store.startedAt && Date.now() - store.startedAt > STALE_MS) {
      localStorage.removeItem(LS_KEY);
      return null;
    }
    return store;
  } catch { return null; }
}

function calcElapsed(store: TimerStore): number {
  const fromStart = store.startedAt ? Math.floor((Date.now() - store.startedAt) / 1000) : 0;
  return store.accumulated + fromStart;
}

export function TimerProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<TimerStore | null>(readStore);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!store?.startedAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [store?.startedAt]);

  const persist = (s: TimerStore | null) => {
    setStore(s);
    if (s) localStorage.setItem(LS_KEY, JSON.stringify(s));
    else localStorage.removeItem(LS_KEY);
  };

  const elapsed = store ? calcElapsed(store) : 0;

  // Track whether we're in the middle of an async auto-save to avoid double-calls
  const savingRef = useRef(false);

  const start = async (
    targetId: string,
    targetType: "checklist" | "task",
    taskId: string,
    saveFn: TimerSaveFn,
  ) => {
    if (savingRef.current) return;
    // Auto-save the running timer if switching to a different item
    if (store && store.startedAt && store.targetId !== targetId) {
      const secs = calcElapsed(store);
      if (secs >= 30) {
        savingRef.current = true;
        const itemId = store.targetType === "checklist" ? store.targetId : null;
        await saveFn(store.taskId, itemId, Math.max(1, Math.round(secs / 60))).finally(() => {
          savingRef.current = false;
        });
      }
    }
    persist({ targetId, taskId, targetType, startedAt: Date.now(), accumulated: 0 });
    setTick(0);
  };

  const pause = () => {
    if (!store?.startedAt) return;
    persist({ ...store, startedAt: null, accumulated: calcElapsed(store) });
  };

  const stop = async (saveFn: TimerSaveFn) => {
    if (!store || savingRef.current) return;
    const secs = calcElapsed(store);
    const mins = Math.max(1, Math.round(secs / 60));
    savingRef.current = true;
    const itemId = store.targetType === "checklist" ? store.targetId : null;
    await saveFn(store.taskId, itemId, mins).finally(() => {
      savingRef.current = false;
    });
    persist(null);
    setTick(0);
  };

  return (
    <Ctx.Provider value={{
      activeId: store?.targetId ?? null,
      activeType: store?.targetType ?? null,
      elapsed,
      isRunning: !!store?.startedAt,
      start,
      pause,
      stop,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTimer(): TimerCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTimer must be used within TimerProvider");
  return ctx;
}

export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
