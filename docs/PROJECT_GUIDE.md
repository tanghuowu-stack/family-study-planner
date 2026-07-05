# 小步计划 · 项目主索引（PROJECT_GUIDE）

> 这是 Claude Code 每次开工都要先读的"地基文件"。其余具体任务看对应的 `TASK_XX_*.md`。
> 本文件只写：项目是什么、技术栈、表结构速查、铁律、开发流程。不写具体功能实现细节。

---

## 0. 这个文件怎么用（给 Claude Code）

- **本套文档（PROJECT_GUIDE + TASK_01~08）是当前唯一权威**。docs 目录下可能还有更早的 md（如 current-state.md、project-rules.md、change-log.md、cloud-migration-plan.md、codex-runbook.md 等），那些是历史参考，**如有冲突一律以本套文档为准**，不要从旧文件里取规则。`supabase-schema.sql` 是真实建表脚本，可作为表结构的事实依据参考。
- **每次开工**：先读本文件，再读本次任务对应的单张任务卡（如 `TASK_01_realtime.md`）。**不要读无关的任务卡**，节省上下文。
- **改动前**：先 `git status` 确认工作区干净，先读相关源文件再动手，不要凭文档猜测当前代码。
- **改动后**：自检三条铁律（见第 5 节）是否违反；提交前 `git status --short` 确认 `.env.local` 没进暂存区。

---

## 1. 项目是什么

家庭内部使用的学习规划系统。家长在 Mac 录入/安排任务，孩子在 iPad 打开主屏幕 PWA 查看今日任务并勾选完成。Mac 和 iPad 共用同一个 Supabase 家庭账号，数据云端同步。

**不是**通用待办工具，**不做**商业级项目管理。当前目标是稳定服务一个家庭的学习流程。

---

## 2. 技术栈与部署

| 项 | 值 |
|---|---|
| 前端 | React + Vite + TypeScript + Tailwind 风格 |
| 本地数据层 | IndexedDB / Dexie（保留，作本地模式 + fallback 缓存）|
| 云端 | Supabase（Postgres + Auth + 未来 Realtime）|
| 部署 | Vercel |
| 本地项目根目录 | `/Users/gulao/Documents/学习生活规划系统` |
| GitHub | `tanghuowu-stack/family-study-planner` |
| Vercel 项目 | `family-study-planner` |
| Supabase 项目 | `family-study-cloud` |

**数据源切换原则**：未配置 Supabase / 未登录 / 无 family_id → 走 IndexedDB 本地模式；已登录且有 family/profile → 走云端模式（Supabase 读写 + IndexedDB 作缓存）。

---

## 3. 现有代码职责速查

```
taskRepository.ts       原 IndexedDB 本地数据层（保留，勿删）
cloudRepository.ts      云端优先数据层，Supabase 读写 + 本地缓存
repositoryProvider.ts   按登录状态选择本地 / 云端 repository
cloudAuth.ts            邮箱密码登录、family/profile 初始化
cloudUpload/Read/Download.ts  维护工具：上传/预览/下载
CloudLoginPanel.tsx     打印备份页里的云同步状态与维护面板
App.tsx                 正式任务动作汇聚点（增删改查、勾选、小项、单次状态）
```

页面组件（今日页 / 周计划 / 月历 / 任务管理）尽量保持 UI 不变，只通过上层数据层切换数据来源。

---

## 4. UI / 视觉改动规范

**所有 UI 和视觉相关改动必须参照 [`docs/style.md`](./style.md)。**

- 颜色、间距、字号、字重、圆角、阴影、按钮配色，一律从 style.md 选取，不允许现场发明新值
- 新增任何标签/badge/按钮前，先查 style.md §6（按钮规范）和 §7（标签铁律）
- 改动完成后如引入了新的视觉规则，同步写进 style.md

---

## 5. 三条铁律（违反会出严重 bug 或安全问题）

1. **`service_role key` 绝不进前端**：不进 `.env.local`、Vercel、GitHub、任何前端代码。前端只用 `anon public key`。
2. **date 字段只传 `YYYY-MM-DD` 或 `null`，绝不传空字符串**。空字符串会让 Supabase 报错。
3. **删除一律软删除**：写 `deleted_at`，不物理删除。`activity_logs` 只允许 select + insert，不要 upsert / update。

