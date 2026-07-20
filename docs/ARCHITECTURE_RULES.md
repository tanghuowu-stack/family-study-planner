# 小步计划 · 架构与开发规范（ARCHITECTURE_RULES）

> 本文档汇总目前散落在 `PROJECT_GUIDE.md`、`TASK_0x` 任务卡、`change-log.md`、`style.md` 与源码注释里的架构约束，
> 并把最近几次真实踩过的坑提炼成可执行规范。
>
> **定位**：`PROJECT_GUIDE.md` 仍是"每次开工先读的地基 + 路线图"；本文档是"改数据层/同步链路前必读的一致性规范"。
> 两者冲突时，以更晚更新的一方为准，并同步修正另一方。**本文档只讲规则，不讲某个功能怎么实现**（那些看任务卡）。
>
> 生成于 2026-07-19，随架构演进增补。

---

## 1. 项目全貌

**小步计划**是一个家庭内部使用的学习规划系统。家长在 Mac 录入/安排任务，孩子在 iPad 打开主屏幕 PWA 查看今日任务并勾选完成。不是通用待办工具，不做商业级项目管理——当前目标是稳定服务一个家庭的学习流程。

**技术栈**：React + Vite + TypeScript + Tailwind 风格；本地数据层 IndexedDB / Dexie；云端 Supabase（Postgres + Auth + Realtime）；部署 Vercel。

**数据流转（核心心智模型）**：

```
                         ┌─────────────── Supabase (Postgres) ───────────────┐
                         │  tasks / task_checklist_items /                    │
   写入(REST upsert) ───▶ │  task_occurrence_statuses / plan_periods /         │
                         │  courses / app_settings / activity_logs            │
   拉取(REST select) ◀── │  （全部以 family_id 隔离，RLS 保护）                 │
                         └──────────────┬──────────────────────┬─────────────┘
                                        │ Realtime 推送          │ 拉取
                                        ▼                        ▼
                         ┌─────────────────────────────────────────────────┐
                         │  本地 IndexedDB / Dexie（缓存 + 本地模式 fallback）│
                         │  ▲ 页面读写只经过这里（cloudRepository 先写本地   │
                         │  │ 再 upsert 云端；页面永远读本地缓存）            │
                         └──┴──────────────────────────────────────────────┘
                                        ▲
                              页面组件（今日/月历/任务管理/统计）
```

- **数据源切换**：未配置 Supabase / 未登录 / 无 family_id → 走 IndexedDB 本地模式；已登录且有 family/profile → 走云端模式（Supabase 读写 + IndexedDB 作缓存）。由 `repositoryProvider.getRepository()` 按登录状态选择 `taskRepository`（纯本地）或 `cloudRepository`（云端包装层）。
- **云端包装层**：`cloudRepository` 的每个写方法都是"先调 `taskRepository` 写本地，再 upsert 云端"。所以**本地永远是先写、先成功的**；云端失败不回滚本地，只挂"未同步"黄标（`sun` 色）提示用户重试。
- **同步是"拉全量"不是"打补丁"**：Realtime 事件 / 回前台 / 每 3 分钟兜底，收到信号后都只做"拉一次最新云端数据覆盖本地缓存"（`refreshFromCloud`），不做按 payload 的增量 patch（增量 patch 与软删、单次状态的组装逻辑容易冲突）。
- **冲突用 LWW（last-write-wins）**：云→本地覆盖前按 `updatedAt` 比较，本地较新则跳过（见 R5 与 §3.4）。家庭场景同改一条概率极低，不做复杂合并。

**家长 / 孩子的用法**：Mac 和 iPad 共用同一个 Supabase 家庭账号（同邮箱密码），只用邮箱+密码登录（禁用 Magic Link / OTP / OAuth）。当前一个共享家庭账号，多孩子档案是未来扩展（TASK_06）。

---

## 2. 核心铁律（现行版本，2026-07 架构审查确立）

