-- ============================================================
-- 迁移：打卡生效起点（历史欠账保护）
-- 在已存在的 family-study-cloud 库上增量执行。
-- 执行方式：复制到 Supabase SQL Editor 全选运行一次。
--
-- 说明：
-- tasks.streak_start_date——勾选"计入打卡"当天自动写入的本地日，
-- 早于此日的排期日不算应做（不算漏卡也不算打卡）。
-- 前端只在任务带 enable_streak 字段时才写此列（与 enable_streak
-- 同一保护逻辑），但由于 enable_streak 列已在使用，
-- **本迁移必须在部署本次代码后尽快执行**，否则勾选/取消"计入打卡"
-- 的任务上传会报错（其他任务不受影响）。
-- ============================================================

alter table public.tasks
  add column if not exists streak_start_date date;
