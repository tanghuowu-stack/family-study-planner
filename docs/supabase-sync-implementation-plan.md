# Supabase 同步实施方案

> 本文档是第一阶段的操作手册。第一阶段只建表/RLS，不接前端。

---

## 1. 本阶段范围

- [x] 生成 `docs/supabase-schema.sql`（所有表 + RLS + 触发器 + GRANT 授权）
- [x] 修复 RLS 初始化死锁（`get_my_family_id` search_path、families/profiles 策略）
- [x] 修复 SQL 执行顺序（`get_my_family_id()` 移至 profiles 表之后）
- [x] 前端接入 Supabase client + 邮箱登录 + family/profile 自动初始化（Step 2，面板隐藏内部 ID 优化完成）
- [x] 本地数据单向上传到云端（Step 3：使用 upsert，清理空 date / timestamp 字段，补齐旧数据必填字段默认值防止报错。第一阶段暂跳过 activity_logs）
- [x] 云端读取预览（Step 4 第一阶段：从 Supabase 读取数据并提供本地/云端对比，仅供验证，未切换正式页面数据源）
- [x] 从云端下载数据到本地 IndexedDB（Step 5：使用 bulkPut 安全合并，不删除本地旧数据，未切换正式页面数据源）
- [ ] 双端测试（后续 Step 5）

---

## 2. 如何执行建表 SQL

### 2.1 准备 Supabase 项目

