-- ============================================================
-- 迁移：统计功能数据层（TASK_08）
-- 在已存在的 family-study-cloud 库上增量执行。
-- 执行方式：复制到 Supabase SQL Editor 全选运行一次。
--
-- 说明：
-- 1. tasks.enable_streak——任务级"计入连续打卡"开关。
--    前端在该列迁移前不会向 payload 里写这个字段（undefined 被
--    stripUndefined 剔除），因此先部署代码后跑迁移也不会报错；
--    但表单勾选项（下一轮 UI）上线前必须已执行本迁移。
-- 2. task_occurrence_statuses.completed_at 列已在初始 schema 中存在，
--    本轮起前端开始写入真实值（此前恒为 null），无需迁移。
-- 3. 休息日 / 复活卡存 app_settings（key = 'stats_rest_days' /
--    'stats_revive_cards'，value jsonb），复用现有表，无需迁移。
-- ============================================================

alter table public.tasks
  add column if not exists enable_streak boolean not null default false;