---

## 6. 数据层注意事项（代码审查中确认的规则）

- **删除父任务必须级联同步子任务到云端**：本地软删父任务时子任务也会被级联软删，`cloudRepository.ts` 里的删除逻辑必须把这些子任务一并 `upsert`（写入 `deleted_at`）到云端，否则下次全量拉取子任务会复活。
- **批量删除 / 任意增删改一律走 `getRepository()`**：页面组件不要直接 import 调用 `taskRepository` 的写方法，必须通过 `getRepository()` 按当前登录状态选正确的数据层，否则云端模式下会被绕过、写操作不同步。
- **checklist 更新用 upsert + id 差集删除，不用先删后插**：`cloudRepository.ts` 更新任务小项时应先按 `id` upsert 现有小项，再用 id 差集删除不再存在的旧项，避免"先删全部再插入"在网络中断时丢数据。
- **云端写操作失败不允许静默吞掉**：所有 `supabase` 写操作（`upsert`/`insert`/`update`/`delete`）的失败都必须调用 `notifySyncError` 提示用户，禁止 `.catch(() => {})` 之类的静默处理；只有纯本地 IndexedDB 缓存写入可以静默重试/忽略。

---

## 6.5 完成状态数据层铁律（2026-07 架构审查确立，任何改动不得违反）

**R1 唯一权威源**：每个任务的完成状态有且只有一个权威源，由 `isOccurrenceSchedule(task)` 判定（schedulePattern 为 dailyRecurring / weeklyRecurring / specificDates / dateRangeDaily / dateRangeWeekdays，或 timeType 为 recurring）。
- **occurrence 类**：权威源是 `task_occurrence_statuses` 表。任务本体 `status` 只允许 `todo`（常态）或 `cancelled`（整体取消），**永远不为 done / doing / overdue**，`completedAt` 恒为空。
- **非 occurrence 类**（singleDate / weekGoal / monthGoal / assignmentWindow / dateRange）：权威源是本体 `status` + `completedAt`，不得产生 occurrence 记录。

**R2 occurrence 行是 patch 不是 put**：写 occurrence 状态时必须保留未显式传入的字段（`overrideDate` / `overrideNote` / `overrideTitle`），禁止整行覆盖。否则"完成一个已延期的任务"会抹掉延期记录。

**R3 展示字段永不落库**：`TaskDisplay` 的运行时字段（`occurrenceDate` / `occurrenceStatus` / `overrideDate` / `overrideNote` / `rolledFromDate`）和被覆盖后的 `status` 一律不得写入 `db.tasks`。写入口（create / update）必须做白名单清洗。

**R4 overdue 是派生态**：只在读取时计算（如 getOverdueTasks），不落库，不出现在可写状态集合里。

**R5 云同步不回滚新数据**：任何"云→本地"覆盖必须按 `updatedAt` 做 last-write-wins 比较，本地较新则跳过；任何本地删除必须是软删除（含 allocateTask 重排子任务），否则云端感知不到、下次拉取会复活。

**R6 dateRange 语义**：`timeType: "dateRange"` = "一件事，在这段日期内做完"，整体一次性完成，状态在本体；"每天都要做"的场景一律用 `dailyRecurring` + 结束日期表达。表单的"日期范围"不再挂 dateRangeDaily 排期。

---

## 7. Supabase 表结构速查

8 张表，全部以 `family_id` 作数据隔离边界，RLS 保护。

| 表 | 作用 | 关键字段 |
|---|---|---|
| `families` | 家庭空间 | id, name, created_at, updated_at |
| `profiles` | Auth 用户 ↔ family 绑定 | id(=auth.uid), family_id, display_name, role |
| `tasks` | 核心任务表 | 见下方说明 |
| `task_checklist_items` | 任务清单小项 | id, family_id, task_id, title, done, sort_order |
| `task_occurrence_statuses` | 重复/长期任务的单日状态 | id, family_id, task_id, occurrence_date, status, override_date, override_note |
| `plan_periods` | 假期/阶段配置 | id, family_id, name, type, start_date, end_date |
| `activity_logs` | 操作日志（追加型，只 select+insert）| —— |
| `app_settings` | 预留设置表（当前未用）| —— |

