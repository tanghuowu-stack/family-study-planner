# Vercel / Supabase 云端迁移方案（准备稿）

> 本文只做部署与数据结构准备。当前版本仍完全使用浏览器 IndexedDB，不连接 Supabase，也不包含任何真实密钥。

## 1. 当前本地架构

- 前端：React + Vite + TypeScript，静态资源可直接部署到 Vercel。
- 本地数据库：Dexie 封装的 IndexedDB，数据库名 `familyLearningPlanner`，当前 schema 版本 6。
- 数据表：`tasks`、`taskOccurrenceStatuses`、`planPeriods`、`activityLogs`。
- 设备设置：本机名称保存在 `localStorage` 的 `familyPlanner.deviceLabel`。
- 删除策略：任务使用 `deletedAt`、`deletedByDevice`、`deletedByActor` 软删除；各业务视图默认过滤已删除数据。
- 备份：JSON v6，包含任务、单次状态、假期和操作日志。

## 2. Supabase 表结构草案

所有主键建议使用 `uuid`，时间字段用 `timestamptz`，业务日期用 `date`。每张业务表建议增加 `family_id`，为后续家庭成员共享与 RLS 做准备。

### tasks

保存任务父记录及排期规则。核心字段对应当前 `Task`：

- `id uuid primary key`
- `family_id uuid not null`
- `title text not null`
- `main_category text not null`
- `sub_category text not null`
- `extra_content_type text`
- `time_type text not null`
- `schedule_pattern text`
- `date date`、`start_date date`、`end_date date`、`week_start date`
- `specific_dates date[]`
- `recurrence jsonb`
- `weekly_quota jsonb`
- `applicable_period_type text`
- `plan_period_id uuid`
- `status text not null`
- `rollover_mode text not null`
- `calendar_visibility text`
- `start_time time`、`end_time time`、`estimated_minutes integer`
- `parent_task_id uuid`
- `completed_at timestamptz`
- `deleted_at timestamptz`、`deleted_by_device text`、`deleted_by_actor text`
- `created_at timestamptz`、`updated_at timestamptz`

其余低频配置（阅读分配、地点、备注、排序等）可先按独立列映射，也可在第一阶段放入 `metadata jsonb`，稳定后再拆列。

### task_checklist_items

- `id uuid primary key`
- `task_id uuid references tasks(id)`
- `title text not null`
- `done boolean not null default false`
- `sort_order integer`
- `created_at timestamptz`、`updated_at timestamptz`

当前 IndexedDB 中 `checklistItems[]` 在迁移时拆成多行。

### task_occurrence_statuses

- `id text primary key`（可继续使用 `taskId:occurrenceDate`，或改 uuid + 唯一索引）
- `task_id uuid references tasks(id)`
- `occurrence_date date not null`
- `status text not null`
- `override_date date`
- `override_title text`、`override_note text`
- `created_at timestamptz`、`updated_at timestamptz`
- unique (`task_id`, `occurrence_date`)

### plan_periods

云端 UI 只新增假期；旧 `regular/custom` 数据迁移后仍可保留兼容。

- `id uuid primary key`
- `family_id uuid not null`
- `name text not null`
- `type text not null default 'holiday'`
- `start_date date not null`、`end_date date not null`
- `is_active boolean not null default true`
- `note text`
- `created_at timestamptz`、`updated_at timestamptz`

### activity_logs

- `id uuid primary key`
- `family_id uuid`
- `action_type text not null`
- `entity_type text not null`
- `entity_id text`
- `entity_title text`
- `before_snapshot jsonb`、`after_snapshot jsonb`
- `actor_name text`
- `device_type text`、`device_label text`、`browser text`
- `created_at timestamptz not null`

日志建议只追加、不覆盖；删除任务时仍保留快照。

### app_settings

- `id uuid primary key`
- `family_id uuid not null`
- `key text not null`
- `value jsonb not null`
- `device_id text`
- `updated_at timestamptz`
- unique (`family_id`, `key`, `device_id`)

本机名称可继续留在 localStorage；需要跨设备同步的设置再写入此表。

## 3. 当前字段映射

TypeScript 驼峰字段映射为数据库 snake_case，例如：

- `mainCategory` → `main_category`
- `extraContentType` → `extra_content_type`
- `specificDates` → `specific_dates`
- `weeklyQuota` → `weekly_quota`
- `calendarVisibility` → `calendar_visibility`
- `estimatedMinutes` → `estimated_minutes`
- `deletedAt` → `deleted_at`

应用层保留现有 `Task` 类型，通过 mapper 在 Supabase 行与前端对象之间转换，避免重写页面。

## 4. 同步与冲突策略

1. 每条记录依赖 `updated_at` 做增量拉取。
2. 删除只写 `deleted_at`，所有查询默认 `deleted_at is null`。
3. 同一任务发生冲突时，第一阶段可使用“最后写入优先”，但必须把前后快照写入 `activity_logs`。
4. 单次课程状态以 (`task_id`, `occurrence_date`) 唯一，避免重复取消记录。
5. 每台设备生成稳定 `device_id`，日志额外保存用户可读的 `device_label`。
6. 离线写入先留在 IndexedDB 的待同步队列，恢复网络后重试；Supabase 成功确认后再清队列。

## 5. Vercel 环境变量

未来接入时只需要公开的前端连接信息：

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
```

如增加服务端函数，再由 Vercel Serverless Function 使用服务端变量；`SUPABASE_SERVICE_ROLE_KEY` 绝不能使用 `VITE_` 前缀，也绝不能进入浏览器代码或提交到 Git。

建议新增 `.env.example` 时只放占位符。当前 `.gitignore` 已排除 `.env`、`.env.local`、`node_modules` 和 `dist`。

## 6. 分阶段迁移

### 阶段 A：部署静态前端

- Vercel 构建命令：`npm run build`
- 输出目录：`dist`
- 此阶段线上每个浏览器仍各自使用 IndexedDB。

### 阶段 B：只读云端试运行

- 建立 Supabase 表、索引、RLS 和家庭成员身份。
- 增加 mapper 与只读查询，不替换现有本地写入。
- 用匿名测试项目校验日期、重复任务、软删除与日志映射。

### 阶段 C：首次数据迁移

- 用户先导出 JSON v6。
- 迁移工具校验版本、去重 ID，再按父任务、清单小项、occurrence、假期、日志顺序上传。
- 完成后对比各表数量、阅读周目标与已取消 occurrence。

### 阶段 D：双写与离线同步

- 本地写入成功后进入同步队列，同时写 Supabase。
- 监控失败重试、冲突与设备日志。
- 稳定期内保留 JSON 导入导出作为兜底。

### 阶段 E：云端为主

- 登录后以 Supabase 为权威数据源，IndexedDB 作为离线缓存。
- 开启家庭级 RLS、邀请成员、恢复站与审计日志。
- 迁移完成并观察稳定后，才考虑移除旧 schema 兼容代码。

## 7. 上线前检查

- RLS 确保用户只能访问自己家庭的数据。
- 服务端密钥不出现在前端包、日志、截图或仓库中。
- 软删除、恢复和批量删除都有审计记录。
- 月历/今日/打印统一排除 `deleted_at`，单次取消统一读取 occurrence 状态。
- 时区统一按家庭设置解释日期，数据库时间戳使用 UTC。
- 在测试项目完整演练 JSON 导入、回滚和重复导入。
