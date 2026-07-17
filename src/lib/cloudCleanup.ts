/**
 * cloudCleanup.ts
 *
 * 维护工具：对账清理本地缓存。
 * 拉取云端 task_occurrence_statuses 全量 id，找出本地多出的行并删除。
 * 只动本地 IndexedDB，不写云端。用于清理云端已物理删除、
 * 但因 pull 只增改不删而残留在本地的 occurrence 行。
 */
import { db } from "../data/db";
import { supabase } from "./supabase";

/** 本地存在但云端没有的行，若 updatedAt 在此窗口内则视为尚未同步的新写入，跳过不删 */
const RECENT_WRITE_GRACE_MS = 10 * 60 * 1000;

export interface OccurrenceCleanupPreview {
  deletableIds: string[];
  skippedRecent: number;
  localTotal: number;
  cloudTotal: number;
}

export async function previewLocalOccurrenceCleanup(familyId: string): Promise<OccurrenceCleanupPreview> {
  if (!supabase) throw new Error("Supabase 未配置");
  const { data, error } = await supabase
    .from("task_occurrence_statuses")
    .select("id")
    .eq("family_id", familyId);
  if (error) throw new Error(`读取云端单次状态失败: ${error.message}`);
  const cloudIds = new Set((data ?? []).map((row) => row.id as string));
  const locals = await db.taskOccurrenceStatuses.toArray();
  const cutoff = Date.now() - RECENT_WRITE_GRACE_MS;
  const deletableIds: string[] = [];
  let skippedRecent = 0;
  for (const row of locals) {
    if (cloudIds.has(row.id)) continue;
    const updated = row.updatedAt ? Date.parse(row.updatedAt) : NaN;
    if (Number.isFinite(updated) && updated > cutoff) {
      skippedRecent++;
      continue;
    }
    deletableIds.push(row.id);
  }
  return { deletableIds, skippedRecent, localTotal: locals.length, cloudTotal: cloudIds.size };
}

export async function deleteLocalOccurrences(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  await db.taskOccurrenceStatuses.bulkDelete(ids);
  return ids.length;
}
