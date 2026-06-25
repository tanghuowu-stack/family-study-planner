/**
 * realtimeSync.ts
 *
 * Supabase Realtime 自动同步（TASK_01）。
 * 职责：登录进入云端模式后建立 Realtime 订阅，监听 4 张核心表的变更，
 * 收到事件后做最简单可靠的"拉一次最新数据"（不做增量 patch），并通知 UI 重渲染。
 * 同时监听 visibilitychange / focus / online 作为 PWA 回前台兜底。
 *
 * App.tsx 只负责 start/stop 与传入 refresh 回调，所有防抖/节流/订阅在此集中处理。
 */
import { supabase } from "./supabase";
import { cloudRepository } from "../data/cloudRepository";

/** 防抖窗口：窗口内多次事件合并成一次拉取，避免批量改动疯狂重渲染 */
const DEBOUNCE_MS = 600;
/** 前台/focus/online 触发的整页刷新节流间隔 */
const FOREGROUND_THROTTLE_MS = 10_000;
/** 加入 realtime publication 的 4 张表 */
const TABLES = ["tasks", "task_checklist_items", "task_occurrence_statuses", "plan_periods"] as const;

type Channel = ReturnType<NonNullable<typeof supabase>["channel"]>;

let channel: Channel | null = null;
let onChange: (() => void) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pulling = false;
let pendingWhilePulling = false;
let lastForegroundPull = 0;

/**
 * 拉取一次云端最新数据并通知 UI。
 * 幂等：重复拉同样数据无害（即使收到自己改动的回声也没问题）。
 * 串行化：拉取进行中再来的请求合并为一次补拉，避免并发覆盖缓存。
 */
async function doPull(): Promise<void> {
  if (pulling) {
    pendingWhilePulling = true;
    return;
  }
  pulling = true;
  try {
    await cloudRepository.refreshFromCloud();
    onChange?.();
  } catch (e) {
    console.warn("[realtimeSync] 拉取云端数据失败", e);
  } finally {
    pulling = false;
    if (pendingWhilePulling) {
      pendingWhilePulling = false;
      void doPull();
    }
  }
}

/** Realtime 事件入口：防抖合并后拉取一次 */
function schedulePull(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void doPull();
  }, DEBOUNCE_MS);
}

/** 前台/focus/网络恢复触发：10 秒内不重复整页刷新 */
function foregroundPull(): void {
  const now = Date.now();
  if (now - lastForegroundPull < FOREGROUND_THROTTLE_MS) return;
  lastForegroundPull = now;
  void doPull();
}

function handleVisibility(): void {
  if (document.visibilityState === "visible") foregroundPull();
}

/**
 * 启动 Realtime 订阅 + 回前台兜底。
 * @param onChangeCb 数据更新后用来触发页面重渲染（传 App 的 refresh）
 */
export function startRealtimeSync(onChangeCb: () => void): void {
  if (!supabase) return;
  if (channel) return; // 已订阅，避免重复
  onChange = onChangeCb;

  const ch = supabase.channel("family-sync");
  for (const table of TABLES) {
    ch.on("postgres_changes", { event: "*", schema: "public", table }, () => schedulePull());
  }
  ch.subscribe((status) => {
    // 订阅成功 / 断线重连成功后，先做一次全量拉取，补回断线期间错过的变更，
    // 不能只依赖后续推送。
    if (status === "SUBSCRIBED") {
      lastForegroundPull = Date.now();
      void doPull();
    }
  });
  channel = ch;

  // PWA 回前台 / 窗口 focus / 网络恢复时主动拉一次（WebSocket 在后台可能已断）
  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener("focus", foregroundPull);
  window.addEventListener("online", foregroundPull);
}

/** 停止订阅并清理所有监听与定时器（组件卸载时调用，防止重复订阅/泄漏） */
export function stopRealtimeSync(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  document.removeEventListener("visibilitychange", handleVisibility);
  window.removeEventListener("focus", foregroundPull);
  window.removeEventListener("online", foregroundPull);
  if (channel && supabase) {
    void supabase.removeChannel(channel);
  }
  channel = null;
  onChange = null;
  pendingWhilePulling = false;
}
