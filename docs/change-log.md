# 项目变更记录

此文件只记录简短变更摘要。以后每次完成项目修改后，在顶部日期下追加一条记录，不需要复制完整需求或实现细节。

## 2026-07-17

- 代码审查修复 4 项（P0-1/P0-2/P1-7/P1-8）：
  1. `taskRepository.update` 联动维护 completedAt：status 改 done 补 completedAt=now，从 done 退出清除，堵住"done 无 completedAt / todo 带残留 completedAt"两类脏数据源。
  2. `copyToDate` 重置名单补全 completedAt、actualMinutes（含小项级），并改为过 sanitizeTaskWrite 落库，消除裸写入口。
  3. 新增 `toLocalDateKey`（utils/date.ts）：timestamp→本地日期键统一入口；替换 2 处 UTC 截断（taskRepository dateRange 完成日截断、StatsPage 备份文件名）。cloudUpload/cloudRepository 的 toDateOrNull 是 date 字段防御清洗，不属 timestamp 截断，未动。
  4. `syncParentCompletion` 开头加 isOccurrenceSchedule(parent) 早退（R1 防线）。
  - 新增回归用例 16-18（update completedAt 双向、copyToDate 重置、toLocalDateKey UTC+8 边界），npm test 19 例全绿。
  - 其余审查遗留 P1×4、P2×2 已记入 PROJECT_GUIDE 第 13 节待办（含文件行号）。
- 建立数据层回归测试（Vitest + fake-indexeddb，云端交互全 mock，不碰真实 Supabase）：
  1. 15 个用例锁住 6.5 节铁律：R1 权威源三例、R2 occurrence patch、R3 展示字段白名单清洗、R4 overdue 派生态、R5 LWW 合并两例 + remove 软删级联 + allocateTask 重排软删、R6 dateRange 整体语义、checklist 联动两例、父子任务联动，以及 cloudUpload occurrence 上传过滤（A 类违规行不上传，变异验证：注释过滤逻辑测试即红）。
  2. `cloudRepository.ts` 导出 lwwMerge 供测试；`package.json` 新增 `npm test`（vitest run）。
  3. PROJECT_GUIDE 开工必读新增硬性门槛：提交前必须 `npm test` 通过，不允许删用例放行。
- 物理删除遗留问题处置（occurrence 表无 deleted_at 列，物理删除不跨设备传播）：
  1. 上传防线：`cloudUpload.ts` 上传 occurrence 行时跳过 A 类违规行（挂在非 occurrence 类任务或已软删任务名下），防止本地脏残留复活到云端，跳过条数在上传结果中展示。
  2. 维护面板新增「对账清理本地缓存」（`cloudCleanup.ts` + `CloudLoginPanel.tsx`）：按云端 occurrence 全量 id 对账，删除本地多出的行；只动本地，执行前弹确认框显示条数；最近 10 分钟内更新的行跳过防误删（可能是尚未同步的新写入）。
  3. `PROJECT_GUIDE.md`：6.5 节补注"删除一律软删对 occurrence 表暂无法执行，维护性物理删除须先经用户确认"；新增第 13 节待办清单，记录 deleted_at 列缺失 / 墓碑机制的技术债。
  - 真实验证：本地造违规 occurrence 行 → 点上传，云端确认未上传（跳过 1 条）；点对账清理，确认框显示 1 条、删除后本地恢复 108 条与云端一致；10 分钟窗口内的新行确认被跳过不删。
- 月历修复：dateRange 任务完成后，月历仍显示完整日期区间（今日页保持"完成日之后不再出现"）。修复"泰国旅游在月计划只显示一天"。`taskRepository.ts` 的 getTasksForDate 对 forCalendar 放开 completedAt 截断。
- A 类脏数据清洗（云端 Supabase + 本地 IndexedDB 同步执行，扫描确认归零）：
  1. 奥数作业（9d1cf897）、大增课后作业 6/20-6/26（ee333bde）：本体置 done（completedAt 取最后一次完成时间），删除名下共 13 条违规 occurrence。
  2. 二轮扫描再清 18 条：已软删任务（FCE精讲、FCE听力单词听写等）的孤儿 occurrence 10 条；dateRange/singleDate 任务名下违规 occurrence 8 条。其中大增课后作业 6/27-7/3（b284c860）有 7/3 完成记录且周期已过，本体一并置 done。
  3. 清洗后扫描结果：云端与本地均为 tasks 95 / occurrences 108，A1（非 occurrence 类任务名下的 occurrence）= 0，A2（occurrence 类任务本体状态违规）= 0。

## 2026-07-05

