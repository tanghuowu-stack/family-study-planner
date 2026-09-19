-- ============================================================
-- 迁移：小项完成日期 task_checklist_items.completed_date
-- 在已存在的 family-study-cloud 库上增量执行。
-- 执行方式：复制到 Supabase SQL Editor 全选运行一次。
--
-- 背景（2026-09-19）：
-- 小项此前只有一个全局 done 布尔值，没有"哪天勾的"这一维。顺延任务
-- （原定日到完成日之间隔着好几天）翻看历史日期时，完成状态按天算、
-- 小项却跨所有天共享，两个指示器打架；09-12 曾用"历史日一刀切显示
-- 未勾选"的展示层方案止血，用户不接受——要的是"哪天勾的哪天起显示
-- 完成"。本列记录小项被勾选的本地日期（YYYY-MM-DD），取消勾选置 null；
-- 前端按它回放任意一天的小项状态。
--
-- 前端映射（§3.1 四个映射面）：
--   写：cloudRepository.checklistItemRows / cloudUpload
--   读：cloudRead.rowToChecklistItem（cloudRepository 拉取 / cloudRead 预览 /
--       cloudDownload 强制下载三处共用）
--   对照测试：cloudFieldParity.test.ts
--
-- 幂等：add column if not exists，现网重复执行无副作用；
-- 全新库上执行可正确建出该列。不改动任何现有数据——历史小项该列为
-- null，前端按"未知完成日"兜底展示，不回填假日期。
-- ============================================================

alter table public.task_checklist_items
  add column if not exists completed_date date;