> 以下 R1–R6 从 `PROJECT_GUIDE.md` §6.5 誊录并逐条核实与现行代码一致。**核实结论：R1–R6 全部仍然准确，无过时条目。** 判定入口 `isOccurrenceSchedule(task)` 现行实现即 `task.timeType === "recurring"`（`src/utils/taskMeta.ts`），与 R1 表述一致。

**R1 唯一权威源**：每个任务的完成状态有且只有一个权威源，由 `isOccurrenceSchedule(task)` 判定（`timeType === "recurring"`）。
- **occurrence 类**：权威源是 `task_occurrence_statuses` 表。任务本体 `status` 只允许 `todo`（常态）或 `cancelled`（整体取消），**永远不为 done / doing / overdue**，`completedAt` 恒为空。
- **非 occurrence 类**（singleDate / weekGoal / monthGoal / assignmentWindow / dateRange）：权威源是本体 `status` + `completedAt`，不得产生 occurrence 记录。

**R2 occurrence 行是 patch 不是 put**：写 occurrence 状态时必须保留未显式传入的字段（`overrideDate` / `overrideNote` / `overrideTitle`），禁止整行覆盖。否则"完成一个已延期的任务"会抹掉延期记录。

**R3 展示字段永不落库**：`TaskDisplay` 的运行时字段（`occurrenceDate` / `occurrenceStatus` / `overrideDate` / `overrideNote` / `rolledFromDate`）和被覆盖后的 `status` 一律不得写入 `db.tasks`。写入口（create / update / copyToDate）必须过 `sanitizeTaskWrite` 白名单清洗。

**R4 overdue 是派生态**：只在读取时计算（如 `getOverdueTasks`），不落库，不出现在可写状态集合里。

**R5 云同步不回滚新数据**：任何"云→本地"覆盖必须按 `updatedAt` 做 last-write-wins 比较（`lwwMerge`），本地较新则跳过；任何本地删除必须是软删除（含 `allocateTask` 重排子任务、`removePlanPeriod`/`removeCourse` 的解绑），否则云端感知不到、下次拉取会复活。**推论**：任何本地写入都必须刷新 `updatedAt=now`，否则会被下次 pull 的"相等即覆盖"回滚（`reorderTasks` 就是因此显式刷新 updatedAt）。

**R6 dateRange 语义**：`timeType: "dateRange"` = "一件事，在这段日期内做完"，整体一次性完成，状态在本体；"每天都要做"的场景一律用 `dailyRecurring` + 结束日期表达。表单的"日期范围"不再挂 dateRangeDaily 排期。

**R1 补注（2026-07-17）**："删除一律软删"目前对 `task_occurrence_statuses` 表无法执行——该表没有 `deleted_at` 列，物理删除不会传播到其他设备的本地缓存（pull 只增改不删）。维护性物理删除必须先向用户说明并确认后再执行；残留可用维护面板「对账清理本地缓存」清掉。

---

## 3. 数据一致性规范（重点）

> 这一节是本文档的核心，来自最近几次真实修复的教训。每条都写"为什么"和"具体要求"。

### 3.1 字段双向映射规范

**教训**：`actualMinutes`（任务级）曾只在上传方向 `taskToRow` 写了 `actual_minutes` 列，下载方向 `rowToTask` 漏读——本地写入、云端 upsert 都正确，但每次云端 pull 用 `rowToTask` 转换时把这个字段丢了，"缺字段"的对象通过 LWW（updatedAt 不算旧）覆盖本地缓存，导致计时停止后约 2 秒实际用时消失。云端数据全程正确，只是本地缓存被反复读丢。云端模式必现、本地模式永不触发。

**为什么容易漏**：`Task` 对象 ↔ Supabase 行之间的字段映射，目前散落在 **4 个独立映射面**，任何一个漏一条都会静默丢字段：

