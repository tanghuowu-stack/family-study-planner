/**
 * Supabase client
 *
 * 如果环境变量未配置，createClient 不会被调用，
 * 应用继续在本地 IndexedDB 模式下运行。
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** 是否已在 .env 中配置 Supabase 连接信息 */
export const supabaseConfigured = Boolean(url && anonKey);

/** Supabase 客户端实例（未配置时为 null） */
export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, anonKey!)
  : null;
