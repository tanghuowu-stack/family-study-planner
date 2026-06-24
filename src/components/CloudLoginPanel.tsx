/**
 * CloudLoginPanel
 *
 * 放在打印/备份页，显示云端登录状态并提供
 * 邮箱+密码登录 / 退出 / 刷新功能。
 * 不影响任何任务数据，不修改 IndexedDB 逻辑。
 */
import { Cloud, CloudOff, LogIn, LogOut, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import {
  loadAuthState,
  signIn,
  signOut,
  type CloudAuthState,
} from "../lib/cloudAuth";
import { supabaseConfigured } from "../lib/supabase";

export function CloudLoginPanel() {
  const [auth, setAuth] = useState<CloudAuthState | null>(null);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);

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
    await refresh();
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
