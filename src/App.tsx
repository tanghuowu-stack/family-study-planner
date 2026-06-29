import { CalendarCheck2, CalendarDays, Cloud, ClipboardList, Database, Home, Plus, Rows3 } from "lucide-react";
import { TimerProvider } from "./context/TimerContext";
import { addDays } from "date-fns";
import { useEffect, useState } from "react";
import { TaskForm } from "./components/TaskForm";
import { getRepository, isCloudMode, setCloudMode } from "./data/repositoryProvider";
import { cloudRepository, setCloudSyncErrorHandler } from "./data/cloudRepository";
import { loadAuthState } from "./lib/cloudAuth";
import { startRealtimeSync, stopRealtimeSync } from "./lib/realtimeSync";
import { BackupPage } from "./pages/BackupPage";
import { DayPage } from "./pages/DayPage";
import { MonthPage } from "./pages/MonthPage";
import { TaskManagementPage } from "./pages/TaskManagementPage";
import { WeekPage } from "./pages/WeekPage";
import type { Task, TaskDisplay, TaskDraft, TaskStatus } from "./types/task";
import { fromDateKey, todayKey, toDateKey } from "./utils/date";

type Page = "today" | "week" | "month" | "tasks" | "backup";
const navItems = [
  { page: "today" as const, label: "今日", icon: Home }, { page: "week" as const, label: "周计划", icon: Rows3 },
  { page: "month" as const, label: "月计划", icon: CalendarDays }, { page: "tasks" as const, label: "任务管理", icon: ClipboardList },
  { page: "backup" as const, label: "打印/备份", icon: Database },
];

