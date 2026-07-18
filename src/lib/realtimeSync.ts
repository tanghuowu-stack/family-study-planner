/**
 * realtimeSync.ts
 *
 * Supabase Realtime 自动同步（TASK_01）。
 * 职责：登录进入云端模式后建立 Realtime 订阅，监听核心表变更，
 * 收到事件后做最简单可靠的"拉一次最新数据"（不做增量 patch），并通知 UI 重渲染。
 *
 * 健壮性（2026-07 修）：
 * - 订阅进入 CHANNEL_ERROR / TIMED_OUT / CLOSED 时按指数退避自动重订阅（2/4/8/16→30s 封顶，
 *   持续重试不放弃），重订阅前刷新 JWT、清理旧频道防泄漏；重订阅成功照旧补一次全量拉取。
 * - 除 Realtime/前台事件外，增加每 3 分钟定时兜底拉取（页面不可见时跳过，可见时前台事件已即时拉）。
 * - 所有拉取共用 10 秒节流器，避免多路触发叠加。
 */
import { supabase } from "./supabase";
import { cloudRepository } from "../data/cloudRepository";

/** 防抖窗口：窗口内多次事件合并成一次拉取，避免批量改动疯狂重渲染 */
const DEBOUNCE_MS = 600;
/** 前台/focus/online/定时兜底触发的整页刷新节流间隔 */
const FOREGROUND_THROTTLE_MS = 10_000;
/** 定时兜底拉取间隔（Realtime 丢事件时的追赶下界） */
const PERIODIC_PULL_MS = 3 * 60 * 1000;
/** 重订阅退避：首次 2s，每次翻倍，封顶 30s */
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;
/** 加入 realtime publication 的表 */
const TABLES = ["tasks", "task_checklist_items", "task_occurrence_statuses", "plan_periods", "courses"] as const;

type Channel = ReturnType<NonNullable<typeof supabase>["channel"]>;

let channel: Channel | null = null;
let onChange: (() => void) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let periodicTimer: ReturnType<typeof setInterval> | null = null;
let pulling = false;
let pendingWhilePulling = false;
let lastForegroundPull = 0;
let reconnectAttempts = 0;
/** 频道世代：每次重订阅 +1，旧频道回调用它作废，避免陈旧频道的 CLOSED 事件反复触发重连 */
let epoch = 0;
let stopped = false;
let authListener: { unsubscribe: () => void } | null = null;

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

/** 前台/focus/网络恢复/定时兜底触发：10 秒内不重复整页刷新 */
function foregroundPull(): void {
  const now = Date.now();
  if (now - lastForegroundPull < FOREGROUND_THROTTLE_MS) return;
  lastForegroundPull = now;
  void doPull();
}

function handleVisibility(): void {
  if (document.visibilityState === "visible") foregroundPull();
}

/** 建立一个新频道并订阅；断线进入退避重订阅循环 */
function subscribeChannel(): void {
  if (!supabase || stopped) return;
  const myEpoch = ++epoch;
  // 频道名带世代，避免与正在拆除的旧频道重名冲突
  const ch = supabase.channel(`family-sync-${myEpoch}`);
  for (const table of TABLES) {
    ch.on("postgres_changes", { event: "*", schema: "public", table }, () => schedulePull());
  }
  ch.subscribe((status, err) => {
    if (myEpoch !== epoch || stopped) return; // 陈旧频道的回调，忽略
    if (status === "SUBSCRIBED") {
      // 订阅成功 / 断线重连成功后，先做一次全量拉取，补回断线期间错过的变更
      reconnectAttempts = 0;
      lastForegroundPull = Date.now();
      void doPull();
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      console.warn(`[realtimeSync] 订阅异常：${status}，安排重订阅`, err ?? "");
      scheduleReconnect();
    }
  });
  channel = ch;
}

/** 指数退避安排一次重订阅（2/4/8/16→30s 封顶），持续重试不放弃 */
function scheduleReconnect(): void {
  if (stopped || reconnectTimer) return;
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempts, RECONNECT_MAX_MS);
  reconnectAttempts++;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (stopped || !supabase) return;
    // 作废旧频道回调并拆除，避免泄漏与重复事件
    epoch++;
    if (channel) {
      try { await supabase.removeChannel(channel); } catch { /* 忽略拆除异常 */ }
      channel = null;
    }
    // 重订阅前刷新 JWT，防止 token 过期导致 RLS 过滤掉所有事件
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) await supabase.realtime.setAuth(data.session.access_token);
    } catch { /* 取 session 失败仍尝试订阅，失败会再次进入退避 */ }
    subscribeChannel();
  }, delay);
}

/**
 * 启动 Realtime 订阅 + 定时兜底 + 回前台兜底。
 * @param onChangeCb 数据更新后用来触发页面重渲染（传 App 的 refresh）
 */
export async function startRealtimeSync(onChangeCb: () => void): Promise<void> {
  if (!supabase) return;
  if (channel || reconnectTimer) return; // 已订阅或正在重连，避免重复
  stopped = false;
  reconnectAttempts = 0;
  onChange = onChangeCb;

  // 关键：把当前登录用户的 JWT 交给 Realtime WebSocket。
  // 否则 socket 以匿名身份连接，RLS 在 realtime 上下文里按 anon 过滤，
  // get_my_family_id() 返回 null，postgres_changes 收不到任何事件
  // （写入和手动刷新走带 JWT 的 REST，所以照常工作，只有实时推送失效）。
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) await supabase.realtime.setAuth(token);

  // session 约每小时刷新一次，token 变化后必须同步给 realtime，
  // 否则订阅会在 token 过期后悄悄失效（iPad 长期挂在前台尤其需要）。
  authListener = supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.access_token && supabase) void supabase.realtime.setAuth(session.access_token);
  }).data.subscription;

  subscribeChannel();

  // 定时兜底：每 3 分钟拉一次（共用前台节流器）；页面不可见时跳过，恢复可见由 visibilitychange 即时拉
  periodicTimer = setInterval(() => {
    if (document.visibilityState === "visible") foregroundPull();
  }, PERIODIC_PULL_MS);

  // PWA 回前台 / 窗口 focus / 网络恢复时主动拉一次（WebSocket 在后台可能已断）
  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener("focus", foregroundPull);
  window.addEventListener("online", foregroundPull);
}

/** 停止订阅并清理所有监听与定时器（组件卸载/登出时调用，防止重复订阅、泄漏与重连风暴） */
export function stopRealtimeSync(): void {
  stopped = true;
  epoch++; // 作废所有在途频道回调，防止 removeChannel 的 CLOSED 触发重连
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (periodicTimer) { clearInterval(periodicTimer); periodicTimer = null; }
  document.removeEventListener("visibilitychange", handleVisibility);
  window.removeEventListener("focus", foregroundPull);
  window.removeEventListener("online", foregroundPull);
  if (authListener) {
    authListener.unsubscribe();
    authListener = null;
  }
  if (channel && supabase) {
    void supabase.removeChannel(channel);
  }
  channel = null;
  onChange = null;
  pendingWhilePulling = false;
  reconnectAttempts = 0;
}
