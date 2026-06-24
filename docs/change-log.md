# 项目变更记录

此文件只记录简短变更摘要。以后每次完成项目修改后，在顶部日期下追加一条记录，不需要复制完整需求或实现细节。

## 2026-06-24

- 修复 Supabase 上传 activity_logs 报错（permission denied）：Step 3 第一阶段上传暂时跳过 activity_logs，避免追加型日志表因 upsert 触发 update 权限需求；核心任务、清单小项、单次状态和假期阶段仍正常上传。
- 修复 Supabase 上传 tasks 失败（not-null constraint）：为本地旧数据补齐必填字段的默认兜底值（如 `calendar_visibility` 默认 "show"，`title` 默认 ""，`status` 默认 "todo" 等），避免因旧数据字段缺失导致插入失败。
- 修复 Supabase 上传失败：新增 date 和 timestamp 字段清洗，过滤掉空字符串 `""`，避免 PostgreSQL 报错。对于无效的必填日期自动跳过并统计。
- 优化云同步面板：上传按钮始终可见，在未登录时明确显示"请先登录"，避免依赖 hover，按钮使用高对比度颜色并增加禁用状态。
- Supabase Step 3：新增 `src/lib/cloudUpload.ts`，实现本地 IndexedDB → Supabase 单向上传（tasks、task_checklist_items、task_occurrence_statuses、plan_periods、activity_logs），使用分批 upsert，支持重复上传不重复生成记录；云同步面板新增"上传本地数据到云端"按钮及上传统计/错误反馈。
- 云同步面板默认隐藏完整 family_id，仅作为高级调试信息展示。
- Supabase schema 补充 authenticated 角色的表权限 GRANT，避免前端插入 families/profiles 时 permission denied。
- 修复 Supabase family/profile 初始化卡死问题：避免 insert family 后使用 `.select().single()` 触发 RLS 拦截，改为在前端生成 `familyId` (使用 `crypto.randomUUID()`) 并直接写入。增加错误捕获与页面提示。
- 接入 Supabase 前端最小闭环（Step 2）：新增 Supabase client（`src/lib/supabase.ts`）、邮箱+密码登录/退出（`src/lib/cloudAuth.ts`）、family/profile 自动初始化和云同步状态面板（`src/components/CloudLoginPanel.tsx`）；任务数据仍保持 IndexedDB 本地模式。
- 修复 Supabase SQL 执行顺序：将 get_my_family_id() 移动到 profiles 表创建之后，避免首次执行时 public.profiles does not exist。
- 修复 Supabase SQL 草案的首个家庭账号初始化问题：调整 families/profiles RLS，避免 get_my_family_id 初始化死锁，补充 search_path 和必要索引。
- 新增 Supabase 同步第一阶段 SQL 草案与实施说明：包含 families、profiles、tasks、task_checklist_items、task_occurrence_statuses、plan_periods、activity_logs、app_settings 表及基础 RLS 策略（`docs/supabase-schema.sql`、`docs/supabase-sync-implementation-plan.md`）。
- 修复 recurring 任务假期自动归属逻辑：每周/每日重复任务若有明确结束日期且完整落入同一假期，自动绑定该假期；长期重复任务仍不自动归属。
- 新增任务表单根据日期自动推断假期归属：单日、指定日期列表、完整日期范围落入同一假期时自动绑定假期，跨阶段或长期任务保留手动选择。
- 修复课程类任务误进入 weeklyQuota 月统计分支，FCE 精讲本月计划按自然月实际课程次数统计。

- 新增修改：
  1. 统一周计划和月历页面的顶部导航样式与今日页的横向白色圆角导航条一致。
  2. 调整本周和本月计划中每个分组的项目排序，已完成项目排序到下方。
  3. 任务管理页面默认进入“当前阶段”。
  4. 修复本月计划统计口径以自然月边界统计，解决 FCE精讲等课程统计多算一节的问题。
- 新增修改：
  1. 调整新建任务时“课外 -> 其他”分类下，“阅读”内容类型在下拉框中排在“其他”前面。
  2. 调整今日清单中任务备注的显示位置为大标题后方（微弱样式行内显示）。
  3. 将“阅读”内容类型任务纳入本周和本月计划统计口径中，并分类在“其他”栏下；本月计划新增“听写”任务显示。
- 修改 1：今日清单及已完成区域备注直接显示（"备注：..."），不再折叠在"查看备注"里；顺延/延期信息保留独立显示。
- 修改 2：课外·其他的内容类型中新增"阅读"；仅在二级类型为"其他"时显示该选项；标题可选；显示不重复"阅读 - 阅读"。
- 修改 3：本周计划汇总只显示上课类任务和多日/日期范围大作业，排除阅读、钢琴练习、事项、单日普通作业。
- 修改 4：复制到日期弹窗默认日期改为当前任务日期的第二天（若无则明天）。

## 2026-06-22

- 新增项目规则文档、当前状态文档、Codex 使用说明文档，用于减少后续 Codex 提示词长度。
