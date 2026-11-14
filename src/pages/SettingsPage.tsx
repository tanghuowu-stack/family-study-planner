import { ChevronDown, Download, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { CloudLoginPanel } from "../components/CloudLoginPanel";
import { MemoHistorySection } from "../components/MemoHistorySection";
import { getCalendarDisplaySettings, saveCalendarDisplaySettings, type CalendarDisplaySettings } from "../data/calendarAnnotations";
import type { MemoHistoryEntry } from "../data/appSettingsRepository";
import { taskRepository } from "../data/taskRepository";
import { getRepository } from "../data/repositoryProvider";
import { canUndoActivityLog, undoActivityLog } from "../data/activityUndo";
import type { ActivityLog, Course, PlanPeriod } from "../types/task";
import { todayKey, toLocalDateKey } from "../utils/date";
import { CourseManager, PlanPeriodManager } from "./TaskManagementPage";

/**
 * 设置（2026-11 界面审查第 6 批）：原先分散在"统计与设置 → 更多设置"和"任务管理 → 课程与假期资料"里的
 * 低频维护项集中到这里。每项一行，点开再看详情；内容和行为与原位置一致，只是换了入口。
 */
interface Props {
  refreshKey: number;
  onImported: () => void;
  notify: (text: string) => void;
  cloudMode?: boolean;
  onAuthChange?: () => void | Promise<void>;
  memoHistory: MemoHistoryEntry[];
  memoBusy: boolean;
  onRestoreMemo: (id: string) => Promise<void>;
  onDeleteMemo: (id: string) => Promise<void>;
}

export function SettingsPage({ refreshKey, onImported, notify, cloudMode, onAuthChange, memoHistory, memoBusy, onRestoreMemo, onDeleteMemo }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [deviceLabel, setDeviceLabel] = useState(() => localStorage.getItem("familyPlanner.deviceLabel") ?? "");
  const [calendarSettings, setCalendarSettings] = useState(getCalendarDisplaySettings);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [periods, setPeriods] = useState<PlanPeriod[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const loadLogs = () => getRepository().listActivityLogs(50).then(setLogs);
  const loadSetup = () => Promise.all([taskRepository.listPlanPeriods(), getRepository().listCourses()]).then(([stages, courseList]) => { setPeriods(stages); setCourses(courseList); });
  useEffect(() => { void loadLogs(); void loadSetup(); }, [refreshKey]);

  const holidays = periods.filter((period) => period.type === "holiday");
  const currentHoliday = holidays.find((period) => period.isActive && todayKey() >= period.startDate && todayKey() <= period.endDate);
  const setupChanged = () => { void loadSetup(); onImported(); };

  const handleUndo = async (log: ActivityLog) => {
    if (!confirm(`撤回"${actionLabel(log.actionType)}${log.entityTitle ? "：" + log.entityTitle : ""}"这条操作吗？`)) return;
    setUndoingId(log.id);
    try {
      await undoActivityLog(log);
      setMessage("已撤回");
      onImported();
      void loadLogs();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "撤回失败");
    } finally {
      setUndoingId(null);
    }
  };
  const updateCalendarSetting = (key: keyof CalendarDisplaySettings, value: boolean) => { const next = { ...calendarSettings, [key]: value }; setCalendarSettings(next); saveCalendarDisplaySettings(next); setMessage("日历显示设置已保存"); };
  const exportData = async () => { const backup = await getRepository().exportBackup(); const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `小步计划备份-${toLocalDateKey(backup.exportedAt)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 500); setMessage("备份已导出"); void loadLogs(); };
  // 导入走当前数据源（getRepository）：云端模式下导入后会整体上传，否则下次同步就被云端覆盖回去
  const importData = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    const warning = cloudMode
      ? "导入会用备份里的任务替换本机数据，并上传到云端（Mac 和 iPad 都会变）。云端有、备份里没有的任务会保留。确定继续吗？"
      : "导入会用备份里的数据替换本机当前数据，确定继续吗？";
    if (!file || !confirm(warning)) return;
    try {
      const result = await getRepository().importBackup(JSON.parse(await file.text()));
      setMessage(`导入成功：${result.tasks} 个任务${result.droppedOccurrences ? `（丢弃了 ${result.droppedOccurrences} 条不符合规则的单日记录）` : ""}${cloudMode ? "，已上传云端" : ""}`);
      onImported(); void loadLogs(); void loadSetup();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "导入失败"); onImported(); }
  };

  return <main className="mx-auto w-full max-w-3xl px-4 pb-content pt-4 sm:px-7 sm:pt-6 lg:px-10">
    <header className="page-header"><h1 className="page-title">设置</h1></header>
    {message && <p role="status" className="mb-4 rounded-lg bg-mint px-4 py-3 text-sm text-ink">{message}</p>}

    <div className="surface divide-y divide-ink/[0.07] overflow-visible">
      <SettingRow title="云同步与账号" summary={cloudMode ? "云端已连接，Mac 和 iPad 自动同步" : "本地模式，未连接云端"}>
        <CloudLoginPanel cloudMode={cloudMode} onAuthChange={onAuthChange} />
      </SettingRow>
      <SettingRow title="假期" summary={`当前：${currentHoliday?.name ?? "平时"}；只需维护假期，其他日期自动视为平时`}>
        <PlanPeriodManager periods={holidays} currentHoliday={currentHoliday} onChanged={setupChanged} notify={notify} embedded />
      </SettingRow>
      <SettingRow title="课程" summary={`进行中 ${courses.filter((course) => course.status === "active").length} 门；新建任务时可以从课程带出分类和时间`}>
        <CourseManager courses={courses} onChanged={setupChanged} notify={notify} embedded />
      </SettingRow>
      <SettingRow title="历史备忘" summary={`${memoHistory.length} 条，最多保留 50 条`}>
        <MemoHistorySection entries={memoHistory} busy={memoBusy} onRestore={onRestoreMemo} onDelete={onDeleteMemo} />
      </SettingRow>
      <SettingRow title="数据备份" summary="导出或导入全部任务">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-ink/10 bg-white p-4"><Download className="h-5 w-5 text-primary" /><h3 className="mt-2 text-base font-semibold">导出备份</h3><p className="mt-1 text-sm text-muted">保存全部任务、假期、课程、软删除记录和操作日志。</p><button onClick={exportData} className="mt-3 min-h-11 w-full rounded-lg bg-primary px-4 text-sm font-semibold text-white">导出备份</button></div>
          <div className="rounded-lg border border-ink/10 bg-white p-4"><Upload className="h-5 w-5 text-amber-700" /><h3 className="mt-2 text-base font-semibold">导入备份</h3><p className="mt-1 text-sm text-muted">从 JSON 文件恢复任务，会覆盖当前数据。</p><input ref={fileRef} type="file" accept=".json,application/json" onChange={importData} className="hidden" /><button onClick={() => fileRef.current?.click()} className="mt-3 min-h-11 w-full rounded-lg border border-ink/15 px-4 text-sm font-semibold">选择备份文件</button></div>
        </div>
      </SettingRow>
      <SettingRow title="日历提示" summary="节气、节日、休/班标记">
        <div className="flex flex-wrap items-center gap-2"><SettingCheck label="显示节气" checked={calendarSettings.showSolarTerms} onChange={(value) => updateCalendarSetting("showSolarTerms", value)} /><SettingCheck label="显示节日" checked={calendarSettings.showFestivals} onChange={(value) => updateCalendarSetting("showFestivals", value)} /><SettingCheck label="显示休/班标记" checked={calendarSettings.showHolidayStatus} onChange={(value) => updateCalendarSetting("showHolidayStatus", value)} /></div>
      </SettingRow>
      <SettingRow title="本机名称" summary={deviceLabel || "未设置（操作记录里用来区分是哪台设备改的）"}>
        <div className="flex flex-wrap items-center gap-2"><input value={deviceLabel} onChange={(event) => setDeviceLabel(event.target.value)} placeholder="例如：书房 MacBook" className="min-h-11 w-56 rounded-lg border px-3 text-sm" /><button onClick={() => { localStorage.setItem("familyPlanner.deviceLabel", deviceLabel.trim() || "本地设备"); setMessage("本机名称已保存"); }} className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white">保存</button></div>
      </SettingRow>
      <SettingRow title="最近操作记录" summary={`最近 ${logs.length} 条，可撤回部分操作`}>
        <div className="flex justify-end"><button onClick={() => void loadLogs()} className="text-[13px] font-semibold text-primary">刷新</button></div>
        <div className="mt-1 divide-y">{logs.length ? logs.map((log) => <details key={log.id} className="py-2 text-sm"><summary className="flex cursor-pointer list-none items-center gap-2"><span className="min-w-0 flex-1"><span className="font-medium">{actionLabel(log.actionType)}</span><span className="ml-2 text-muted">{log.entityTitle ?? log.entityId ?? "系统数据"}</span><span className="ml-2 text-[13px] text-stone-400">{new Date(log.createdAt).toLocaleString("zh-CN")} · {log.deviceLabel} · {log.browser}</span></span>{canUndoActivityLog(log) && <button onClick={(event) => { event.preventDefault(); event.stopPropagation(); void handleUndo(log); }} disabled={undoingId === log.id} className="shrink-0 rounded-lg border border-stone-200 px-2 py-1 text-[13px] font-medium text-stone-600 hover:bg-mint/40 disabled:opacity-50">{undoingId === log.id ? "撤回中…" : "撤回"}</button>}</summary><pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-stone-50 p-3 text-[13px] text-stone-500">{JSON.stringify({ before: log.beforeSnapshot, after: log.afterSnapshot }, null, 2)}</pre></details>) : <p className="py-5 text-sm text-stone-400">暂无操作记录</p>}</div>
      </SettingRow>
    </div>
  </main>;
}

/** 设置项：一行标题 + 一句说明，点开展开内容 */
function SettingRow({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <section>
    <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left hover:bg-stone-50/70">
      <span className="min-w-0 flex-1"><span className="block text-base font-semibold text-ink">{title}</span><span className="block truncate text-[13px] text-muted">{summary}</span></span>
      <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition ${open ? "rotate-180" : ""}`} />
    </button>
    {open && <div className="px-4 pb-4">{children}</div>}
  </section>;
}

function SettingCheck({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="flex min-h-11 items-center gap-2 rounded-lg bg-stone-50 px-3 text-sm text-stone-600"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 rounded" />{label}</label>; }
const actionLabel = (action: ActivityLog["actionType"]) => ({ create: "新建任务", edit: "编辑任务", complete: "完成任务", uncomplete: "取消完成", delete: "删除任务", batchDelete: "批量删除", restore: "恢复任务", cancelOccurrence: "这一次跳过", postponeOccurrence: "这一次改期", createHoliday: "新增假期", editHoliday: "修改假期", deleteHoliday: "删除假期", createCourse: "新增课程", editCourse: "修改课程", deleteCourse: "删除课程", recordReading: "旧版记录", undoReading: "撤销旧版记录", import: "导入备份", export: "导出备份" }[action]);