| 映射面 | 文件 | 方向 | 用途 |
|---|---|---|---|
| `taskToRow` | `data/cloudRepository.ts` | Task → row | 正常云端模式写入（每次 create/update/勾选）|
| `rowToTask` | `lib/cloudRead.ts` | row → Task | 正常云端模式拉取（`refreshFromCloud` / Realtime / 兜底）|
| upload 映射 | `lib/cloudUpload.ts` | Task → row | 维护面板「上传本地数据到云端」|
| download 映射 | `lib/cloudDownload.ts` | row → Task | 维护面板「从云端下载数据」（强制覆盖本地）|

**具体要求**：
1. **`Task` 任何新增/改名字段，4 个映射面必须同步更新。** 顺序建议：先改 `types/task.ts`，再全局 `grep` 字段名确认 4 处都覆盖。
2. **新增字段后必须在 `cloudFieldParity.test.ts` 的 `FIELD_PAIRS` 里加一行。** 这个测试对 `taskToRow` ↔ `rowToTask`（正常读写路径这一对）做"上传→云端行→下载"往返断言，漏映射会立即断言失败。`taskToRow` 已 `export` 供测试引用。维护方式：往 `fullTask()` 里补该字段的非空样例值，往 `FIELD_PAIRS` 数组加 `["字段名", t.字段名]`。
3. **走 metadata jsonb 的低频字段**（`totalAmount` / `amountUnit` / `splitCount` / `amountPerSession` / `readingTargetCount` / `readingTargetUnit` / `allowedWeekdays` / `allowWeekend` / `enableTimer`）由 `buildMetadata` 整包透传、`...row.metadata` 整包展开，结构上不会出现单向漏映射，不必逐字段列进 parity 测试；但新增这类字段仍要确认 `buildMetadata` 里加了对应行。
4. **已知缺口**：`cloudFieldParity.test.ts` 只覆盖 `taskToRow`/`rowToTask` 这一对（日常读写路径，最高频最危险）。维护面板的 `cloudUpload.ts` / `cloudDownload.ts` 两个映射面**未纳入**该测试——改这两个文件时需手动逐字段核对。

### 3.2 冗余 / 派生字段规范

**教训**：`task.endDate` 对 `dailyRecurring`/`weeklyRecurring` 排期毫无作用（这两种模式排期只读 `recurrence.endDate`），但历史上两个字段没有联动，`task.endDate` 变成越攒越不一致的死数据。曾导致"暑假作业-趣味练习题1页"因 `recurrence.endDate=07-04` 早于 `task.endDate=08-20` 提前掐断排期，用户以为丢了任务而重建两次。

**原则**：凡是"一个值本该跟随另一个值"的冗余字段，必须在**写入口单点强制镜像**，不能靠调用方记得填两遍，也不能靠事后扫描发现不一致。

**现有这类字段清单**：

| 字段 | 跟随谁 | 生效条件 | 镜像位置 | 说明 |
|---|---|---|---|---|
| `task.endDate` | `recurrence.endDate`（含清空）| `timeType=recurring` 且 `schedulePattern ∈ {dailyRecurring, weeklyRecurring}` | `sanitizeTaskWrite`（`taskRepository.ts`）| 该模式下排期只读 recurrence，本体 endDate 无独立消费者，是纯死数据，强制跟随 |
| occurrence 类 `task.status` | 恒定为 `todo`/`cancelled` | `isOccurrenceSchedule(task)` | `sanitizeTaskWrite` | R1：完成状态在 occurrence 表，本体不写 done |
| occurrence 类 `task.completedAt` | 恒为 `undefined` | 同上 | `sanitizeTaskWrite` | 同上 |
| `task.completedAt` | 跟随 `status` 变化 | 非 occurrence 类，`update` 里 status 改 done→补 now、退出 done→清空 | `taskRepository.update` | 堵"done 无 completedAt / todo 带残留 completedAt"两类脏数据 |
| `task.streakStartDate` | 跟随 `enableStreak` | 勾选(false→true)写当天、重勾更新、取消保留 | `taskRepository.create/update` | 打卡历史欠账保护，取消时保留供回看 |