1. 登录 [https://supabase.com](https://supabase.com)
2. 新建一个项目，记录：
   - **Project URL**：`https://xxxx.supabase.co`
   - **Anon Public Key**：`eyJxxx...`

### 2.2 执行 SQL

1. 打开项目的 **SQL Editor**（左侧菜单）
2. 点击 **New Query**
3. 粘贴 `docs/supabase-schema.sql` 的全部内容
4. 点击 **Run**

> **注意：** 如果之前在 SQL Editor 执行失败过，项目里可能残留了部分表或对象。重新执行前，建议先删除已创建的旧对象（如 `drop table xxx cascade;`），或者干脆使用一个全新的 Supabase project 重新测试。

建议执行顺序（SQL 文件内已按顺序排列）：

```
public.set_updated_at() 函数
public.get_my_family_id() 函数
→ families
→ profiles
→ tasks
→ task_checklist_items
→ task_occurrence_statuses
→ plan_periods
→ activity_logs
→ app_settings
→ RLS 策略（families、profiles、tasks…）
```

### 2.3 确认结果

在 **Table Editor** 中确认以下表已创建：

| 表名                      | 行数（初始） |
|---------------------------|------------|
| families                  | 0          |
| profiles                  | 0          |
| tasks                     | 0          |
| task_checklist_items      | 0          |
| task_occurrence_statuses  | 0          |
| plan_periods              | 0          |
| activity_logs             | 0          |
| app_settings              | 0          |

---

## 2a. 首个家庭账号初始化流程

> 修订版说明：SQL 已修复 RLS 死锁。`families_insert` 策略改为 `auth.uid() is not null`，允许已登录用户创建 family；`profiles` 策略不再调用 `get_my_family_id()`，避免递归。全程只用 **anon key + RLS**，不需要 service role key 进入前端。

### 安全注意事项

- **`SUPABASE_SERVICE_ROLE_KEY` 绝不能出现在前端代码、`.env.local` 的 `VITE_` 变量、Git 仓库或截图中。**
- 第一阶段只用 `VITE_SUPABASE_ANON_KEY`（公开 anon key）配合 RLS。
- 如果将来需要更安全的邀请制家庭空间，再通过 Supabase Edge Function（服务端）使用 service role key 完成受控操作。

### 初始化步骤（前端代码逻辑）

用户登录后，前端在进入任何页面前执行一次检查：

```ts
// 伪代码，后续在 cloudRepository 中实现
async function ensureProfileInitialized() {
  // 1. 检查当前用户是否已有 profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, family_id')
    .eq('id', (await supabase.auth.getUser()).data.user!.id)
    .maybeSingle();

  if (profile) return; // 已初始化，跳过

  // 2. 在前端生成唯一的 familyId，避免 insert 后依赖 select 触发 RLS 拦截
  const familyId = crypto.randomUUID();

  // 3. 创建 family（此时 RLS 只要求 auth.uid() is not null）
  //    注意：直接传入 id，且不要使用 .select().single()，防止因 profile 未建而触发 get_my_family_id 返回 null
  const { error: familyError } = await supabase
    .from('families')
    .insert({ id: familyId, name: '家庭学习计划' });

  if (familyError) throw familyError;

  // 4. 创建 profile，绑定 family_id
  const { error: profileError } = await supabase
    .from('profiles')
    .insert({
      id: (await supabase.auth.getUser()).data.user!.id,
      family_id: familyId,
      display_name: '家庭账号',
      role: 'member',
    });

  if (profileError) throw profileError;

  // 5. 此后 get_my_family_id() 即可正常工作
  //    所有业务数据写入时携带 family_id = familyId
}
```

### 初始化完成后

- `get_my_family_id()` 将正确返回该用户绑定的 `family_id`。
- `tasks / plan_periods / task_occurrence_statuses` 等表的 RLS 全部依赖此函数，初始化完成后自动生效。
- 应用层保证同一个账号不会重复创建 family（通过上方的 `maybeSingle()` 检查）。

---

## 3. 创建家庭账号

### 3.1 注册共享账号

在 Supabase 控制台 **Authentication → Users → Invite** 中注册一个共享邮箱账号，例如：

```
family@example.com
```

> 第一阶段只用一个共享账号，Mac 和 iPad 同时登录此账号。

### 3.2 插入 family 记录

在 SQL Editor 执行：

```sql
insert into families (name)
values ('我的家庭')
returning id;
```

记录返回的 `family_id`（uuid）。

### 3.3 绑定 profile

用步骤 3.1 注册完成后，在 SQL Editor 执行（替换两个占位符）：

```sql
insert into profiles (id, family_id, display_name, role)
values (
  '<auth.users 中的用户 id>',
  '<families 中的 family_id>',
  '家庭管理员',
  'member'
);
```

> 用户 id 可在 Authentication → Users 中查到。

---

## 4. 字段映射关系（IndexedDB ↔ Supabase）

### Task 字段映射

| TypeScript (camelCase)   | Supabase (snake_case)     | 备注                              |
|--------------------------|---------------------------|-----------------------------------|
| id                       | id                        | text，保留现有字符串 ID           |
| mainCategory             | main_category             |                                   |
| subCategory              | sub_category              |                                   |
| extraContentType         | extra_content_type        |                                   |
| timeType                 | time_type                 |                                   |
| schedulePattern          | schedule_pattern          |                                   |
| date                     | date                      | date 类型，YYYY-MM-DD             |
| startDate                | start_date                |                                   |
| endDate                  | end_date                  |                                   |
| weekStart                | week_start                |                                   |
| specificDates            | specific_dates            | date[]                            |
| rangeWeekdays            | range_weekdays            | integer[]                         |
| assignmentWindow         | assignment_window         | jsonb                             |
| recurrence               | recurrence                | jsonb (RecurrenceRule)            |
| weeklyQuota              | weekly_quota              | jsonb (WeeklyQuota)               |
| applicablePeriodType     | applicable_period_type    |                                   |
| planPeriodId             | plan_period_id            | text                              |
| status                   | status                    |                                   |
| rolloverMode             | rollover_mode             |                                   |
| allowRollover            | allow_rollover            |                                   |
| calendarVisibility       | calendar_visibility       |                                   |
| childVisible             | child_visible             |                                   |
| sortOrder                | sort_order                |                                   |
| startTime                | start_time                | text (HH:mm)                      |
| endTime                  | end_time                  | text (HH:mm)                      |
| estimatedMinutes         | estimated_minutes         |                                   |
| note                     | note                      |                                   |
| important                | important                 |                                   |
| parentTaskId             | parent_task_id            |                                   |
| sessionIndex             | session_index             |                                   |
| allocationWeekStart      | allocation_week_start     |                                   |
| completedAt              | completed_at              | timestamptz                       |
| deletedAt                | deleted_at                | timestamptz，软删除标记           |
| deletedByDevice          | deleted_by_device         |                                   |
| deletedByActor           | deleted_by_actor          |                                   |
| checklistItems           | → task_checklist_items 表 | 拆出为独立表                      |
| totalAmount / amountUnit | → metadata jsonb          | 低频字段打包存储                  |
| createdAt                | created_at                |                                   |
| updatedAt                | updated_at                |                                   |

### TaskOccurrenceStatus 字段映射

| TypeScript     | Supabase          |
|----------------|-------------------|
| id             | id                |
| taskId         | task_id           |
| occurrenceDate | occurrence_date   |
| status         | status            |
| overrideDate   | override_date     |
| overrideTitle  | override_title    |
| overrideNote   | override_note     |
| createdAt      | created_at        |
| updatedAt      | updated_at        |

---

## 5. 前端后续需要新增的文件

### Step 2（下一阶段执行）

```
src/lib/supabase.ts
```

初始化 Supabase 客户端：

```ts
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
```

---

```
src/data/cloudRepository.ts
```

与 `taskRepository.ts` 接口对齐的 Supabase 实现。主要方法：

- `listTasks(date)` → 从 tasks + occurrence_statuses 查询某天的任务
- `saveTask(draft)` → UPSERT tasks，并同步 task_checklist_items
- `deleteTask(id)` → 软删除（写 deleted_at）
- `setOccurrenceStatus(...)` → UPSERT task_occurrence_statuses
- `listPlanPeriods()` → 查询 plan_periods
- `savePlanPeriod(draft)` → UPSERT plan_periods
- `listActivityLogs()` → 查询 activity_logs
- `logActivity(log)` → INSERT activity_logs

---

```
src/data/repositoryProvider.ts
```

根据登录状态切换 `taskRepository`（本地）或 `cloudRepository`（云端）：

```ts
import { taskRepository } from './taskRepository'
import { cloudRepository } from './cloudRepository'

export const getRepository = () =>
  isLoggedIn() ? cloudRepository : taskRepository
```

---

## 6. JSON 备份迁移方案

### 6.1 导出当前数据

在系统设置 / 备份页面导出 JSON v7 备份文件。

### 6.2 迁移脚本逻辑（后续实现）

```
Step 1：读取 JSON，确认 version === 7
Step 2：写入 plan_periods（UPSERT by id）
Step 3：写入 tasks，忽略 checklistItems 字段
Step 4：把 tasks[].checklistItems 展开写入 task_checklist_items
Step 5：写入 task_occurrence_statuses（UPSERT by task_id + occurrence_date）
Step 6：写入 activity_logs（INSERT，跳过重复 id）
Step 7：验证：对比 JSON 中的数量 vs Supabase 查询数量
```

> 注意：`deleted_at` 不为空的任务也必须原样迁移，保留软删除历史。

---

## 7. 第一阶段同步策略

**本阶段不实现 Supabase Realtime（WebSocket 推送）。**

Mac → iPad 的同步方式：

1. Mac 保存任务 → 写入 Supabase
2. iPad 用户手动刷新页面（或切换 Tab 重新加载）
3. 页面加载时重新拉取 Supabase 数据 → 显示最新状态

---

## 8. 风险点与规避方法

### 8.1 日期时区

**风险**：`date` 字段存为 `timestamptz` 时，若有时区转换，2026-07-01 可能变为 2026-06-30。

**规避**：所有日期字段统一使用 PostgreSQL `date` 类型（非 `timestamptz`），前端读写均使用 `YYYY-MM-DD` 字符串，严禁 `new Date()` 直接转化。

### 8.2 小项完成状态冲突

**风险**：iPad 和 Mac 同时修改同一任务的 checklistItems，后写的一方覆盖对方的小项状态。

**规避**：checklistItems 拆表后，每个小项的勾选只更新该行的 `done` 字段，而不是整体覆盖 task 对象。两台设备修改不同小项时天然不冲突。

### 8.3 软删除漏查

**风险**：云端查询漏加 `deleted_at is null` 条件，导致已删任务"诈尸"。

**规避**：`cloudRepository` 的所有 `select` 查询默认加 `.is('deleted_at', null)`；确认删除时只写 `deleted_at` 时间戳，不物理删除行。

### 8.4 单次 occurrence 状态

**风险**：重复任务的单次取消/延期状态没有迁移，导致 iPad 上看到已经取消的课程又"复活"。

**规避**：JSON 迁移时必须完整导入 `taskOccurrenceStatuses`，且 UPSERT 条件为 `(family_id, task_id, occurrence_date)` 唯一。

### 8.5 旧数据兼容

**风险**：早期 IndexedDB 数据缺少部分字段（如 `schedulePattern` 为空），上传时因 not null 约束报错。

**规避**：迁移脚本中对每个字段设置默认值降级（如 `schedulePattern ?? 'singleDate'`）；Supabase 表中尽量只在确实必填的字段上加 `not null`。

---

## 9. 环境变量配置

在项目根目录新增 `.env.local`（已在 `.gitignore` 中排除）：

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
```

> `SUPABASE_SERVICE_ROLE_KEY` 绝不能使用 `VITE_` 前缀，绝不能出现在前端代码或 Git 仓库中。

---

## 10. 整体实施阶段路线图

| 阶段   | 内容                                                   | 状态        |
|--------|--------------------------------------------------------|-------------|
| Step 1 | 生成 SQL 草案与实施说明（当前）                         | ✅ 完成     |
| Step 2 | Supabase 控制台建表 + 创建账号                          | ⬜ 待操作   |
| Step 3 | 前端安装 SDK + 初始化 supabase.ts                       | ⬜ 待开发   |
| Step 4 | 实现 cloudRepository（从云端读取，测试今日页）           | ⬜ 待开发   |
| Step 5 | JSON 备份一键迁移到 Supabase                            | ⬜ 待开发   |
| Step 6 | 实现写入（新增/编辑/删除/勾选同步到云端）               | ⬜ 待开发   |
| Step 7 | Mac + iPad 实机双端测试                                 | ⬜ 待测试   |
