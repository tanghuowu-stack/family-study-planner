import { BarChart3, CalendarCheck2, CalendarDays, Cloud, ClipboardList, Home, Plus, Table2 } from "lucide-react";
import { addDays } from "date-fns";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { TaskForm } from "./components/TaskForm";
import { ExtendRecurringDialog } from "./components/ExtendRecurringDialog";
import { getRepository, isCloudMode, setCloudMode } from "./data/repositoryProvider";
import { cloudRepository, setCloudSyncErrorHandler } from "./data/cloudRepository";
import { loadAuthState } from "./lib/cloudAuth";
import { startRealtimeSync, stopRealtimeSync } from "./lib/realtimeSync";
import { StatsPage } from "./pages/StatsPage";
import { DayPage } from "./pages/DayPage";
import { MonthPage } from "./pages/MonthPage";
import { TaskManagementPage } from "./pages/TaskManagementPage";
import { TimetablePage } from "./pages/TimetablePage";
import type { Task, TaskDisplay, TaskDraft, TaskStatus } from "./types/task";
import { fromDateKey, todayKey, toDateKey } from "./utils/date";
import { isOccurrenceSchedule, itemSyncKey, taskSyncKey } from "./utils/taskMeta";

type Page = "today" | "month" | "tasks" | "stats" | "timetable";
const navItems = [
  { page: "today" as const, label: "今日", icon: Home },
  { page: "month" as const, label: "月视图", icon: CalendarDays }, { page: "tasks" as const, label: "任务管理", icon: ClipboardList },
  { page: "stats" as const, label: "统计", icon: BarChart3 },
  { page: "timetable" as const, label: "课表", icon: Table2 },
];

