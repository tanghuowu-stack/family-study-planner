import { BarChart3, CalendarDays, Cloud, ClipboardList, Home, Plus, Settings, Table2 } from "lucide-react";
import { addDays } from "date-fns";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { TaskForm } from "./components/TaskForm";
import { SidebarMemo } from "./components/SidebarMemo";
import { ExtendRecurringDialog } from "./components/ExtendRecurringDialog";
import { DatePickDialog, quickDatesFrom, type DateChoice } from "./components/DatePickDialog";
import { getRepository, isCloudMode, setCloudMode } from "./data/repositoryProvider";
import { cloudRepository, setCloudSyncErrorHandler } from "./data/cloudRepository";
import { taskRepository } from "./data/taskRepository";
import { loadAuthState } from "./lib/cloudAuth";
import { startRealtimeSync, stopRealtimeSync } from "./lib/realtimeSync";
import { StatsPage } from "./pages/StatsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { DayPage } from "./pages/DayPage";
import { MonthPage } from "./pages/MonthPage";
import { TaskManagementPage } from "./pages/TaskManagementPage";
import { TimetablePage } from "./pages/TimetablePage";
import type { Task, TaskDisplay, TaskDraft, TaskStatus } from "./types/task";
import { fromDateKey, shouldReturnToToday, todayKey, toDateKey } from "./utils/date";
import { isOccurrenceSchedule, itemSyncKey, taskSyncKey } from "./utils/taskMeta";
import { archiveSidebarMemo, deleteSidebarMemoHistory, loadSidebarMemoState, restoreSidebarMemo, saveSidebarMemo, type MemoHistoryEntry, type SidebarMemoSetting } from "./data/appSettingsRepository";

type Page = "today" | "month" | "tasks" | "stats" | "timetable" | "settings";
const navItems = [
  { page: "today" as const, label: "今日", icon: Home },
  { page: "month" as const, label: "月视图", icon: CalendarDays }, { page: "tasks" as const, label: "任务管理", icon: ClipboardList },
  { page: "stats" as const, label: "打卡", icon: BarChart3 },
  { page: "timetable" as const, label: "课表", icon: Table2 },
];

