-- ============================================================
-- 迁移：任务级实际用时 tasks.actual_minutes（补记归档）
-- 在已存在的 family-study-cloud 库上增量执行。
-- 执行方式：复制到 Supabase SQL Editor 全选运行一次。
--
-- 背景：
-- 该列此前是直接在 Supabase SQL Editor 手动添加、未记入任何受控
-- 脚本（推测随 2026-07-03 代码审查补字段那次加的）。现网库、前端
-- 读写链路（taskToRow / rowToTask / cloudUpload / cloudDownload）
-- 都已在用，但 supabase-schema.sql 与其他 migration 文件均无此列。
-- 本文件仅为把它正式归档进受控脚本，使"拿现有 SQL 重建一个新库"
-- 时不会缺列（缺列会导致任务级实际用时上传报错）。
--
-- 幂等：add column if not exists，现网重复执行无副作用；
-- 全新库上执行可正确建出该列。不改动任何现有数据。
--
-- 注：小项级实际用时存于 task_checklist_items（该表结构本就完整），
-- 不受本迁移影响；本迁移只补 tasks 表的任务级 actual_minutes。
-- ============================================================

alter table public.tasks
  add column if not exists actual_minutes integer;