export default function App() {
  const [page, setPage] = useState<Page>("today");
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [form, setForm] = useState<{ open: boolean; task?: Task }>({ open: false });
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState("");
  const [cloudMode, setCloudModeState] = useState(false);
  const [cloudInitializing, setCloudInitializing] = useState(true);

  const refresh = () => setRefreshKey((value) => value + 1);
  const notify = (text: string) => { setToast(text); setTimeout(() => setToast(""), 2600); };

  // ── 初始化云同步 ────────────────────────────────────────────────────────────
  useEffect(() => {
    async function initCloud() {
      try {
        const state = await loadAuthState();
        if (state.familyId) {
          setCloudMode(state.familyId);
          setCloudModeState(true);
          setCloudSyncErrorHandler((msg) => notify(`⚠️ ${msg}，请检查网络`));
          // 首次加载：从云端拉取最新数据到本地缓存
          await cloudRepository.refreshFromCloud().catch((e) =>
            console.warn("[App] 首次云端同步失败，降级到本地模式", e)
          );
          refresh();
          // 进入云端模式后建立 Realtime 订阅，数据变更自动拉取并重渲染
          await startRealtimeSync(refresh);
        }
      } catch (e) {
        console.warn("[App] 云同步初始化失败，使用本地模式", e);
      } finally {
        setCloudInitializing(false);
      }
    }
    void initCloud();
    return () => stopRealtimeSync();
  }, []);

  const repo = () => getRepository();

  const saveTask = async (draft: TaskDraft, force = false) => {
    const conflicts = force ? [] : await repo().findTimeConflicts(draft, form.task?.id);
    if (conflicts.length) throw new Error(`TIME_CONFLICT:${conflicts[0].title}`);
    if (form.task) await repo().update(form.task.id, draft); else await repo().create(draft);
    refresh(); notify(form.task ? "任务已更新" : "任务已添加");
  };
  const changeStatus = async (task: TaskDisplay, status: TaskStatus) => {
    try { await repo().setDisplayStatus(task, status); refresh(); notify(status === "done" ? "已完成" : "状态已更新"); }
    catch { refresh(); notify("⚠️ 保存失败，请检查网络"); }
  };
  const toggleChecklist = async (task: TaskDisplay, itemId: string) => {
    try { await repo().toggleChecklistItem(task.id, itemId, task.occurrenceDate); refresh(); }
    catch { refresh(); notify("⚠️ 保存失败，请检查网络"); }
  };
  const copyTask = async (task: Task) => { const taskDate = task.date ?? task.startDate ?? selectedDate; const defaultDate = toDateKey(addDays(fromDateKey(taskDate), 1)); const date = prompt("复制到哪一天？请输入 YYYY-MM-DD", defaultDate); if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return; await repo().copyToDate(task.id, date); refresh(); notify(`已复制到 ${date}`); };
  const deleteTask = async (task: Task) => { if (!confirm(`确定删除"${task.title}"吗？${task.timeType === "recurring" ? "这会删除整个重复任务。" : ""}`)) return; await repo().remove(task.id); refresh(); notify("任务已删除"); };
  const cancelOccurrence = async (task: TaskDisplay) => { if (!task.occurrenceDate || !confirm("只取消这一次课程吗？")) return; await repo().setOccurrence(task.id, task.occurrenceDate, "cancelled"); refresh(); notify("本次课程已取消"); };
  const postponeOccurrence = async (task: TaskDisplay) => { if (!task.occurrenceDate) return; const date = prompt("延期到哪一天？请输入 YYYY-MM-DD", task.overrideDate ?? task.occurrenceDate); if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return; const note = prompt("调整备注（可选）", task.overrideNote ?? "") ?? ""; await repo().setOccurrence(task.id, task.occurrenceDate, "postponed", date, note); refresh(); notify(`已延期到 ${date}`); };
  const saveActualTime = async (taskId: string, itemId: string | null, minutes: number) => { await repo().saveActualMinutes(taskId, itemId, minutes); refresh(); };
  const saveEstimatedMinutes = async (taskId: string, itemId: string | null, minutes: number | undefined) => {
    if (itemId) {
      const task = (await repo().listAll()).find(t => t.id === taskId);
      if (!task) return;
      const items = (task.checklistItems ?? []).map(i => i.id === itemId ? { ...i, estimatedMinutes: minutes } : i);
      await repo().update(taskId, { checklistItems: items });
    } else {
      await repo().update(taskId, { estimatedMinutes: minutes });
    }
    refresh();
  };
  const openDay = (date: string) => { setSelectedDate(date); setPage("today"); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const actions = { onStatusChange: changeStatus, onChecklistToggle: toggleChecklist, onCopy: copyTask, onEdit: (task: Task) => setForm({ open: true, task }), onDelete: deleteTask, onOccurrenceCancel: cancelOccurrence, onOccurrencePostpone: postponeOccurrence, onSaveActualTime: saveActualTime, onSaveEstimatedMinutes: saveEstimatedMinutes };
  return <TimerProvider><div className="min-h-screen bg-paper text-ink"><header className="screen-only sticky top-0 z-40 border-b border-primary/30 bg-primary backdrop-blur-xl"><div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6"><button onClick={() => setPage("today")} className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/20 text-white"><CalendarCheck2 className="h-5 w-5" /></span><span className="text-left"><span className="block text-lg font-bold text-white">小步计划</span><span className="hidden text-[10px] tracking-wider text-white/60 sm:block">家庭学习生活规划</span></span></button><nav className="hidden items-center gap-1 lg:flex">{navItems.map(({ page: value, label, icon: Icon }) => <button key={value} onClick={() => setPage(value)} className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium ${page === value ? "bg-white/20 text-white shadow-sm" : "text-white/80 hover:bg-white/10"}`}><Icon className="h-4 w-4" />{label}</button>)}</nav><div className="flex items-center gap-2">{!cloudInitializing && (<span className={`hidden items-center gap-1 text-xs sm:flex ${cloudMode ? "text-white/90" : "text-white/60"}`}><Cloud className="h-3.5 w-3.5" />{cloudMode ? "云端同步" : "本地模式"}</span>)}<button onClick={() => setForm({ open: true })} className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2.5 text-sm font-semibold text-primary"><Plus className="h-4 w-4" /><span className="hidden sm:inline">添加任务</span></button></div></div></header>
    {page === "today" && <DayPage date={selectedDate} refreshKey={refreshKey} onDateChange={setSelectedDate} onOpenWeek={() => setPage("week")} onOpenMonth={() => setPage("month")} {...actions} />}
    {page === "week" && <WeekPage date={selectedDate} refreshKey={refreshKey} onDateChange={setSelectedDate} onRefresh={refresh} notify={notify} {...actions} />}
    {page === "month" && <MonthPage date={selectedDate} refreshKey={refreshKey} onDateChange={setSelectedDate} onOpenDay={openDay} onAddTask={(date) => { setSelectedDate(date); setForm({ open: true }); }} />}
    {page === "tasks" && <TaskManagementPage refreshKey={refreshKey} onRefresh={refresh} notify={notify} onEdit={(task) => setForm({ open: true, task })} onDelete={deleteTask} onCopy={copyTask} />}
    {page === "backup" && <BackupPage onImported={refresh} cloudMode={cloudMode} />}
    <nav className="screen-only fixed inset-x-2 bottom-2 z-40 grid grid-cols-5 rounded-2xl border border-primary/20 bg-lavender/95 p-1 shadow-card backdrop-blur lg:hidden">{navItems.map(({ page: value, label, icon: Icon }) => <button key={value} onClick={() => setPage(value)} className={`flex min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] ${page === value ? "bg-primary/10 text-primary" : "text-muted"}`}><Icon className="h-5 w-5" /><span className="truncate">{label}</span></button>)}</nav>
    {form.open && <TaskForm task={form.task} initialDate={selectedDate} onClose={() => setForm({ open: false })} onSave={saveTask} />}
    {toast && <div className="fixed bottom-24 left-1/2 z-[70] -translate-x-1/2 rounded-full bg-primary px-5 py-2.5 text-sm text-white shadow-xl lg:bottom-8">{toast}</div>}
  </div></TimerProvider>;
}