**具体要求**：
1. 新增冗余/派生字段时，**镜像逻辑写在 `sanitizeTaskWrite` 或 create/update 的单一入口**，让所有写路径（含 cloudRepository 包装层，因为它内部调 taskRepository）自动继承，不要在每个调用点各写一遍。
2. 镜像要**覆盖"清空"分支**（如 recurrence.endDate 从有值改成 undefined 时，task.endDate 也要一并清空），否则会残留旧值。
3. 补一条对照回归测试（参考 `regression.test.ts` 用例 18/19：镜像含清空、以及不该受影响的 dateRangeDaily 不被误改）。

### 3.3 状态机改动规范

**教训**：计时器"继续"按钮长期直接复用 `start()`（全新开始逻辑），`start` 无条件 `accumulated: 0`——于是"暂停后继续"每次从 0 重算，暂停前的用时全丢。根因是把"恢复暂停"这条转换路径直接复用了"全新开始"的函数，跳过了它本该有的独立语义。

**原则**：任何状态机（计时器 start/pause/resume/stop、任务完成状态 todo/done/cancelled/overdue），每条转换路径必须有**独立、语义明确的实现**，**禁止"某个转换跳过自己的语义、直接复用另一个转换的函数"**。

**计时器状态机（现行，纯转换逻辑在 `context/timerStore.ts`，React 包装在 `TimerContext.tsx`）**：

```
   (无计时)  ──start──▶  运行中(startedAt=now, accumulated=0)
       ▲                    │  │
       │                  pause│  │stop（保存 accumulated+本段，清空）
       │                    ▼  │
   reset(清空)           暂停(startedAt=null, accumulated=已累计)
       ▲                    │
       └────stop────────────┤
                          resume（startedAt=now, accumulated 保留！）
                            │
                            ▼
                          运行中
```

- **关键区别**：`start`（全新开始）→ `accumulated=0`；`resume`（恢复暂停）→ 只重开 `startedAt`，**保留 `accumulated`**。两者语义不同，必须是两个函数，UI 的"继续"按钮调 `resume` 不调 `start`。
- `calcElapsed = accumulated + (startedAt ? now-startedAt : 0)`，暂停时 startedAt 置 null 冻结累计。

**具体要求**：
1. 改计时器或任务完成状态机时，先在改动说明里画出"各状态之间的转换路径"，确认没有"复用邻居函数"的隐患。
2. **能抽成纯函数的状态转换就抽出来**（如 `timerStore.ts` 从 `TimerContext.tsx` 抽离），这样可以脱离 React 写纯函数测试（项目目前没有 React 组件测试基础设施，纯函数测试是唯一能自动覆盖这类逻辑的手段）。
3. 补状态转换测试（参考 `timerStore.test.ts`：暂停继续保留 accumulated、多次暂停继续累加、全新开始恒为 0）。

### 3.4 写入覆盖规范（"最新数据做基准"）

**教训**：`setDisplayStatus` 已经查询了最新的 `before`（DB 现状），却在写 `checklistItems` 时用了**调用方传入的旧 `task` 快照**——若小项刚计时/手填保存了 `actualMinutes`，紧接着点任务整体"标记为完成"，这份 UI 侧的旧快照会把刚存的值覆盖掉。

**原则**：任何写入函数，如果它要"以某个对象为基准去改几个字段再整体写回"，那个基准**必须是刚从 DB 查出来的最新值，不能是调用方（UI）传进来的快照**——UI 快照可能是几百毫秒前渲染时的旧状态，中间可能已有别的写入落库。

