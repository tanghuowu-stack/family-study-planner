/**
 * repositoryProvider.ts
 *
 * 根据云同步状态动态选择数据源：
 * - 已登录 + Supabase 配置 + familyId 存在 → cloudRepository
 * - 否则 → taskRepository（本地 IndexedDB）
 */
import { supabaseConfigured } from "../lib/supabase";
import { taskRepository } from "./taskRepository";
import { cloudRepository } from "./cloudRepository";
import type { Task, TaskDraft, TaskDisplay, TaskStatus, OccurrenceStatus, PlanPeriod } from "../types/task";

export type AnyRepository = typeof taskRepository;

/** 设置云同步模式：familyId 有效则启用，否则禁用 */
export function setCloudMode(familyId: string | null): void {
  if (familyId && supabaseConfigured) {
    cloudRepository.setFamilyId(familyId);
  } else {
    cloudRepository.setFamilyId("");
  }
}

/** 判断当前是否处于云端同步模式 */
export function isCloudMode(): boolean {
  return supabaseConfigured && !!cloudRepository.getFamilyId();
}

/** 返回当前激活的 repository */
export function getRepository(): AnyRepository {
  return isCloudMode() ? (cloudRepository as unknown as AnyRepository) : taskRepository;
}