export default function App() {
  const [page, setPage] = useState<Page>("today");
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [form, setForm] = useState<{ open: boolean; task?: Task }>({ open: false });
  const [extendTarget, setExtendTarget] = useState<Task | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState("");
  const [syncErrorToast, setSyncErrorToast] = useState("");
  const [cloudMode, setCloudModeState] = useState(false);
  const [cloudInitializing, setCloudInitializing] = useState(true);
  const [unsyncedTasks, setUnsyncedTasks] = useState<Set<string>>(new Set());
  const [unsyncedItems, setUnsyncedItems] = useState<Set<string>>(new Set());

  const refresh = () => setRefreshKey((value) => value + 1);
  const notify = (text: string) => { setToast(text); setTimeout(() => setToast(""), 2600); };
  // 失败提示独立于成功提示，展示更久，不会被后续操作的成功 toast 覆盖掉
  const notifyFailure = (text: string) => { setSyncErrorToast(text); setTimeout(() => setSyncErrorToast(""), 6000); };
  const markUnsynced = (set: Dispatch<SetStateAction<Set<string>>>, key: string) =>
    set((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  const clearUnsynced = (set: Dispatch<SetStateAction<Set<string>>>, key: string) =>
    set((prev) => { if (!prev.has(key)) return prev; const next = new Set(prev); next.delete(key); return next; });

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
        setCloudSyncErrorHandler((msg) => notify(`⚠️ ${msg}，请检查网络`));
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
    try {
      const result = await repo().setDisplayStatus(task, status, asOfDate);
      refresh();
      const backdated = status === "done" ? backdatedLabel(task, asOfDate) : null;
      if (result.synced) { clearUnsynced(setUnsyncedTasks, key); notify(backdated ?? (status === "done" ? "已完成" : "状态已更新")); }
      else { markUnsynced(setUnsyncedTasks, key); if (backdated) notify(backdated); notifyFailure("⚠️ 未同步到云端，点击任务旁的标记可重试"); }
    } catch { refresh(); markUnsynced(setUnsyncedTasks, key); notifyFailure("⚠️ 保存失败，请检查网络"); }
  };
  const toggleChecklist = async (task: TaskDisplay, itemId: string, asOfDate?: string) => {
    const key = itemSyncKey(task.id, itemId);
    // 目标状态按"界面上看到的"取反：历史日回放会把之后才勾的小项显示为未勾，点它是要补记为那天完成，不是取消
    const done = !task.checklistItems?.find((item) => item.id === itemId)?.done;
    try {
      const result = await repo().toggleChecklistItem(task.id, itemId, task.occurrenceDate, { asOfDate, done });
      refresh();
      const backdated = done ? backdatedLabel(task, asOfDate) : null;
      if (backdated) notify(backdated);
      if (result.synced) clearUnsynced(setUnsyncedItems, key);
      else { markUnsynced(setUnsyncedItems, key); notifyFailure("⚠️ 未同步到云端，点击小项旁的标记可重试"); }
    } catch { refresh(); markUnsynced(setUnsyncedItems, key); notifyFailure("⚠️ 保存失败，请检查网络"); }
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
  const copyTask = async (task: Task) => { const taskDate = task.date ?? task.startDate ?? selectedDate; const defaultDate = toDateKey(addDays(fromDateKey(taskDate), 1)); const date = prompt("复制到哪一天？请输入 YYYY-MM-DD", defaultDate); if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return; await repo().copyToDate(task.id, date); refresh(); notify(`已复制到 ${date}`); };
  const deleteTask = async (task: Task) => { if (!confirm(`确定删除"${task.title}"吗？${task.timeType === "recurring" ? "这会删除整个重复任务。" : ""}`)) return; await repo().remove(task.id); refresh(); notify("任务已删除"); };
  // 结束长期重复任务：今天起不再排期，但任务本体保留、历史记录与统计月历卡片继续可见（区别于删除的软删）
  const endTask = async (task: Task) => { if (!confirm(`结束"${task.title}"吗？今天起不再排期，历史记录和打卡月历都会保留。`)) return; const { synced } = await repo().endRecurring(task.id); refresh(); if (synced) notify("已结束，今天起不再排期"); else notifyFailure("⚠️ 已保存到本地，未同步云端，请检查网络"); };
  // 延长周期：只改 recurrence.endDate，不建新任务——替代"到期后手动新建同名任务续期"
  const extendTask = (task: Task) => setExtendTarget(task);
  const confirmExtend = async (newEndDate: string | undefined) => {
    if (!extendTarget) return;
    const { synced } = await repo().extendRecurring(extendTarget.id, newEndDate);
    refresh();
    if (synced) notify(newEndDate ? `已延长到 ${newEndDate}` : "已延长为不限期");
    else notifyFailure("⚠️ 已保存到本地，未同步云端，请检查网络");
  };
  const cancelOccurrence = async (task: TaskDisplay) => { if (!task.occurrenceDate || !confirm("只取消这一次课程吗？")) return; await repo().setOccurrence(task.id, task.occurrenceDate, "cancelled"); refresh(); notify("本次课程已取消"); };
  const postponeOccurrence = async (task: TaskDisplay) => { if (!task.occurrenceDate) return; const date = prompt("延期到哪一天？请输入 YYYY-MM-DD", task.overrideDate ?? task.occurrenceDate); if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return; const note = prompt("调整备注（可选）", task.overrideNote ?? "") ?? ""; await repo().setOccurrence(task.id, task.occurrenceDate, "postponed", date, note); refresh(); notify(`已延期到 ${date}`); };
  const openDay = (date: string) => { setSelectedDate(date); setPage("today"); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const actions = { onStatusChange: changeStatus, onChecklistToggle: toggleChecklist, onCopy: copyTask, onEdit: (task: Task) => setForm({ open: true, task }), onDelete: deleteTask, onEnd: endTask, onExtend: extendTask, onOccurrenceCancel: cancelOccurrence, onOccurrencePostpone: postponeOccurrence, unsyncedTasks, unsyncedItems, onRetrySync: retryTaskSync, onRetryItemSync: retryItemSync };
  return <div className="min-h-screen bg-paper text-ink">
    <aside className="fixed inset-y-0 left-0 z-50 hidden w-56 flex-col bg-ink px-3 py-5 text-white lg:flex">
      <button onClick={() => setPage("today")} className="flex items-center gap-3 px-2 text-left">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-alert text-white"><CalendarCheck2 className="h-5 w-5" /></span>
        <span><span className="block text-lg font-bold">小步计划</span><span className="block text-[10px] text-white/50">家庭执行台</span></span>
      </button>
      <button onClick={() => setForm({ open: true })} className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-alert px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#cf5b40]"><Plus className="h-4 w-4" />新建任务</button>
      <nav className="mt-6 space-y-1">{navItems.map(({ page: value, label, icon: Icon }) => <button key={value} onClick={() => setPage(value)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${page === value ? "bg-white text-ink" : "text-white/65 hover:bg-white/10 hover:text-white"}`}><Icon className="h-4 w-4" />{label}{page === value && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-alert" />}</button>)}</nav>
      <div className="mt-auto border-t border-white/10 pt-4">
        {!cloudInitializing && <div className="flex items-center gap-2 px-2 text-xs text-white/55"><span className={`h-2 w-2 rounded-full ${cloudMode ? "bg-emerald-400" : "bg-white/30"}`} /><Cloud className="h-3.5 w-3.5" />{cloudMode ? "云端已连接" : "本地模式"}</div>}
      </div>
    </aside>
    <header className="pt-safe sticky top-0 z-40 border-b border-ink/10 bg-paper/95 backdrop-blur-xl lg:hidden"><div className="flex h-14 items-center justify-between px-4"><button onClick={() => setPage("today")} className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-white"><CalendarCheck2 className="h-4 w-4" /></span><span className="text-left text-base font-bold">小步计划</span></button><div className="flex items-center gap-2">{!cloudInitializing && <span title={cloudMode ? "云端已连接" : "本地模式"} className={`h-2 w-2 rounded-full ${cloudMode ? "bg-emerald-500" : "bg-stone-300"}`} />}<button aria-label="添加任务" onClick={() => setForm({ open: true })} className="flex h-9 w-9 items-center justify-center rounded-lg bg-alert text-white"><Plus className="h-4 w-4" /></button></div></div></header>
    <div className="app-content">
      {page === "today" && <DayPage date={selectedDate} refreshKey={refreshKey} onDateChange={setSelectedDate} onOpenMonth={() => setPage("month")} onAddTask={() => setForm({ open: true })} {...actions} />}
      {page === "month" && <MonthPage date={selectedDate} refreshKey={refreshKey} onDateChange={setSelectedDate} onOpenDay={openDay} onAddTask={(date) => { setSelectedDate(date); setForm({ open: true }); }} />}
      {page === "tasks" && <TaskManagementPage refreshKey={refreshKey} onRefresh={refresh} notify={notify} onEdit={(task) => setForm({ open: true, task })} onDelete={deleteTask} onEnd={endTask} onExtend={extendTask} onCopy={copyTask} />}
      {page === "stats" && <StatsPage onImported={refresh} cloudMode={cloudMode} onAuthChange={syncCloudSession} />}
      {page === "timetable" && <TimetablePage />}
    </div>
    <nav className="bottom-nav-safe fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-white/95 backdrop-blur lg:hidden"><div className="grid grid-cols-5 px-2 pt-1">{navItems.map(({ page: value, label, icon: Icon }) => <button key={value} onClick={() => setPage(value)} className={`relative flex min-w-0 flex-col items-center gap-0.5 px-1 py-1.5 text-[10px] ${page === value ? "text-primary" : "text-muted"}`}>{page === value && <span className="absolute -top-1 h-0.5 w-8 bg-alert" />}<Icon className="h-5 w-5" /><span className="truncate">{label}</span></button>)}</div></nav>
    {form.open && <TaskForm task={form.task} initialDate={selectedDate} onClose={() => setForm({ open: false })} onSave={saveTask} />}
    {extendTarget && <ExtendRecurringDialog task={extendTarget} onClose={() => setExtendTarget(null)} onConfirm={confirmExtend} />}
    {toast && <div className="toast-safe fixed bottom-24 left-1/2 z-[70] -translate-x-1/2 rounded-lg bg-ink px-5 py-2.5 text-sm text-white shadow-xl lg:bottom-8 lg:ml-[7.5rem]">{toast}</div>}
    {syncErrorToast && <div className="toast-safe-above fixed bottom-[8.5rem] left-1/2 z-[71] -translate-x-1/2 rounded-lg bg-sun px-5 py-2.5 text-sm font-medium text-ink shadow-xl lg:bottom-24 lg:ml-[7.5rem]">{syncErrorToast}</div>}
  </div>;
}