**写入函数自查清单**（新增或改动 `db.tasks.update/put` 类写入时逐条过）：
1. 我写回的字段里，有没有"整体带过去的"复合字段（`checklistItems`、`recurrence`、`weeklyQuota` 等）？
2. 如果有，这个复合字段的来源是 **DB 查询结果**（如 `const before = await db.tasks.get(id)` 后用 `before.checklistItems`），还是 **函数入参的快照**（如 `task.checklistItems`）？只有查询结果是安全的。
3. `db.tasks.update({...})` 是**部分更新**（只改传入的键），只要不传复合字段就不会覆盖它——优先只传真正要改的键，避免顺手把复合字段整体写回。
4. 写入必须带 `updatedAt = now`（R5 推论），否则会被下次 pull 回滚。

**当前写入口分类（供参考）**：
- 走 `sanitizeTaskWrite` 全对象落库（R1/R3/§3.2 镜像全生效）：`create`、`update`、`copyToDate`。
- 部分字段 `db.tasks.update({...})`（不触发 sanitize，但只改指定键、不会重引入展示字段）：`setDisplayStatus`、`saveActualMinutes`、`toggleChecklistItem`、`reorderTasks`、软删/恢复、父子联动。这些**不经过 §3.2 镜像**，因此约定它们不去碰 recurrence/endDate/status 之外的联动字段——要碰就得走 create/update。
- 裸 `bulkPut`（绕过所有防线，已知技术债）：`importBackup`（见 §4）。

---

## 4. 已知技术债清单

> 迁移自 `PROJECT_GUIDE.md` §13 并核实现状，新增本次发现项。**改到相关文件时顺手确认这里的状态是否还准确。**

### 同步机制

- **`task_occurrence_statuses` 表缺 `deleted_at` 列**：跨设备删除 occurrence 无墓碑机制（pull 只增改不删，物理删除不同步到其他设备本地缓存）。中期如需再做 schema 迁移；当前靠维护面板「对账清理本地缓存」手动对齐（2026-07-17 记）。
- **`Task.month`（monthGoal 用）云端未接入**：`tasks` 表没有对应列，`taskToRow`/`rowToTask` 都不映射——不是"漏映射"而是"整体没接入云端"，monthGoal 任务的 month 字段云端模式下不同步。当前未见故障（monthGoal 使用面窄），要接入需先加 schema 迁移（2026-07-19 排查 actualMinutes 时顺带发现）。

### 2026-07-17 代码审查遗留（P1/P2，文件位置为审查时行号，可能已漂移）

- **P1** `removePlanPeriod`/`removeCourse` 的任务解绑（`taskRepository.ts` 的 `.modify`）不刷新 updatedAt，且 `cloudRepository.ts` 不把被解绑任务 upsert 上云 → 下次 pull 被 LWW（相等即覆盖）回滚，任务重新指向已删除的假期/课程。修法：modify 时带 updatedAt=now，云端包装层补 upsert 受影响任务。
- **P1** `importBackup`（`taskRepository.ts`）无 R1 清洗：任务 status/completedAt 原样 `bulkPut`、occurrence 行原样导入，旧备份会把脏数据灌回本地。修法：导入时按 isOccurrenceSchedule 清洗本体状态、过滤违规 occurrence 行。
- **P1** 云端模式下 `importBackup`（`cloudRepository.ts`）只写本地不上传，导入结果会被下次 pull 按 LWW 覆盖回云端状态。修法：导入完成后强制一次全量上传。
- **P1** 手动「从云端下载」（`cloudDownload.ts`）是无条件 `bulkPut` 强覆盖，但代码注释自称"安全合并"，且按钮无警示 → 本地未同步修改会被静默回滚。修法：改注释、按钮加确认框说明会覆盖本地。
- **P2** `exportBackup`（`taskRepository.ts`）不含 courses 表，恢复备份后任务 courseId 悬空。
- **P2** `remove` 级联软删子任务但 `restore` 只恢复本体不级联恢复子任务，行为不对称。

### Schema 文档漂移（2026-07-19 本次发现，仅文档问题，代码与线上库正常）

