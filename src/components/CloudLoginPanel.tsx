/**
 * CloudLoginPanel
 *
 * 放在打印/备份页，显示云端登录状态并提供
 * 邮箱+密码登录 / 退出 / 刷新功能。
 * 不影响任何任务数据，不修改 IndexedDB 逻辑。
 */
import { ChevronDown, Cloud, CloudOff, LogIn, LogOut, RefreshCw, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import {
  loadAuthState,
  signIn,
  signOut,
  type CloudAuthState,
} from "../lib/cloudAuth";
import { uploadLocalDataToCloud, type UploadResult } from "../lib/cloudUpload";
import { fetchCloudDataPreview, type CloudPreviewResult, checkCloudDiff, type CloudDiffResult } from "../lib/cloudRead";
import { downloadCloudDataToLocal, type DownloadResult } from "../lib/cloudDownload";
import { previewLocalOccurrenceCleanup, deleteLocalOccurrences } from "../lib/cloudCleanup";
import { supabaseConfigured } from "../lib/supabase";

export function CloudLoginPanel({ cloudMode }: { cloudMode?: boolean }) {
  const [auth, setAuth] = useState<CloudAuthState | null>(null);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [reading, setReading] = useState(false);
  const [previewResult, setPreviewResult] = useState<CloudPreviewResult | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [downloadResult, setDownloadResult] = useState<DownloadResult | null>(null);
  const [downloadError, setDownloadError] = useState("");
  const [checkingDiff, setCheckingDiff] = useState(false);
  const [diffResult, setDiffResult] = useState<CloudDiffResult | null>(null);
  const [diffError, setDiffError] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState("");
  const [reconcileError, setReconcileError] = useState("");

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const state = await loadAuthState();
      setAuth(state);
    } catch (err) {
      setError(err instanceof Error ? `云同步初始化失败：${err.message}` : "云同步初始化失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const err = await signIn(email, password);
    if (err) {
      setError(err);
      setLoading(false);
      return;
    }
    await refresh();
    setShowForm(false);
    setPassword("");
  };

  const handleSignOut = async () => {
    setLoading(true);
    await signOut();
    setUploadResult(null);
    setUploadError("");
    await refresh();
  };

  const handleUpload = async () => {
    if (!auth?.familyId) return;
    setUploading(true);
    setUploadResult(null);
    setUploadError("");
    try {
      const result = await uploadLocalDataToCloud(auth.familyId);
      setUploadResult(result);
    } catch (err) {
      setUploadError(err instanceof Error ? `上传失败：${err.message}` : "上传失败");
    } finally {
      setUploading(false);
    }
  };

  const handleReadCloud = async () => {
    if (!auth?.familyId) return;
    setReading(true);
    setPreviewResult(null);
    setPreviewError("");
    try {
      const result = await fetchCloudDataPreview(auth.familyId);
      setPreviewResult(result);
    } catch (err) {
      setPreviewError(err instanceof Error ? `读取云端数据失败：${err.message}` : "读取云端数据失败");
    } finally {
      setReading(false);
    }
  };

  const handleDownload = async () => {
    if (!auth?.familyId) return;
    setDownloading(true);
    setDownloadResult(null);
    setDownloadError("");
    try {
      const result = await downloadCloudDataToLocal(auth.familyId);
      setDownloadResult(result);
      await refresh();
    } catch (err) {
      setDownloadError(err instanceof Error ? `下载失败：${err.message}` : "下载失败");
    } finally {
      setDownloading(false);
    }
  };

  const handleCheckDiff = async () => {
    if (!auth?.familyId) return;
    setCheckingDiff(true);
    setDiffResult(null);
    setDiffError("");
    try {
      const result = await checkCloudDiff(auth.familyId);
      setDiffResult(result);
    } catch (err) {
      setDiffError(err instanceof Error ? `检查差异失败：${err.message}` : "检查差异失败");
    } finally {
      setCheckingDiff(false);
    }
  };

  const handleReconcile = async () => {
    if (!auth?.familyId) return;
    setReconciling(true);
    setReconcileResult("");
    setReconcileError("");
    try {
      const preview = await previewLocalOccurrenceCleanup(auth.familyId);
      const skippedNote = preview.skippedRecent > 0 ? `另有 ${preview.skippedRecent} 条最近 10 分钟内更新过（可能尚未同步），已跳过。` : "";
      if (preview.deletableIds.length === 0) {
        setReconcileResult(`本地无多余单次状态（本地 ${preview.localTotal} 条 / 云端 ${preview.cloudTotal} 条）。${skippedNote}`);
        return;
      }
      const ok = window.confirm(
        `将删除 ${preview.deletableIds.length} 条本地多余的单次状态（云端已不存在）。${skippedNote}只清理本地缓存，不改云端数据。确定继续？`
      );
      if (!ok) {
        setReconcileResult("已取消，未做任何改动。");
        return;
      }
      const deleted = await deleteLocalOccurrences(preview.deletableIds);
      setReconcileResult(`已删除 ${deleted} 条本地多余单次状态。${skippedNote}`);
    } catch (err) {
      setReconcileError(err instanceof Error ? `对账清理失败：${err.message}` : "对账清理失败");
    } finally {
      setReconciling(false);
    }
  };

  if (!supabaseConfigured) {
    return (
      <section className="mt-6 rounded-2xl border border-stone-100 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <CloudOff className="h-4 w-4 text-stone-400" />
          <h2 className="font-semibold">云同步</h2>
        </div>
        <p className="mt-2 text-sm text-stone-400">
          未配置 Supabase，当前使用本地模式。如需云同步，请在
          <code className="mx-1 rounded bg-stone-100 px-1 text-xs">.env.local</code>
          中配置 <code className="rounded bg-stone-100 px-1 text-xs">VITE_SUPABASE_URL</code> 和{" "}
          <code className="rounded bg-stone-100 px-1 text-xs">VITE_SUPABASE_ANON_KEY</code>。
        </p>
      </section>
    );
  }

  const isLoggedIn = Boolean(auth?.session);

  return (
    <section className="mt-6 rounded-2xl border border-stone-100 bg-white p-4 shadow-sm">
      {/* 标题行 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cloud className={`h-4 w-4 ${isLoggedIn ? "text-sage-600" : "text-stone-400"}`} />
          <h2 className="font-semibold">云同步</h2>
          {isLoggedIn && (
            <span className="rounded-full bg-sage-50 px-2 py-0.5 text-xs font-medium text-sage-700">
              已连接
            </span>
          )}
          {isLoggedIn && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cloudMode ? "bg-blue-50 text-blue-700" : "bg-stone-100 text-stone-500"}`}>
              {cloudMode ? "云端同步模式" : "本地模式"}
            </span>
          )}
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-stone-500 hover:bg-stone-50 disabled:opacity-40"
          title="刷新云端状态"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          刷新
        </button>
      </div>

      {/* 状态信息 */}
      <dl className="mt-3 space-y-1.5 text-sm">
        <Row label="状态" value={isLoggedIn ? "已登录" : "未登录"} />
        {error && !showForm && (
          <div className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-600">
            {error}
          </div>
        )}
        {isLoggedIn && (
          <>
            <Row label="账号" value={auth!.user?.email ?? "—"} />
            <Row label="家庭空间" value="家庭学习计划" />
            {auth!.profile?.display_name && (
              <Row label="显示名称" value={auth!.profile.display_name} />
            )}
          </>
        )}
      </dl>

      {/* 操作按钮：登录 / 退出登录 */}
      <div className="mt-4 flex gap-2">
        {!isLoggedIn && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
          >
            <LogIn className="h-4 w-4" />
            登录
          </button>
        )}
        {isLoggedIn && (
          <button
            onClick={handleSignOut}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm text-stone-600 hover:bg-stone-50 disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
            退出登录
          </button>
        )}
      </div>

      {/* 登录表单 */}
      {!isLoggedIn && showForm && (
        <form onSubmit={handleSignIn} className="mt-4 space-y-2">
          <input
            id="cloud-email"
            type="email"
            required
            placeholder="邮箱"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            autoComplete="email"
          />
          <input
            id="cloud-password"
            type="password"
            required
            placeholder="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            autoComplete="current-password"
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              <LogIn className="h-4 w-4" />
              {loading ? "登录中…" : "登录"}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setError(""); }}
              className="rounded-lg border px-3 py-2 text-sm text-stone-500"
            >
              取消
            </button>
          </div>
        </form>
      )}

      {/* 高级操作 / 调试（折叠） */}
      {isLoggedIn && auth?.familyId && (
        <div className="mt-4 border-t border-stone-100 pt-3">
          <button
            onClick={() => setDebugOpen(!debugOpen)}
            className="flex w-full items-center justify-between rounded-lg px-1 py-1.5 text-xs font-medium text-stone-400 hover:text-stone-600"
          >
            高级操作 / 调试
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${debugOpen ? "rotate-180" : ""}`} />
          </button>

          {debugOpen && (
            <div className="mt-3 space-y-4 pl-1">
              {/* Family ID */}
              <div className="space-y-1 text-sm">
                <Row
                  label="Family ID"
                  value={
                    <code className="rounded bg-stone-100 px-1 text-[11px] break-all text-stone-500">{auth!.familyId}</code>
                  }
                />
              </div>

              {/* 上传 */}
              <div className="space-y-2">
                <button
                  onClick={handleUpload}
                  disabled={uploading || loading}
                  className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  <Upload className="h-4 w-4" />
                  {uploading ? "上传中…" : "上传本地数据到云端"}
                </button>
                {uploadResult && (
                  <div className="rounded-lg bg-green-50 p-3 text-xs text-green-800 space-y-1">
                    <p className="font-semibold text-sm mb-1 flex items-center gap-1">
                      <span className="text-green-600">✓</span> 上传完成
                    </p>
                    <p>任务：{uploadResult.tasks} 条</p>
                    <p>清单小项：{uploadResult.checklistItems} 条</p>
                    <p>单次状态：{uploadResult.occurrenceStatuses} 条</p>
                    <p>假期阶段：{uploadResult.planPeriods} 条</p>
                    <p>操作日志：本阶段暂不上传</p>
                    {(uploadResult.skippedTasks > 0 || uploadResult.skippedOccurrenceStatuses > 0 || uploadResult.skippedDirtyOccurrences > 0 || uploadResult.skippedPlanPeriods > 0) && (
                      <div className="mt-2 pt-2 border-t border-green-200/50 text-amber-600">
                        {uploadResult.skippedTasks > 0 && <p>跳过无效日期任务：{uploadResult.skippedTasks} 条</p>}
                        {uploadResult.skippedOccurrenceStatuses > 0 && <p>跳过无效单次状态：{uploadResult.skippedOccurrenceStatuses} 条</p>}
                        {uploadResult.skippedDirtyOccurrences > 0 && <p>跳过违规单次状态（非 occurrence 类 / 已删任务名下）：{uploadResult.skippedDirtyOccurrences} 条</p>}
                        {uploadResult.skippedPlanPeriods > 0 && <p>跳过无效假期阶段：{uploadResult.skippedPlanPeriods} 条</p>}
                      </div>
                    )}
                  </div>
                )}
                {uploadError && <ErrorBox message={uploadError} />}
              </div>

              {/* 下载 + 读取预览 */}
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleDownload}
                    disabled={reading || downloading || loading}
                    className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition-colors"
                  >
                    <RefreshCw className={`h-4 w-4 ${downloading ? "animate-spin" : ""}`} />
                    {downloading ? "下载中…" : "从云端下载数据到本地"}
                  </button>
                  <button
                    onClick={handleReadCloud}
                    disabled={reading || downloading || loading}
                    className="flex items-center gap-1.5 rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50 transition-colors"
                  >
                    <Cloud className="h-4 w-4" />
                    {reading ? "读取中…" : "读取云端数据预览"}
                  </button>
                </div>
                {downloadResult && (
                  <div className="rounded-lg bg-green-50 p-3 text-xs text-green-800 space-y-1">
                    <p className="font-semibold text-sm mb-1 flex items-center gap-1">
                      <span className="text-green-600">✓</span> 下载完成
                    </p>
                    <p>任务：{downloadResult.tasks} 条</p>
                    <p>清单小项：{downloadResult.checklistItems} 条</p>
                    <p>单次状态：{downloadResult.occurrenceStatuses} 条</p>
                    <p>假期阶段：{downloadResult.planPeriods} 条</p>
                  </div>
                )}
                {downloadError && <ErrorBox message={downloadError} />}
                {previewResult && (
                  <div className="space-y-4 rounded-lg bg-stone-50 p-4 text-sm text-stone-700 border border-stone-200">
                    <div>
                      <p className="font-semibold mb-2">云端读取预览</p>
                      <ul className="space-y-1 list-disc list-inside text-stone-600">
                        <li>任务总数：{previewResult.cloudCounts.tasks}</li>
                        <li>有效任务：{previewResult.cloudCounts.activeTasks}</li>
                        <li>已删除任务：{previewResult.cloudCounts.deletedTasks}</li>
                        <li>清单小项：{previewResult.cloudCounts.checklistItems}</li>
                        <li>单次状态：{previewResult.cloudCounts.occurrenceStatuses}</li>
                        <li>假期阶段：{previewResult.cloudCounts.planPeriods}</li>
                      </ul>
                    </div>
                    <div>
                      <p className="font-semibold mb-2">本地 / 云端对比</p>
                      <ul className="space-y-1 list-disc list-inside text-stone-600">
                        <li>任务：本地 {previewResult.localCounts.tasks} / 云端 {previewResult.cloudCounts.tasks}</li>
                        <li>清单小项：本地 {previewResult.localCounts.checklistItems} / 云端 {previewResult.cloudCounts.checklistItems}</li>
                        <li>单次状态：本地 {previewResult.localCounts.occurrenceStatuses} / 云端 {previewResult.cloudCounts.occurrenceStatuses}</li>
                        <li>假期阶段：本地 {previewResult.localCounts.planPeriods} / 云端 {previewResult.cloudCounts.planPeriods}</li>
                      </ul>
                    </div>
                    {previewResult.recentTasks.length > 0 && (
                      <div>
                        <p className="font-semibold mb-2">最近 {previewResult.recentTasks.length} 条云端任务</p>
                        <ol className="space-y-1.5 list-decimal list-inside text-xs text-stone-600">
                          {previewResult.recentTasks.map(t => (
                            <li key={t.id} className="truncate">
                              {t.title || "无标题"} / {t.mainCategory} / {t.date || t.startDate || t.timeType}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </div>
                )}
                {previewError && <ErrorBox message={previewError} />}
              </div>

              {/* 差异检查 */}
              <div className="space-y-2">
                <button
                  onClick={handleCheckDiff}
                  disabled={reading || downloading || checkingDiff || loading}
                  className="flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-4 py-2 text-sm font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50 transition-colors"
                >
                  {checkingDiff ? "检查中…" : "检查本地/云端差异"}
                </button>
                {diffResult && (
                  <div className="rounded-lg bg-purple-50 p-4 text-sm text-purple-800 space-y-3">
                    <p className="font-semibold">差异检查完成</p>
                    <div>
                      <p className="font-medium mb-1">本地多出的任务：{diffResult.localOnlyTasks.length} 条</p>
                      {diffResult.localOnlyTasks.length > 0 && (
                        <ul className="space-y-1 text-xs list-disc list-inside bg-white/50 p-2 rounded max-h-40 overflow-y-auto">
                          {diffResult.localOnlyTasks.slice(0, 10).map(t => (
                            <li key={t.id} className="truncate">
                              {t.title || "无标题"} ({t.mainCategory}) [{t.date || t.startDate || t.timeType}]
                              {t.deletedAt ? ` [已删除: ${t.deletedAt}]` : ""}
                              <span className="text-purple-400 ml-1">id: {t.id}</span>
                            </li>
                          ))}
                          {diffResult.localOnlyTasks.length > 10 && (
                            <li className="text-purple-600 font-medium">还有 {diffResult.localOnlyTasks.length - 10} 条...</li>
                          )}
                        </ul>
                      )}
                    </div>
                    <div>
                      <p className="font-medium mb-1">云端多出的任务：{diffResult.cloudOnlyTasks.length} 条</p>
                      {diffResult.cloudOnlyTasks.length > 0 && (
                        <ul className="space-y-1 text-xs list-disc list-inside bg-white/50 p-2 rounded max-h-40 overflow-y-auto">
                          {diffResult.cloudOnlyTasks.slice(0, 10).map(t => (
                            <li key={t.id} className="truncate">
                              {t.title || "无标题"} ({t.mainCategory}) [{t.date || t.startDate || t.timeType}]
                              {t.deletedAt ? ` [已删除: ${t.deletedAt}]` : ""}
                              <span className="text-purple-400 ml-1">id: {t.id}</span>
                            </li>
                          ))}
                          {diffResult.cloudOnlyTasks.length > 10 && (
                            <li className="text-purple-600 font-medium">还有 {diffResult.cloudOnlyTasks.length - 10} 条...</li>
                          )}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
                {diffError && <ErrorBox message={diffError} />}
              </div>

              {/* 对账清理本地缓存 */}
              <div className="space-y-2">
                <button
                  onClick={handleReconcile}
                  disabled={reading || downloading || checkingDiff || reconciling || loading}
                  className="flex items-center gap-1.5 rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className={`h-4 w-4 ${reconciling ? "animate-spin" : ""}`} />
                  {reconciling ? "对账中…" : "对账清理本地缓存"}
                </button>
                <p className="text-xs text-stone-400">
                  按云端单次状态对账，删除本地多出的残留行（只动本地，不改云端；最近 10 分钟内更新的行自动跳过防误删）。
                </p>
                {reconcileResult && (
                  <div className="rounded-lg bg-green-50 p-3 text-xs text-green-800">{reconcileResult}</div>
                )}
                {reconcileError && <ErrorBox message={reconcileError} />}
              </div>
            </div>
          )}
        </div>
      )}

      <p className="mt-4 text-xs text-stone-400">
        {cloudMode
          ? "云端同步模式：新增、编辑、删除、完成状态会自动写入 Supabase。另一台设备刷新后可看到最新数据。"
          : "未登录时使用本地模式，任务数据保存在本地 IndexedDB，不影响正常使用。登录后将启用云端同步。"}
      </p>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-24 shrink-0 text-stone-400">{label}</dt>
      <dd className="font-medium text-stone-700">{value}</dd>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 flex items-start gap-2">
      <span className="font-bold">!</span>
      <span>{message}</span>
    </div>
  );
}
