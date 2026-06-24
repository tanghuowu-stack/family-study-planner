/**
 * cloudAuth.ts
 *
 * 封装 Supabase 登录、登出、session 查询、family/profile 初始化。
 * 所有方法在 Supabase 未配置时返回适当的 null/false，不抛出异常。
 */
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export interface CloudProfile {
  id: string;
  family_id: string;
  display_name: string | null;
  role: string;
}

export interface CloudAuthState {
  session: Session | null;
  user: User | null;
  profile: CloudProfile | null;
  familyId: string | null;
}

/** 邮箱 + 密码登录 */
export async function signIn(email: string, password: string): Promise<string | null> {
  if (!supabase) return "Supabase 未配置";
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? error.message : null;
}

/** 退出登录 */
export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}

/**
 * 查询当前 session / user / profile / family_id。
 * 如果 profile 不存在，自动创建 family + profile。
 */
export async function loadAuthState(): Promise<CloudAuthState> {
  const empty: CloudAuthState = { session: null, user: null, profile: null, familyId: null };
  if (!supabase) return empty;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return empty;
  const user = session.user;

  // 查询是否已有 profile
  const { data: existing } = await supabase
    .from("profiles")
    .select("id, family_id, display_name, role")
    .eq("id", user.id)
    .maybeSingle();

  if (existing) {
    return { session, user, profile: existing as CloudProfile, familyId: existing.family_id };
  }

  // profile 不存在：自动创建 family → profile
  const familyId = crypto.randomUUID();

  const { error: familyErr } = await supabase
    .from("families")
    .insert({ id: familyId, name: "家庭学习计划" });

  if (familyErr) {
    console.error("[cloudAuth] 创建 family 失败", familyErr);
    throw new Error(`创建家庭失败: ${familyErr.message}`);
  }

  const newProfile: CloudProfile = {
    id: user.id,
    family_id: familyId,
    display_name: "家庭账号",
    role: "member",
  };

  const { error: profileErr } = await supabase.from("profiles").insert(newProfile);
  if (profileErr) {
    console.error("[cloudAuth] 创建 profile 失败", profileErr);
    throw new Error(`创建账号信息失败: ${profileErr.message}`);
  }

  return { session, user, profile: newProfile, familyId };
}