export default function App() {
  const [page, setPage] = useState<Page>("today");
  const [selectedDate, setSelectedDate] = useState(todayKey());
  // carry / justAdded / round：「保存，再加一个」时用上一张表单的分类与日期重新打开一张空白表单（round 变化即重新挂载）
  const [form, setForm] = useState<{ open: boolean; task?: Task; carry?: Partial<TaskDraft>; justAdded?: string[]; round?: number }>({ open: false });
  const [extendTarget, setExtendTarget] = useState<Task | null>(null);
  // 选日期弹窗（复制到日期 / 这一次改到别的日子），替代浏览器自带的手输日期框
  const [datePick, setDatePick] = useState<{ title: string; description?: string; initialDate: string; choices: DateChoice[]; note?: { label: string; initial?: string; placeholder?: string }; confirmText: string; onConfirm: (date: string, note: string) => Promise<void> } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState("");
  const [syncErrorToast, setSyncErrorToast] = useState("");
  const [cloudMode, setCloudModeState] = useState(false);
  const [cloudInitializing, setCloudInitializing] = useState(true);
  const [unsyncedTasks, setUnsyncedTasks] = useState<Set<string>>(new Set());
  const [unsyncedItems, setUnsyncedItems] = useState<Set<string>>(new Set());
  const [memo, setMemo] = useState("");
  const [memoEditorOpen, setMemoEditorOpen] = useState(false);
  const [memoFocusRequest, setMemoFocusRequest] = useState(0);
  const [memoHistory, setMemoHistory] = useState<MemoHistoryEntry[]>([]);
  const [memoBusy, setMemoBusy] = useState(false);
  const memoBusyRef = useRef(false);
  const memoRef = useRef("");
  const memoEditingRef = useRef(false);
  const memoLoadRequestRef = useRef(0);
  const memoEditVersionRef = useRef(0);
  const memoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const memoSaveQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  const refresh = () => setRefreshKey((value) => value + 1);
  const notify = (text: string) => { setToast(text); setTimeout(() => setToast(""), 2600); };
  // 失败提示独立于成功提示，展示更久，不会被后续操作的成功 toast 覆盖掉
  const notifyFailure = (text: string) => { setSyncErrorToast(text); setTimeout(() => setSyncErrorToast(""), 6000); };
  const markUnsynced = (set: Dispatch<SetStateAction<Set<string>>>, key: string) =>
    set((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  const clearUnsynced = (set: Dispatch<SetStateAction<Set<string>>>, key: string) =>
    set((prev) => { if (!prev.has(key)) return prev; const next = new Set(prev); next.delete(key); return next; });

  const queueMemoOperation = <T,>(operation: () => Promise<T>): Promise<T> => {
    const save = memoSaveQueueRef.current.then(operation, operation);
    memoSaveQueueRef.current = save;
    return save;
  };
  const queueMemoSave = (value: string) => queueMemoOperation(() => saveSidebarMemo(value));
  const beginMemoEdit = () => { if (memoBusyRef.current) return; memoEditVersionRef.current += 1; memoEditingRef.current = true; };
  const openMemoEditor = () => {
    if (memoBusyRef.current) return;
    beginMemoEdit();
    setMemoEditorOpen(true);
    setMemoFocusRequest((value) => value + 1);
  };
  const finishNarrowMemoEdit = () => {
    setMemoEditorOpen(false);
    void finishMemoEdit();
  };
  const changeMemo = (value: string) => {
    if (memoBusyRef.current) return;
    memoEditingRef.current = true;
    memoRef.current = value;
    setMemo(value);
    if (memoSaveTimerRef.current) clearTimeout(memoSaveTimerRef.current);
    memoSaveTimerRef.current = setTimeout(() => {
      memoSaveTimerRef.current = null;
      void queueMemoSave(memoRef.current).catch(() => notifyFailure("备忘录保存失败，请重试"));
    }, 1000);
  };
  const finishMemoEdit = async () => {
    // 归档/恢复期间正文只读；此时的失焦不能再排入旧正文保存，避免把归档内容写回来。
    if (memoBusyRef.current) return;
    if (memoSaveTimerRef.current) { clearTimeout(memoSaveTimerRef.current); memoSaveTimerRef.current = null; }
    const editVersion = memoEditVersionRef.current;
    const save = queueMemoSave(memoRef.current);
    try { await save; }
    catch { notifyFailure("备忘录保存失败，当前文字仍保留在输入框中"); return; }
    // 点完成按钮时会先触发 textarea blur，再触发按钮 click。只有自己仍是最后一次操作时才结束编辑锁，
    // 避免“保存旧文字”的回声在“清空”请求完成前把旧内容短暂写回界面。
    if (editVersion === memoEditVersionRef.current && save === memoSaveQueueRef.current) memoEditingRef.current = false;
  };
  const updateMemoHistory = async (operation: () => Promise<SidebarMemoSetting>, message: string) => {
    if (memoBusyRef.current) return;
    memoBusyRef.current = true;
    setMemoBusy(true);
    if (memoSaveTimerRef.current) {
      clearTimeout(memoSaveTimerRef.current);
      memoSaveTimerRef.current = null;
      void queueMemoSave(memoRef.current).catch(() => notifyFailure("备忘录保存失败，请重试"));
    }
    const editVersion = ++memoEditVersionRef.current;
    memoEditingRef.current = true;
    const save = queueMemoOperation(operation);
    try {
      const setting = await save;
      memoRef.current = setting.text;
      setMemo(setting.text);
      setMemoHistory(setting.history);
      setMemoEditorOpen(false);
      notify(message);
    } catch (reason) {
      notifyFailure(reason instanceof Error ? reason.message : "历史备忘保存失败，请重试");
    } finally {
      if (editVersion === memoEditVersionRef.current && save === memoSaveQueueRef.current) memoEditingRef.current = false;
      memoBusyRef.current = false;
      setMemoBusy(false);
    }
  };
  const completeMemo = () => {
    const text = memoRef.current;
    if (!text.trim()) return;
    return updateMemoHistory(() => archiveSidebarMemo(text), "已存入历史备忘");
  };

  // 云端拉取或 Realtime 触发刷新时重读备忘录；编辑期间忽略远端结果，避免旧内容冲掉正在输入的文字。
  useEffect(() => {
    const requestId = ++memoLoadRequestRef.current;
    void loadSidebarMemoState().then((value) => {
      if (memoEditingRef.current || requestId !== memoLoadRequestRef.current) return;
      memoRef.current = value.text;
      setMemo(value.text);
      setMemoHistory(value.history);
    });
  }, [refreshKey, cloudMode]);

  useEffect(() => {
    const flushMemo = () => { if (memoEditingRef.current && !memoBusyRef.current) void queueMemoSave(memoRef.current).catch(() => notifyFailure("备忘录保存失败，请重试")); };
    window.addEventListener("pagehide", flushMemo);
    return () => {
      window.removeEventListener("pagehide", flushMemo);
      if (memoSaveTimerRef.current) clearTimeout(memoSaveTimerRef.current);
    };
  }, []);

  // 今日页自动回到今天：跨零点（隔夜没关）或在后台放了很久再回来时触发，
  // 避免孩子早上打开看到的还是昨天/别的日期的清单并在那一页上勾选。
  useEffect(() => {
    let lastSeenToday = todayKey();
    let hiddenAt: number | null = null;
    const check = (hiddenMs = 0) => {
      const today = todayKey();
      if (shouldReturnToToday(lastSeenToday, today, hiddenMs)) {
        setSelectedDate(today);
        if (lastSeenToday !== today) refresh(); // 日期没变也要重渲染，让"是不是今天"的判断更新
      }
      lastSeenToday = today;
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
      check(hiddenAt === null ? 0 : Date.now() - hiddenAt);
      hiddenAt = null;
    };
    document.addEventListener("visibilitychange", onVisibility);
    const timer = setInterval(() => check(), 60_000);
    return () => { document.removeEventListener("visibilitychange", onVisibility); clearInterval(timer); };
  }, []);

  // ── 云同步启动/切换 ─────────────────────────────────────────────────────────
  // 挂载时跑一次，登录/登出后由 CloudLoginPanel 回调再跑一次。
  // 早期只在挂载时跑，导致"本次打开时才登录"的设备（新手机/iPad）停在本地模式、
  // 数据库空白，必须手动刷新页面才会拉数据（2026-08-18 修复）。
  const syncCloudSession = async () => {
    try {
      const state = await loadAuthState();
      if (state.familyId) {
        setCloudMode(state.familyId);
        setCloudModeState(true);
        setCloudSyncErrorHandler((msg) => notifyFailure(`⚠️ ${msg}，请检查网络`));
        // 从云端拉取最新数据到本地缓存
        await cloudRepository.refreshFromCloud().catch((e) =>
          console.warn("[App] 云端同步失败，降级到本地模式", e)
        );
        refresh();
        // 进入云端模式后建立 Realtime 订阅，数据变更自动拉取并重渲染
        await startRealtimeSync(refresh);
      } else {
        // 登出：停订阅、退回本地模式，避免继续用失效的 familyId 读写
        stopRealtimeSync();
        setCloudMode(null);
        setCloudModeState(false);
        refresh();
      }
    } catch (e) {
      console.warn("[App] 云同步初始化失败，使用本地模式", e);
    } finally {
      setCloudInitializing(false);
    }
  };

  useEffect(() => {
    void syncCloudSession();
    return () => stopRealtimeSync();
  }, []);

  const repo = () => getRepository();

  const saveTask = async (draft: TaskDraft, force = false) => {
    const conflicts = force ? [] : await repo().findTimeConflicts(draft, form.task?.id);
    if (conflicts.length) throw new Error(`TIME_CONFLICT:${conflicts[0].title}`);
    const isEdit = !!form.task;
    const { task, synced } = isEdit ? await repo().update(form.task!.id, draft) : await repo().create(draft);
    refresh();
    // 本地写入必成功，云端同步据实反馈：失败则挂黄标（复用打钩失败的重试入口），不再误报"已添加"
    const key = taskSyncKey(task);
    if (synced) { clearUnsynced(setUnsyncedTasks, key); notify(isEdit ? "任务已更新" : "任务已添加"); }
    else { markUnsynced(setUnsyncedTasks, key); notifyFailure("⚠️ 已保存到本地，未同步云端，点任务旁的标记可重试"); }
  };
  // 过去日补勾：非重复任务记为查看日完成，提示用户记到了哪天（重复类的完成本来就记在它自己那天，不提示）
  const backdatedLabel = (task: TaskDisplay, asOfDate?: string) =>
    asOfDate && asOfDate < todayKey() && !isOccurrenceSchedule(task) ? `已记为 ${Number(asOfDate.slice(5, 7))}/${Number(asOfDate.slice(8, 10))} 完成` : null;
  const changeStatus = async (task: TaskDisplay, status: TaskStatus, asOfDate?: string) => {
    const key = taskSyncKey(task);
    // 本地写完立刻刷新界面（进度条、还剩几项、行的位置都跟着变）；云端上传在后台继续，
    // 它的结果只影响"未同步"标记。勾选本身的反馈交给行内动画，成功不再弹提示，只有补记到过去日才说明记到了哪天。
    const backdated = status === "done" ? backdatedLabel(task, asOfDate) : null;
    try {
      const result = await repo().setDisplayStatus(task, status, asOfDate, () => { refresh(); if (backdated) notify(backdated); });
      if (result.synced) clearUnsynced(setUnsyncedTasks, key);
      else { markUnsynced(setUnsyncedTasks, key); notifyFailure("⚠️ 未同步到云端，点击任务旁的标记可重试"); }
    } catch { refresh(); markUnsynced(setUnsyncedTasks, key); notifyFailure("⚠️ 保存失败，请检查网络"); }
  };
  const toggleChecklist = async (task: TaskDisplay, itemId: string, asOfDate?: string) => {
    const key = itemSyncKey(task.id, itemId);
    // 目标状态按"界面上看到的"取反：历史日回放会把之后才勾的小项显示为未勾，点它是要补记为那天完成，不是取消
    const done = !task.checklistItems?.find((item) => item.id === itemId)?.done;
    const backdated = done ? backdatedLabel(task, asOfDate) : null;
    try {
      const result = await repo().toggleChecklistItem(task.id, itemId, task.occurrenceDate, { asOfDate, done }, () => { refresh(); if (backdated) notify(backdated); });
      if (result.synced) clearUnsynced(setUnsyncedItems, key);
      else { markUnsynced(setUnsyncedItems, key); notifyFailure("⚠️ 未同步到云端，点击小项旁的标记可重试"); }
    } catch { refresh(); markUnsynced(setUnsyncedItems, key); notifyFailure("⚠️ 保存失败，请检查网络"); }
  };
  // 当天记录：本机写完即刷新；云端没传上去时挂"未同步"标记，点它重试会把整条任务（含记录）重新上传
  const saveDayNote = async (task: TaskDisplay, text: string, date: string) => {
    const key = taskSyncKey(task);
    try {
      const synced = await repo().setDayNote(task.id, date, text, refresh);
      if (!synced) { markUnsynced(setUnsyncedTasks, key); notifyFailure("⚠️ 记录未同步到云端，点击任务旁的标记可重试"); }
    } catch { refresh(); notifyFailure("⚠️ 记录保存失败，请重试"); }
  };
  const retryTaskSync = async (task: TaskDisplay) => {
    const key = taskSyncKey(task);
    const synced = await repo().resyncTask(task.id, task.occurrenceDate);
    if (synced) { clearUnsynced(setUnsyncedTasks, key); notify("已同步"); }
    else notifyFailure("⚠️ 仍未同步，请检查网络");
  };
  const retryItemSync = async (task: TaskDisplay, itemId: string) => {
    const key = itemSyncKey(task.id, itemId);
    const synced = await repo().resyncTask(task.id, task.occurrenceDate);
    if (synced) { clearUnsynced(setUnsyncedItems, key); notify("已同步"); }
    else notifyFailure("⚠️ 仍未同步，请检查网络");
  };
  // 编辑以库里的任务本体为基准：今日页传来的是按天展示的快照（小项勾选按那一天回放、状态按单日覆盖），
  // 直接拿它做草稿保存，会把展示值写回库里（比如重复任务别的日子勾过的小项被清掉）
  const editTask = async (task: Task) => { const fresh = await taskRepository.getTask(task.id); setForm({ open: true, task: fresh ?? task }); };
  const copyTask = (task: Task) => {
    const taskDate = task.date ?? task.startDate ?? selectedDate;
    const today = todayKey();
    setDatePick({
      title: "复制到哪一天", description: `复制“${task.title || "这项任务"}”为那天的单日任务，小项重新开始。`,
      initialDate: toDateKey(addDays(fromDateKey(taskDate), 1)),
      choices: [{ label: "今天", date: today }, ...quickDatesFrom(today).slice(0, 2)],
      confirmText: "复制",
      onConfirm: async (date) => { await repo().copyToDate(task.id, date); refresh(); notify(`已复制到 ${Number(date.slice(5, 7))}/${Number(date.slice(8))}`); },
    });
  };
  const deleteTask = async (task: Task) => { if (!confirm(`确定删除"${task.title}"吗？${task.timeType === "recurring" ? "这会删除整个重复任务。" : ""}`)) return; await repo().remove(task.id); refresh(); notify("任务已删除"); };
  // 结束长期重复任务：今天起不再排期，但任务本体保留、历史记录与统计月历卡片继续可见（区别于删除的软删）
  const endTask = async (task: Task) => { if (!confirm(`今天起不再安排"${task.title}"吗？历史记录和打卡月历都会保留，之后可以用"继续安排"恢复。`)) return; const { synced } = await repo().endRecurring(task.id); refresh(); if (synced) notify("今天起不再安排"); else notifyFailure("⚠️ 已保存到本地，未同步云端，请检查网络"); };
  // 延长周期：只改 recurrence.endDate，不建新任务——替代"到期后手动新建同名任务续期"
  const extendTask = (task: Task) => setExtendTarget(task);
  const confirmExtend = async (newEndDate: string | undefined) => {
    if (!extendTarget) return;
    const { synced } = await repo().extendRecurring(extendTarget.id, newEndDate);
    refresh();
    if (synced) notify(newEndDate ? `已继续安排到 ${newEndDate}` : "已改为长期安排");
    else notifyFailure("⚠️ 已保存到本地，未同步云端，请检查网络");
  };
  const cancelOccurrence = async (task: TaskDisplay) => { if (!task.occurrenceDate || !confirm("这一次跳过吗？只影响这一天，以后照常安排。")) return; await repo().setOccurrence(task.id, task.occurrenceDate, "cancelled"); refresh(); notify("这一次已跳过"); };
  const postponeOccurrence = (task: TaskDisplay) => {
    const occurrenceDate = task.occurrenceDate;
    if (!occurrenceDate) return;
    setDatePick({
      title: "这一次改到哪一天", description: `只挪${Number(occurrenceDate.slice(5, 7))}月${Number(occurrenceDate.slice(8))}日这一次，以后照常安排。`,
      initialDate: task.overrideDate ?? toDateKey(addDays(fromDateKey(occurrenceDate), 1)),
      choices: quickDatesFrom(occurrenceDate, ["后一天", "后两天", "下周这天"]),
      note: { label: "说明（可选）", initial: task.overrideNote ?? "", placeholder: "例如：老师调课" },
      confirmText: "改到这天",
      onConfirm: async (date, note) => { await repo().setOccurrence(task.id, occurrenceDate, "postponed", date, note); refresh(); notify(`这一次已改到 ${Number(date.slice(5, 7))}/${Number(date.slice(8))}`); },
    });
  };
  const openDay = (date: string) => { setSelectedDate(date); setPage("today"); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const actions = { onStatusChange: changeStatus, onChecklistToggle: toggleChecklist, onDayNoteSave: saveDayNote, onCopy: copyTask, onEdit: editTask, onDelete: deleteTask, onEnd: endTask, onExtend: extendTask, onOccurrenceCancel: cancelOccurrence, onOccurrencePostpone: postponeOccurrence, unsyncedTasks, unsyncedItems, onRetrySync: retryTaskSync, onRetryItemSync: retryItemSync };
  return <div className="min-h-screen bg-paper text-ink">
    <aside className="fixed inset-y-0 left-0 z-50 hidden w-56 flex-col overflow-y-auto bg-ink px-3 py-5 text-white lg:flex">
      <button onClick={() => setPage("today")} className="flex items-center gap-3 px-2 text-left">
        <img src="/favicon.svg" alt="" className="h-10 w-10 rounded-lg" />
        <span><span className="block text-lg font-bold">小步计划</span><span className="block text-[10px] text-white/50">家庭执行台</span></span>
      </button>
      <button onClick={() => setForm({ open: true })} className="mt-6 flex w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-alert px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#cf5b40]"><Plus className="h-4 w-4" />新建任务</button>
      <nav className="mt-6 space-y-1">{navItems.map(({ page: value, label, icon: Icon }) => <button key={value} onClick={() => setPage(value)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${page === value ? "bg-white text-ink" : "text-white/65 hover:bg-white/10 hover:text-white"}`}><Icon className="h-4 w-4" />{label}{page === value && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-alert" />}</button>)}</nav>
      <SidebarMemo value={memo} variant="sidebar" busy={memoBusy} onFocus={beginMemoEdit} onChange={changeMemo} onBlur={() => void finishMemoEdit()} onComplete={() => void completeMemo()} />
      <div className="mt-auto shrink-0 border-t border-white/10 pt-4">
        {/* 设置入口与云同步状态合在一起：低频维护项（云同步、课程、假期、备份…）都在设置页 */}
        <button onClick={() => setPage("settings")} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${page === "settings" ? "bg-white text-ink" : "text-white/65 hover:bg-white/10 hover:text-white"}`}><Settings className="h-4 w-4" />设置{!cloudInitializing && <span title={cloudMode ? "云端已连接" : "本地模式"} className={`ml-auto inline-flex items-center gap-1.5 text-xs ${page === "settings" ? "text-muted" : "text-white/55"}`}><span className={`h-2 w-2 rounded-full ${cloudMode ? "bg-emerald-400" : "bg-white/30"}`} /><Cloud className="h-3.5 w-3.5" /><span className="sr-only">{cloudMode ? "云端已连接" : "本地模式"}</span></span>}</button>
      </div>
    </aside>
    <header className="pt-safe sticky top-0 z-40 border-b border-ink/10 bg-paper/95 backdrop-blur-xl lg:hidden"><div className="flex h-14 items-center justify-between px-4"><button onClick={() => setPage("today")} className="flex items-center gap-2.5"><img src="/favicon.svg" alt="" className="h-8 w-8 rounded-lg" /><span className="text-left text-base font-bold">小步计划</span></button><div className="flex items-center gap-2">{!cloudInitializing && <span title={cloudMode ? "云端已连接" : "本地模式"} className={`h-2 w-2 rounded-full ${cloudMode ? "bg-emerald-500" : "bg-stone-300"}`} />}<button type="button" aria-label="设置" title="设置" onClick={() => setPage("settings")} className={`flex h-11 w-11 items-center justify-center rounded-lg border ${page === "settings" ? "border-primary/30 bg-primary/10 text-primary" : "border-ink/10 bg-white text-muted hover:text-primary"}`}><Settings className="h-5 w-5" /></button>{page === "today" && <button type="button" onClick={openMemoEditor} aria-controls="today-memo" aria-expanded={memoEditorOpen} className="h-11 shrink-0 rounded-lg border border-ink/10 bg-white px-3 text-sm font-medium text-muted hover:text-primary">备忘</button>}<button aria-label="添加任务" onClick={() => setForm({ open: true })} className="flex h-11 w-11 items-center justify-center rounded-lg bg-alert text-white"><Plus className="h-4 w-4" /></button></div></div></header>
    <div className="app-content">
      {page === "today" && <DayPage date={selectedDate} refreshKey={refreshKey} onDateChange={setSelectedDate} onOpenMonth={() => setPage("month")} onAddTask={() => setForm({ open: true })} memo={memo} memoEditorOpen={memoEditorOpen} memoFocusRequest={memoFocusRequest} memoBusy={memoBusy} onMemoFocus={beginMemoEdit} onMemoChange={changeMemo} onMemoBlur={finishNarrowMemoEdit} onMemoComplete={() => void completeMemo()} {...actions} />}
      {page === "month" && <MonthPage date={selectedDate} refreshKey={refreshKey} onDateChange={setSelectedDate} onOpenDay={openDay} onAddTask={(date) => { setSelectedDate(date); setForm({ open: true }); }} />}
      {page === "tasks" && <TaskManagementPage refreshKey={refreshKey} onRefresh={refresh} notify={notify} onEdit={(task) => setForm({ open: true, task })} onDelete={deleteTask} onEnd={endTask} onExtend={extendTask} onCopy={copyTask} />}
      {page === "stats" && <StatsPage />}
      {page === "settings" && <SettingsPage refreshKey={refreshKey} onImported={refresh} notify={notify} cloudMode={cloudMode} onAuthChange={syncCloudSession} memoHistory={memoHistory} memoBusy={memoBusy} onRestoreMemo={(id) => updateMemoHistory(() => restoreSidebarMemo(id), "已恢复到当前备忘，有原内容时会追加")} onDeleteMemo={(id) => updateMemoHistory(() => deleteSidebarMemoHistory(id), "历史备忘已永久删除")} />}
      {page === "timetable" && <TimetablePage />}
    </div>
    <nav className="bottom-nav-safe fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-white/95 backdrop-blur lg:hidden"><div className="grid grid-cols-5 px-2 pt-1">{navItems.map(({ page: value, label, icon: Icon }) => <button key={value} onClick={() => setPage(value)} className={`relative flex min-w-0 flex-col items-center gap-0.5 px-1 py-1.5 text-[10px] ${page === value ? "text-primary" : "text-muted"}`}>{page === value && <span className="absolute -top-1 h-0.5 w-8 bg-alert" />}<Icon className="h-5 w-5" /><span className="truncate">{label}</span></button>)}</div></nav>
    {form.open && <TaskForm key={form.round ?? 0} task={form.task} initialDate={selectedDate} carry={form.carry} justAdded={form.justAdded} onClose={() => setForm({ open: false })} onSave={saveTask} onContinue={(carry, savedTitle) => setForm((current) => ({ open: true, carry, justAdded: [...(current.justAdded ?? []), savedTitle], round: (current.round ?? 0) + 1 }))} />}
    {extendTarget && <ExtendRecurringDialog task={extendTarget} onClose={() => setExtendTarget(null)} onConfirm={confirmExtend} />}
    {datePick && <DatePickDialog {...datePick} onClose={() => setDatePick(null)} />}
    {toast && <div className="toast-safe fixed bottom-24 left-1/2 z-[70] -translate-x-1/2 rounded-lg bg-ink px-5 py-2.5 text-sm text-white shadow-xl lg:bottom-8 lg:ml-[7.5rem]">{toast}</div>}
    {syncErrorToast && <div className="toast-safe-above fixed bottom-[8.5rem] left-1/2 z-[71] -translate-x-1/2 rounded-lg bg-sun px-5 py-2.5 text-sm font-medium text-ink shadow-xl lg:bottom-24 lg:ml-[7.5rem]">{syncErrorToast}</div>}
  </div>;
}