- **`tasks.actual_minutes` 列不在任何受控 SQL 文件里**：代码读写它、线上 Supabase 库确实有这一列（REST 查询可返回值），但 `supabase-schema.sql` 未定义、三个 `supabase-migration-*.sql` 也都没有——说明它是当初直接在 Supabase SQL Editor 手加、没记进任何受控脚本（推测随 2026-07-03 审查补字段那次加的）。**风险**：若拿现有 SQL 文件重建一个新库，会缺这一列，任务级实际用时上传即报错。**建议**：补一份 `supabase-migration-actual-minutes.sql`（`alter table public.tasks add column if not exists actual_minutes integer;`）归档，纯文档补全、不影响现网。

### TASK_08 打卡收尾（现状）

- 打卡起点：全部 6 个打卡项目的 `streakStartDate` 已由家长于 2026-07-19 手动统一设为 `2026-07-02`，属最终意图，**后续会话勿再"纠正"回首次完成日**。
- **P2** 管理弹窗候选只列重复类任务，但 `getHabitCalendars` 不限任务类型——若存量出现非重复类任务带 `enableStreak=true`，会"月历有卡但管理弹窗无法取消"。当前库中无此数据；收口方案：`getHabitCalendars` 同样限 `isOccurrenceSchedule`。

---

## 5. 测试与验证规范

**测试基础设施**：Vitest + fake-indexeddb，云端交互全 mock，不碰真实 Supabase。**项目目前没有 React 组件测试基础设施**——所有自动化测试都在数据层 / 纯函数层。UI 交互只能靠浏览器手动复现验证。

**现有用例分类（截至 2026-07-19，89 例）**：

| 测试文件 | 覆盖范围 |
|---|---|
| `data/__tests__/regression.test.ts` | R1–R6 铁律、checklist 联动、父子联动、completedAt 一致性、endDate 镜像、reorder 排序、计时用时不被完成动作覆盖 |
| `data/__tests__/stats.test.ts` | TASK_08 打卡：候选、起点、月历三态、单项连续、休息日免罚 |
| `data/__tests__/cloudReorder.test.ts` | `reorderTasks` 云端 upsert 行集合、未登录不上传（Supabase mock）|
| `lib/__tests__/cloudUpload.test.ts` | occurrence 上传过滤（A 类违规行不上传）|
| `lib/__tests__/cloudFieldParity.test.ts` | `taskToRow`↔`rowToTask` 全字段往返对照（43 例，防单向漏映射）|
| `context/__tests__/timerStore.test.ts` | 计时器状态机纯函数（暂停继续保留 accumulated 等）|
| `utils/__tests__/date.test.ts` | 日期工具（toLocalDateKey UTC+8 边界等）|

**新增功能必须配套的测试级别**：

| 改动类型 | 必配测试 |
|---|---|
| 数据层逻辑（排期、完成判定、连续计算等）| 数据层 Vitest 用例（fake-indexeddb）|
| Task 新增/改字段 | `cloudFieldParity.test.ts` 加对照行（§3.1）|
| 冗余/派生字段镜像 | 对照回归测试，含"清空"分支（§3.2）|
| 状态机（计时器等）| 抽纯函数 + 纯函数测试（§3.3）|
| 云端同步行为 | Supabase mock 断言 upsert 行集合（参考 cloudReorder）|
| 纯 UI / 样式 / 交互手感 | 无自动化基础设施，浏览器手动复现验证 + 截图 |

**验证纪律（硬性）**：
1. **提交前必须 `npm test` 全绿 + `tsc` 通过**，任何提交不得跳过。测试挂了先修测试再提交，**不允许删用例或改断言放行**。
2. **新写的回归测试要验证它真的会红**：临时还原被修的 bug，确认对应用例失败，再改回。否则测试可能是"永远绿的摆设"（`actualMinutes` parity 测试就这样验证过）。
3. **能在浏览器复现的改动，修完要真实复现验证**，不要只靠测试绿就宣布完成。云端模式特有的 bug（如 pull 覆盖类）必须登录云端模式、等足够长时间（跨过一次 pull）后再确认。
4. **改动前先 `git status` 确认工作区干净**；提交前 `git status --short` 确认 `.env.local` 没进暂存区。
5. **`service_role key` 绝不进前端**（不进 `.env.local` / Vercel / GitHub / 前端代码），前端只用 `anon public key`。
6. **date 字段只传 `YYYY-MM-DD` 或 `null`，绝不传空字符串**（空串会让 Supabase 报错）。
7. 用真实数据在浏览器验证时，**测试产生的脏数据必须走真实 UI 路径清理干净**（软删/清空），不要留在生产库。