- （补记）完成状态数据层三处根因修复：写入端 R1/R2/R3 防线（sanitizeTaskWrite 白名单清洗、occurrence patch 语义、展示字段不落库）。
- （补记）云端拉取加 LWW 保护（R5）：`cloudRepository.ts` 新增 lwwMerge，自动同步路径按 updatedAt 比较，防止本地未同步的完成状态被云端旧值回滚；手动"从云端下载"仍为强制覆盖。
- （补记）allocateTask 重排子任务改为软删除（R5）：`taskRepository.ts` 写 deletedAt 代替物理删除，云端同步软删标记，防止旧子任务复活。
- （补记）checklist 保存后重算任务完成状态。
- （补记）对齐 dateRange 整体任务语义（R6）："一件事，在这段日期内做完"，状态在本体，不产生 occurrence。

## 2026-07-04

- （补记）取消周计划，打印/备份页改造为统计页。
- （补记）子任务全部完成时父任务自动完成；事项/上课任务默认在月计划中显示。
- （补记）完成状态写入加即时重试与持续可见的未同步标记；重复类任务接上 rolloverMode 的 carryOver 顺延逻辑。
- （补记）恢复偏好时让 recurrence 频率跟随 schedulePattern。

## 2026-07-03

- Fable 5代码审查修复：按代码审查清单修复 8 项已知问题。
  1. 批量删除绕过云端同步：`TaskManagementPage.tsx` 的批量删除改为走 `getRepository().batchRemove`。
  2. 删除父任务时子任务未同步云端：`cloudRepository.ts` 的 `remove`/`batchRemove` 补充级联子任务的 upsert（写入 `deleted_at`）。
  3. checklist 更新先删后插有丢数据风险：`cloudRepository.ts` 改为按 id upsert + id 差集删除旧项。
  4. 完成任务时孤儿计时器：`TaskItem.tsx` 勾选完成前自动 stop 正在运行的计时器并保存实际用时。
  5. enableTimer 默认值不统一：`TaskItem.tsx`/`TaskForm.tsx` 统一为 `enableTimer === true`（未设置=默认关）。
  6. 云端写失败静默吞掉：`cloudRepository.ts` 三处及 `appSettingsRepository.ts` 的 upsert 改为调用 `notifySyncError` 提示用户。
  7. 维护工具缺字段：`cloudUpload.ts`/`cloudDownload.ts`/`cloudRead.ts` 补齐 `enableTimer`、`actual_minutes`、checklist 的 `estimated_minutes`/`actual_minutes`。
  8. 今日页死代码：`DayPage.tsx` 删除未使用的 `weekSummary`/`monthSummary` state 及 `getWeekOverview`/`getMonthOverview` 调用。
  - 涉及文件：`src/pages/TaskManagementPage.tsx`、`src/data/cloudRepository.ts`、`src/components/TaskItem.tsx`、`src/components/TaskForm.tsx`、`src/data/appSettingsRepository.ts`、`src/lib/cloudUpload.ts`、`src/lib/cloudDownload.ts`、`src/lib/cloudRead.ts`、`src/pages/DayPage.tsx`。

## 2026-06-24

- 新增 iPad 主屏幕图标与 PWA manifest 配置，方便通过 Safari 添加到主屏幕作为“小步计划”入口。

- Supabase Step 6：实现云端优先正式同步模式。新增 `src/data/cloudRepository.ts`（云端读写 + 本地缓存）和 `src/data/repositoryProvider.ts`（按登录状态选择数据源）。修改 `App.tsx` 在启动时初始化云同步并自动拉取最新数据；新增任务/编辑/删除/完成/checklist/occurrence/planPeriods 均写入 Supabase。未登录时降级到 IndexedDB 本地模式。在顶栏展示"云端同步/本地模式"状态标签，在云同步面板展示当前数据模式说明。
- 云端工具诊断：新增“检查本地/云端差异”功能，读取本地 IndexedDB 和 Supabase 的任务列表对比并显示多出项目的详细信息（包含删除状态、标题等），不对任何数据进行增删改，辅助安全排查云同步中多出的本地残留任务。
- Supabase Step 5：新增从云端下载数据到本地。在 `src/lib/cloudDownload.ts` 中实现按 `family_id` 读取 Supabase 数据并安全合并（bulkPut）到本地 IndexedDB 中，包括 `tasks`、`task_checklist_items`、`task_occurrence_statuses`、`plan_periods`。在云同步面板新增了下载按钮和进度/结果展示。
- Supabase Step 4：新增云端读取预览。在 `src/lib/cloudRead.ts` 中实现按 `family_id` 读取 `tasks`、`task_checklist_items`、`task_occurrence_statuses`、`plan_periods`。在云同步面板提供读取结果预览，对比本地与云端数据量，并展示最近 5 条任务作为数据完整性抽查。本轮不切换正式页面数据源。
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
