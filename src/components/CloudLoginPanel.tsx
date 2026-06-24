/**
 * CloudLoginPanel
 *
 * 放在打印/备份页，显示云端登录状态并提供
 * 邮箱+密码登录 / 退出 / 刷新功能。
 * 不影响任何任务数据，不修改 IndexedDB 逻辑。
 */
import { Cloud, CloudOff, LogIn, LogOut, RefreshCw, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import {
  loadAuthState,
  signIn,
  signOut,
  type CloudAuthState,
} from "../lib/cloudAuth";
import { uploadLocalDataToCloud, type UploadResult } from "../lib/cloudUpload";
import { fetchCloudDataPreview, type CloudPreviewResult } from "../lib/cloudRead";
import { supabaseConfigured } from "../lib/supabase";

export function CloudLoginPanel() {
  const [auth, setAuth] = useState<CloudAuthState | null>(null);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [reading, setReading] = useState(false);
  const [previewResult, setPreviewResult] = useState<CloudPreviewResult | null>(null);
  const [previewError, setPreviewError] = useState("");

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
            <details className="mt-3 group">
              <summary className="cursor-pointer text-xs font-medium text-stone-400 hover:text-stone-600 list-none flex items-center gap-1">
                高级信息 / 调试
                <span className="inline-block transition-transform group-open:rotate-90">▸</span>
              </summary>
              <div className="mt-2 pl-2 space-y-1.5 border-l-2 border-stone-100">
                <Row
                  label="Family ID"
                  value={
                    auth!.familyId ? (
                      <code className="rounded bg-stone-100 px-1 text-[11px] break-all text-stone-500">{auth!.familyId}</code>
                    ) : (
                      "初始化中…"
                    )
                  }
                />
              </div>
            </details>
          </>
        )}
      </dl>

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
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
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

      {/* 上传按钮区域 */}
      <div className="mt-6 border-t border-stone-100 pt-4 space-y-2">
        <div className="flex flex-col gap-2">
          <button
            onClick={handleUpload}
            disabled={!isLoggedIn || !auth?.familyId || uploading || loading}
            className="flex w-fit items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-stone-100 disabled:text-stone-400 disabled:opacity-100 transition-colors"
          >
            <Upload className="h-4 w-4" />
            {uploading ? "上传中…" : "上传本地数据到云端"}
          </button>
          {(!isLoggedIn || !auth?.familyId) && (
            <p className="text-xs text-stone-400">
              请先登录云同步账号
            </p>
          )}
        </div>
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
            {(uploadResult.skippedTasks > 0 || uploadResult.skippedOccurrenceStatuses > 0 || uploadResult.skippedPlanPeriods > 0) && (
              <div className="mt-2 pt-2 border-t border-green-200/50 text-amber-600">
                {uploadResult.skippedTasks > 0 && <p>跳过无效日期任务：{uploadResult.skippedTasks} 条</p>}
                {uploadResult.skippedOccurrenceStatuses > 0 && <p>跳过无效单次状态：{uploadResult.skippedOccurrenceStatuses} 条</p>}
                {uploadResult.skippedPlanPeriods > 0 && <p>跳过无效假期阶段：{uploadResult.skippedPlanPeriods} 条</p>}
              </div>
            )}
          </div>
        )}
        {uploadError && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 flex items-start gap-2">
            <span className="text-red-500 font-bold">!</span>
            <span>{uploadError}</span>
          </div>
        )}
      </div>

      {/* 读取云端数据预览区域 */}
      {isLoggedIn && auth?.familyId && (
        <div className="mt-6 border-t border-stone-100 pt-4 space-y-2">
          <div className="flex flex-col gap-2">
            <button
              onClick={handleReadCloud}
              disabled={reading || loading}
              className="flex w-fit items-center gap-1.5 rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:bg-stone-50 disabled:text-stone-400 transition-colors"
            >
              <Cloud className="h-4 w-4" />
              {reading ? "读取中…" : "读取云端数据预览"}
            </button>
          </div>
          
          {previewResult && (
            <div className="mt-3 space-y-4 rounded-lg bg-stone-50 p-4 text-sm text-stone-700 border border-stone-200">
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

          {previewError && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 flex items-start gap-2">
              <span className="text-red-500 font-bold">!</span>
              <span>{previewError}</span>
            </div>
          )}
        </div>
      )}

      {/* 操作按钮 */}
      <div className="mt-4 flex gap-2">
        {!isLoggedIn && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white"
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

      <p className="mt-4 text-xs text-stone-400">
        第一阶段：云端仅用于验证连接。任务数据仍保存在本地 IndexedDB，不影响正常使用。
      </p>
    </section>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-24 shrink-0 text-stone-400">{label}</dt>
      <dd className="font-medium text-stone-700">{value}</dd>
    </div>
  );
}