---

## 6. 模型使用建议（开工前自查）

> 原则：**难的部分用强模型一次做对（返工比模型差价贵得多），机械的部分用便宜模型批量过。** 每张任务卡顶部也会给出该任务的推荐模型。

| 改动类型 | 建议模型 / Effort | 典型场景 |
|---|---|---|
| 疑难排查 / 根因诊断 / 数据一致性问题 | **Opus + 高 Effort** | 计时用时消失、字段漏映射、LWW 回滚、排期规则不一致这类"现象和根因隔了好几层"的问题——省 Token 省不出来，猜错方向返工更贵 |
| 架构改动 / 新建数据流 / 新加表 | **Opus** | 实时同步、课程库建表与关联、语音解析链路、多孩子档案加维度 |
| 中等 / 单页面逻辑 / 单组件交互 | **Sonnet** | 表单简化、月历适配、拖拽排序、单个数据层函数 |
| 小改 / 纯样式 / 文案 | **Haiku 或 Sonnet** | 配色、间距、改标签文字、调图标 |
| 纯文档整理 | **Opus/Sonnet 均可**，看是否需要跨文件核实一致性 | 本文档这类需要通读源码核对的用强一点，单纯改错别字用便宜的 |

**特别提醒**：涉及 §3（数据一致性）的任何改动，无论看起来多小，都建议用高一档的模型 + 高 Effort——这一类 bug 的共同特征是"本地测不出、单看某个文件看不出、要跨映射面/跨状态/跨同步时序才暴露"，正是便宜模型最容易漏的地方。

---

## 7. 文档自查：与代码现状的不一致（只报告，未改代码）

写作过程中通读源码核对，发现以下不一致，**均未改动代码，仅在此列出**：

1. **`tasks.actual_minutes` 列的 SQL 文档缺失**（已在 §4 详述）：线上库和代码都有 `actual_minutes` 任务级列，但 `supabase-schema.sql` 和三个 migration 文件都没有它。用现有 SQL 重建库会缺列。属文档漂移，建议补一份 migration 归档。这是本次唯一实质性的"文档与现网不符"。

2. **`cloudFieldParity.test.ts` 的覆盖范围与"4 个映射面"的差距**（已在 §3.1 详述）：字段对照测试只覆盖 `taskToRow`↔`rowToTask` 这一对（日常读写路径）。维护面板用的 `cloudUpload.ts` / `cloudDownload.ts` 是另外两个独立映射面，未被任何自动化测试覆盖，靠手动核对。当前这两个面的 `actualMinutes` 等字段是齐的（本次已逐一核对），但没有测试兜底，将来新增字段时容易只更新到有测试的那一对。属测试覆盖缺口，非当前 bug。

3. **`saveActualMinutes` 等部分写入口不经过 `sanitizeTaskWrite`**（已在 §3.4 分类说明）：这不是 bug——这些写入用部分字段 `db.tasks.update`，不会重引入展示字段（R3 安全），也不碰 recurrence/endDate（§3.2 镜像无关）。但它意味着"镜像/清洗防线只在 create/update/copyToDate 三个全对象入口生效"，是一条需要开发者知道的边界，不是需要修的缺陷。

以上第 1 条是唯一建议后续处理的实质项（且只是补文档）；第 2、3 条是设计边界与已知覆盖缺口，记录在案供后续参考。
