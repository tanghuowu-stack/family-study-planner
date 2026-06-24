-- ============================================================
-- 学习生活规划系统 · Supabase Schema
-- 第一阶段：建表 + RLS + 触发器
-- 版本：2026-06-24
-- 执行方式：复制到 Supabase SQL Editor 后全选运行
-- ============================================================

-- ============================================================
-- 工具函数：updated_at 自动更新
-- ============================================================

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================
-- 1. families
-- 一个家庭空间；所有业务数据通过 family_id 关联到此表
-- ============================================================

create table if not exists families (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_families_updated_at
  before update on families
  for each row execute function set_updated_at();

-- ============================================================
-- 2. profiles
-- 把 Supabase Auth 用户与 family 绑定
-- 第一阶段：一个共享账号，role = 'member'
-- ============================================================

create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  family_id    uuid not null references families(id) on delete cascade,
  display_name text,
  role         text not null default 'member',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_profiles_family_id on profiles(family_id);

create trigger trg_profiles_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- ============================================================
-- 3. tasks
-- 映射 IndexedDB tasks 表
-- id 使用 text 以兼容前端现有 UUID 字符串，无需重写
-- checklistItems 拆分到 task_checklist_items 表
-- 低频字段（阅读分配、分次设置等）放入 metadata jsonb
-- ============================================================

create table if not exists tasks (
  id                    text primary key,
  family_id             uuid not null references families(id) on delete cascade,
  title                 text not null default '',
  main_category         text not null,
  sub_category          text not null,
  extra_content_type    text,
  time_type             text not null,
  schedule_pattern      text,
  -- 日期字段：统一存储为 date 类型，前端按 YYYY-MM-DD 格式读写
  date                  date,
  start_date            date,
  end_date              date,
  week_start            date,
  specific_dates        date[],
  range_weekdays        integer[],
  assignment_window     jsonb,
  recurrence            jsonb,
  weekly_quota          jsonb,
  applicable_period_type text,
  plan_period_id        text,
  status                text not null default 'todo',
  rollover_mode         text not null default 'keepOverdue',
  allow_rollover        boolean not null default false,
  calendar_visibility   text not null default 'show',
  child_visible         boolean not null default true,
  sort_order            integer not null default 0,
  start_time            text,
  end_time              text,
  estimated_minutes     integer,
  location              text,
  note                  text,
  important             boolean not null default false,
  parent_task_id        text,
  session_index         integer,
  allocation_week_start date,
  completed_at          timestamptz,
  deleted_at            timestamptz,
  deleted_by_device     text,
  deleted_by_actor      text,
  -- 低频配置：totalAmount / amountUnit / splitCount / amountPerSession /
  -- readingTargetCount / readingTargetUnit / allowedWeekdays / allowWeekend 等
  metadata              jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_tasks_family_id        on tasks(family_id);
create index if not exists idx_tasks_plan_period_id   on tasks(family_id, plan_period_id);
create index if not exists idx_tasks_date             on tasks(family_id, date);
create index if not exists idx_tasks_updated_at       on tasks(family_id, updated_at);
create index if not exists idx_tasks_deleted_at       on tasks(family_id, deleted_at) where deleted_at is null;

create trigger trg_tasks_updated_at
  before update on tasks
  for each row execute function set_updated_at();

-- ============================================================
-- 4. task_checklist_items
-- 把 Task.checklistItems[] 拆为独立表
-- 前端 mapper 可将结果重新组装回 task.checklistItems
-- ============================================================

create table if not exists task_checklist_items (
  id         text primary key,
  family_id  uuid not null references families(id) on delete cascade,
  task_id    text not null references tasks(id) on delete cascade,
  title      text not null default '',
  done       boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_checklist_task_id   on task_checklist_items(task_id);
create index if not exists idx_checklist_family_id on task_checklist_items(family_id);

create trigger trg_checklist_updated_at
  before update on task_checklist_items
  for each row execute function set_updated_at();

-- ============================================================
-- 5. task_occurrence_statuses
-- 映射 IndexedDB taskOccurrenceStatuses 表
-- 记录重复任务中某一次 occurrence 的单次覆盖状态
-- ============================================================

create table if not exists task_occurrence_statuses (
  id              text primary key,
  family_id       uuid not null references families(id) on delete cascade,
  task_id         text not null references tasks(id) on delete cascade,
  occurrence_date date not null,
  status          text not null,
  override_date   date,
  override_title  text,
  override_note   text,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (family_id, task_id, occurrence_date)
);

create index if not exists idx_occurrence_task_id         on task_occurrence_statuses(task_id);
create index if not exists idx_occurrence_family_date     on task_occurrence_statuses(family_id, occurrence_date);

create trigger trg_occurrence_updated_at
  before update on task_occurrence_statuses
  for each row execute function set_updated_at();

-- ============================================================
-- 6. plan_periods
-- 映射假期设置
-- ============================================================

create table if not exists plan_periods (
  id         text primary key,
  family_id  uuid not null references families(id) on delete cascade,
  name       text not null,
  type       text not null default 'holiday',
  start_date date not null,
  end_date   date not null,
  is_active  boolean not null default true,
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_plan_periods_family_id on plan_periods(family_id);

create trigger trg_plan_periods_updated_at
  before update on plan_periods
  for each row execute function set_updated_at();

-- ============================================================
-- 7. activity_logs
-- 操作审计日志，只追加不覆盖
-- ============================================================

create table if not exists activity_logs (
  id              text primary key,
  family_id       uuid not null references families(id) on delete cascade,
  action_type     text not null,
  entity_type     text,
  entity_id       text,
  entity_title    text,
  before_snapshot jsonb,
  after_snapshot  jsonb,
  actor_name      text,
  device_type     text,
  device_label    text,
  browser         text,
  created_at      timestamptz not null default now()
  -- 日志不更新，不需要 updated_at 和 trigger
);

create index if not exists idx_activity_logs_family_id  on activity_logs(family_id);
create index if not exists idx_activity_logs_created_at on activity_logs(family_id, created_at desc);

-- ============================================================
-- 8. app_settings
-- 跨设备同步设置（第一阶段可暂时不写入，保留表结构）
-- ============================================================

create table if not exists app_settings (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references families(id) on delete cascade,
  key        text not null,
  value      jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, key)
);

create index if not exists idx_app_settings_family_id on app_settings(family_id);

create trigger trg_app_settings_updated_at
  before update on app_settings
  for each row execute function set_updated_at();

-- ============================================================
-- RLS：开启行级安全
-- 所有业务表：登录用户只能访问自己 family_id 的数据
-- 判断方式：通过 profiles 表确认 auth.uid() 与 family_id 的绑定
-- ============================================================

-- 辅助函数：获取当前用户的 family_id（避免 RLS 每行重复 subquery）
create or replace function get_my_family_id()
returns uuid as $$
  select family_id from profiles where id = auth.uid()
$$ language sql security definer stable;

-- ----------------------------------------------------------------
-- families：只能访问自己所属的 family
-- ----------------------------------------------------------------
alter table families enable row level security;

create policy "families_select" on families
  for select using (id = get_my_family_id());

create policy "families_insert" on families
  for insert with check (id = get_my_family_id());

create policy "families_update" on families
  for update using (id = get_my_family_id());

create policy "families_delete" on families
  for delete using (id = get_my_family_id());

-- ----------------------------------------------------------------
-- profiles：只能读写自己的 profile
-- ----------------------------------------------------------------
alter table profiles enable row level security;

create policy "profiles_select" on profiles
  for select using (id = auth.uid() or family_id = get_my_family_id());

create policy "profiles_insert" on profiles
  for insert with check (id = auth.uid());

create policy "profiles_update" on profiles
  for update using (id = auth.uid());

create policy "profiles_delete" on profiles
  for delete using (id = auth.uid());

-- ----------------------------------------------------------------
-- tasks
-- ----------------------------------------------------------------
alter table tasks enable row level security;

create policy "tasks_select" on tasks
  for select using (family_id = get_my_family_id());

create policy "tasks_insert" on tasks
  for insert with check (family_id = get_my_family_id());

create policy "tasks_update" on tasks
  for update using (family_id = get_my_family_id());

create policy "tasks_delete" on tasks
  for delete using (family_id = get_my_family_id());

-- ----------------------------------------------------------------
-- task_checklist_items
-- ----------------------------------------------------------------
alter table task_checklist_items enable row level security;

create policy "checklist_select" on task_checklist_items
  for select using (family_id = get_my_family_id());

create policy "checklist_insert" on task_checklist_items
  for insert with check (family_id = get_my_family_id());

create policy "checklist_update" on task_checklist_items
  for update using (family_id = get_my_family_id());

create policy "checklist_delete" on task_checklist_items
  for delete using (family_id = get_my_family_id());

-- ----------------------------------------------------------------
-- task_occurrence_statuses
-- ----------------------------------------------------------------
alter table task_occurrence_statuses enable row level security;

create policy "occurrence_select" on task_occurrence_statuses
  for select using (family_id = get_my_family_id());

create policy "occurrence_insert" on task_occurrence_statuses
  for insert with check (family_id = get_my_family_id());

create policy "occurrence_update" on task_occurrence_statuses
  for update using (family_id = get_my_family_id());

create policy "occurrence_delete" on task_occurrence_statuses
  for delete using (family_id = get_my_family_id());

-- ----------------------------------------------------------------
-- plan_periods
-- ----------------------------------------------------------------
alter table plan_periods enable row level security;

create policy "plan_periods_select" on plan_periods
  for select using (family_id = get_my_family_id());

create policy "plan_periods_insert" on plan_periods
  for insert with check (family_id = get_my_family_id());

create policy "plan_periods_update" on plan_periods
  for update using (family_id = get_my_family_id());

create policy "plan_periods_delete" on plan_periods
  for delete using (family_id = get_my_family_id());

-- ----------------------------------------------------------------
-- activity_logs（只追加，不允许 update / delete）
-- ----------------------------------------------------------------
alter table activity_logs enable row level security;

create policy "activity_logs_select" on activity_logs
  for select using (family_id = get_my_family_id());

create policy "activity_logs_insert" on activity_logs
  for insert with check (family_id = get_my_family_id());

-- ----------------------------------------------------------------
-- app_settings
-- ----------------------------------------------------------------
alter table app_settings enable row level security;

create policy "app_settings_select" on app_settings
  for select using (family_id = get_my_family_id());

create policy "app_settings_insert" on app_settings
  for insert with check (family_id = get_my_family_id());

create policy "app_settings_update" on app_settings
  for update using (family_id = get_my_family_id());

create policy "app_settings_delete" on app_settings
  for delete using (family_id = get_my_family_id());

-- ============================================================
-- END OF SCHEMA
-- ============================================================