**tasks 表要点**：
- 任务 id 保留前端字符串 id，**不改成 uuid**（兼容现有数据）。
- 存：标题、一级分类、二级分类、内容类型、时间类型、日期、起止日期、周开始日、多日期数组、重复规则、周目标、所属阶段、状态、滚动模式、日历可见性、时间段、预计时长、父任务、完成时间、软删除时间、删除设备、元数据、创建/更新时间。
- 复杂字段 `recurrence` / `weekly_quota` / `metadata` 用 **jsonb**。

**RLS 关键**：用 `public.get_my_family_id()` 函数（`security definer`，`set search_path = public`，查 `public.profiles`）。`families_insert` 允许登录用户创建 family（初始化时第一个 profile 还不存在，不能依赖 get_my_family_id）。`profiles_select` 不调用 get_my_family_id（避免递归）。`authenticated` 角色对核心业务表有完整增删改查，对 activity_logs 只给 select+insert。

---

## 8. 登录与账号

- **只用邮箱+密码**：`supabase.auth.signInWithPassword({ email, password })`。
- **禁用**：Magic Link、Email OTP、邮箱/短信验证码、第三方 OAuth（家庭日常用不稳定）。
- 当前一个共享家庭账号，Mac/iPad 同邮箱密码登录。多孩子账号是未来扩展（见 TASK_06），当前不拆分。

---

## 9. 业务分类体系

一级分类：`学校作业` / `课外` / `兴趣班` / `事项`

- **学校作业**：语文、数学、英语、其他
- **课外**：语文、数学、英语、其他；内容类型有上课、作业、练习、听写、背诵、阅读、其他。阅读只在"课外→其他"下，标题可空，空标题显示"课外·其他｜阅读"。
- **兴趣班**：钢琴课、游泳课、轮滑课、钢琴练习。前三个算"上课"，钢琴练习不算上课不显示"上课"标签。空标题不显示重复名。
- **事项**：旅游、休闲、考试或比赛、其他（非学习但影响计划安排）。

任务落入假期范围可自动归该假期阶段：单日任务日期在假期内即归；有 startDate/endDate 的重复任务完整落在假期内才归；无 endDate 的长期任务不自动归假期。

---

## 10. 开发阶段总览（路线图）

按依赖顺序分三层，**先地基、再体验、后增值**。每张任务卡是独立单元，做哪个读哪张。

**第一层 · 地基**
- `TASK_01_realtime.md` — 实时自动同步（Supabase Realtime）★ 最优先
- `TASK_02_courses.md` — 课程库 + 学科分类可配置化（增量加表，非重构）

**第二层 · 体验**
- `TASK_03_quick_add.md` — 新建任务表单简化（快速添加 + 更多设置折叠）
- `TASK_04_calendar_mobile.md` — 月历手机端适配（文字截断修复 + 手势翻页）
- `TASK_05_visual.md` — 视觉/配色优化（含孩子正向反馈）

**第三层 · 增值**
- `TASK_06_multi_child.md` — 多孩子档案（先单账号多档案）
- `TASK_07_voice_input.md` — 语音输入 + AI 解析任务
- `TASK_08_stats.md` — 统计趋势 + 家长周报

**每张任务卡里都会标注：建议用哪个模型（省 Token）、是否依赖前置任务、验收标准。**

---

## 11. 模型选择速查（省 Token）

| 改动类型 | 用哪个模型 | 典型场景 |
|---|---|---|
| 大改 / 架构 / 新建数据流 | **Opus**（更聪明）| 实时同步、课程库建表与关联、语音解析链路 |
| 中等 / 单页面逻辑 | **Sonnet**（均衡）| 表单简化、月历适配、多档案切换 |
| 小改 / 纯样式 / 文案 | **Haiku 或 Sonnet**（便宜快）| 配色、间距、改标签文字、调图标 |

原则：**难的部分用强模型一次做对（返工比模型差价贵得多），机械的部分用便宜模型批量过。** 每张任务卡顶部会给出该任务的推荐模型。

---

## 12. 明确不做（当前边界）

短期不做：复杂权限系统、实时冲突合并、离线队列、AI 自动排课、大型 BI 报表、多家庭空间、商业化。英语听写系统保持独立，不合并进本项目数据库。
