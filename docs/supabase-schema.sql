-- ============================================================
-- 学习生活规划系统 · Supabase Schema
-- 第一阶段：建表 + RLS + 触发器
-- 版本：2026-06-24 (修订版 2 - 修复初始化死锁)
-- 执行方式：复制到 Supabase SQL Editor 后全选运行
-- ============================================================

-- ============================================================
-- 工具函数：updated_at 自动更新
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- 1. families
-- 一个家庭空间；所有业务数据通过 family_id 关联到此表
-- ============================================================

create table if not exists public.families (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_families_updated_at
  before update on public.families
  for each row execute function public.set_updated_at();

-- ============================================================
-- 2. profiles
-- 把 Supabase Auth 用户与 family 绑定
-- 第一阶段：一个共享账号，role = 'member'
-- ============================================================

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  family_id    uuid not null references public.families(id) on delete cascade,
  display_name text,
  role         text not null default 'member',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_profiles_family_id on public.profiles(family_id);

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ============================================================
-- 辅助函数：获取当前登录用户的 family_id
-- security definer：以函数定义者权限查询 profiles，绕过调用者 RLS
-- set search_path = public：防止 schema 污染攻击
-- stable：同一事务内结果缓存，避免重复查询
-- limit 1：防止多行返回（理论上不会，但加上更安全）
-- ============================================================

create or replace function public.get_my_family_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select family_id
  from public.profiles
  where id = auth.uid()
  limit 1
$$;

-- ============================================================
-- 3. tasks
-- 映射 IndexedDB tasks 表
-- id 使用 text 以兼容前端现有 UUID 字符串，无需重写
-- checklistItems 拆分到 task_checklist_items 表
-- 低频字段（阅读分配、分次设置等）放入 metadata jsonb
-- ============================================================

create table if not exists public.tasks (
  id                     text primary key,
  family_id              uuid not null references public.families(id) on delete cascade,
  title                  text not null default '',
  main_category          text not null,
  sub_category           text not null,
  extra_content_type     text,
  time_type              text not null,
  schedule_pattern       text,
  -- 日期字段：统一存储为 date 类型，前端按 YYYY-MM-DD 格式读写
  date                   date,
  start_date             date,
  end_date               date,
  week_start             date,
  specific_dates         date[],
  range_weekdays         integer[],
  assignment_window      jsonb,
  recurrence             jsonb,
  weekly_quota           jsonb,
  applicable_period_type text,
  plan_period_id         text,
  status                 text not null default 'todo',
  rollover_mode          text not null default 'keepOverdue',
  allow_rollover         boolean not null default false,
  calendar_visibility    text not null default 'show',
  child_visible          boolean not null default true,
  sort_order             integer not null default 0,
  start_time             text,
  end_time               text,
  estimated_minutes      integer,
  location               text,
  note                   text,
  important              boolean not null default false,
  parent_task_id         text,
  session_index          integer,
  allocation_week_start  date,
  completed_at           timestamptz,
  deleted_at             timestamptz,
  deleted_by_device      text,
  deleted_by_actor       text,
  -- 低频配置：totalAmount / amountUnit / splitCount / amountPerSession /
  -- readingTargetCount / readingTargetUnit / allowedWeekdays / allowWeekend 等
  metadata               jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists idx_tasks_family_id           on public.tasks(family_id);
create index if not exists idx_tasks_family_deleted_at   on public.tasks(family_id, deleted_at);
create index if not exists idx_tasks_family_main_category on public.tasks(family_id, main_category);
create index if not exists idx_tasks_family_dates        on public.tasks(family_id, date, start_date, end_date);
create index if not exists idx_tasks_plan_period_id      on public.tasks(family_id, plan_period_id);
create index if not exists idx_tasks_updated_at          on public.tasks(family_id, updated_at);
-- 部分索引：仅索引未删除行，加速日常查询
create index if not exists idx_tasks_active              on public.tasks(family_id) where deleted_at is null;

create trigger trg_tasks_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- ============================================================
-- 4. task_checklist_items
-- 把 Task.checklistItems[] 拆为独立表
-- 前端 mapper 可将结果重新组装回 task.checklistItems
-- ============================================================

create table if not exists public.task_checklist_items (
  id         text primary key,
  family_id  uuid not null references public.families(id) on delete cascade,
  task_id    text not null references public.tasks(id) on delete cascade,
  title      text not null default '',
  done       boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_checklist_family_task on public.task_checklist_items(family_id, task_id);

create trigger trg_checklist_updated_at
  before update on public.task_checklist_items
  for each row execute function public.set_updated_at();

-- ============================================================
-- 5. task_occurrence_statuses
-- 映射 IndexedDB taskOccurrenceStatuses 表
-- 记录重复任务中某一次 occurrence 的单次覆盖状态
-- ============================================================

create table if not exists public.task_occurrence_statuses (
  id              text primary key,
  family_id       uuid not null references public.families(id) on delete cascade,
  task_id         text not null references public.tasks(id) on delete cascade,
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

create index if not exists idx_occurrences_family_task_date on public.task_occurrence_statuses(family_id, task_id, occurrence_date);
create index if not exists idx_occurrence_family_date       on public.task_occurrence_statuses(family_id, occurrence_date);

create trigger trg_occurrence_updated_at
  before update on public.task_occurrence_statuses
  for each row execute function public.set_updated_at();

-- ============================================================
-- 6. plan_periods
-- 映射假期设置
-- ============================================================

create table if not exists public.plan_periods (
  id         text primary key,
  family_id  uuid not null references public.families(id) on delete cascade,
  name       text not null,
  type       text not null default 'holiday',
  start_date date not null,
  end_date   date not null,
  is_active  boolean not null default true,
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_plan_periods_family_type on public.plan_periods(family_id, type);

create trigger trg_plan_periods_updated_at
  before update on public.plan_periods
  for each row execute function public.set_updated_at();

-- ============================================================
-- 7. activity_logs
-- 操作审计日志，只追加不覆盖
-- ============================================================

create table if not exists public.activity_logs (
  id              text primary key,
  family_id       uuid not null references public.families(id) on delete cascade,
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
  -- 日志只追加，不需要 updated_at 和 trigger
);

create index if not exists idx_activity_logs_family_created_at on public.activity_logs(family_id, created_at desc);

-- ============================================================
-- 8. app_settings
-- 跨设备同步设置（第一阶段可暂时不写入，保留表结构）
-- ============================================================

create table if not exists public.app_settings (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families(id) on delete cascade,
  key        text not null,
  value      jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, key)
);

create index if not exists idx_app_settings_family_id on public.app_settings(family_id);

create trigger trg_app_settings_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

-- ============================================================
-- RLS：开启行级安全
-- ============================================================

-- ----------------------------------------------------------------
-- families
--
-- INSERT：任何已登录用户都可以创建一个 family。
--   第一阶段不在 SQL 层限制只建一个；由应用层（前端登录后检查
--   是否已有 family，若有则不重复创建）来保证。
--   不能在此处调用 get_my_family_id()，因为此时 profile 尚不存在。
--
-- SELECT / UPDATE / DELETE：只能访问自己 profile 绑定的 family。
-- ----------------------------------------------------------------
alter table public.families enable row level security;

create policy "families_select" on public.families
  for select using (id = public.get_my_family_id());

create policy "families_insert" on public.families
  for insert with check (auth.uid() is not null);

create policy "families_update" on public.families
  for update using (id = public.get_my_family_id());

create policy "families_delete" on public.families
  for delete using (id = public.get_my_family_id());

-- ----------------------------------------------------------------
-- profiles
--
-- 第一阶段只使用一个共享家庭账号，不需要同 family 成员互查。
-- 所有策略只允许用户访问自己的行 (id = auth.uid())。
-- 不调用 get_my_family_id()，避免查询 profiles 时产生递归。
--
-- INSERT 流程：
--   1. 用户登录后，前端先调用 families INSERT 创建 family；
--   2. 获取 family.id；
--   3. 再调用 profiles INSERT 创建自己的 profile；
--   4. 之后 get_my_family_id() 即可正常工作。
-- ----------------------------------------------------------------
alter table public.profiles enable row level security;

create policy "profiles_select" on public.profiles
  for select using (id = auth.uid());

create policy "profiles_insert" on public.profiles
  for insert with check (id = auth.uid());

create policy "profiles_update" on public.profiles
  for update
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "profiles_delete" on public.profiles
  for delete using (id = auth.uid());

-- ----------------------------------------------------------------
-- tasks
-- ----------------------------------------------------------------
alter table public.tasks enable row level security;

create policy "tasks_select" on public.tasks
  for select using (family_id = public.get_my_family_id());

create policy "tasks_insert" on public.tasks
  for insert with check (family_id = public.get_my_family_id());

create policy "tasks_update" on public.tasks
  for update using (family_id = public.get_my_family_id());

create policy "tasks_delete" on public.tasks
  for delete using (family_id = public.get_my_family_id());

-- ----------------------------------------------------------------
-- task_checklist_items
-- ----------------------------------------------------------------
alter table public.task_checklist_items enable row level security;

create policy "checklist_select" on public.task_checklist_items
  for select using (family_id = public.get_my_family_id());

create policy "checklist_insert" on public.task_checklist_items
  for insert with check (family_id = public.get_my_family_id());

create policy "checklist_update" on public.task_checklist_items
  for update using (family_id = public.get_my_family_id());

create policy "checklist_delete" on public.task_checklist_items
  for delete using (family_id = public.get_my_family_id());

-- ----------------------------------------------------------------
-- task_occurrence_statuses
-- ----------------------------------------------------------------
alter table public.task_occurrence_statuses enable row level security;

create policy "occurrence_select" on public.task_occurrence_statuses
  for select using (family_id = public.get_my_family_id());

create policy "occurrence_insert" on public.task_occurrence_statuses
  for insert with check (family_id = public.get_my_family_id());

create policy "occurrence_update" on public.task_occurrence_statuses
  for update using (family_id = public.get_my_family_id());

create policy "occurrence_delete" on public.task_occurrence_statuses
  for delete using (family_id = public.get_my_family_id());

-- ----------------------------------------------------------------
-- plan_periods
-- ----------------------------------------------------------------
alter table public.plan_periods enable row level security;

create policy "plan_periods_select" on public.plan_periods
  for select using (family_id = public.get_my_family_id());

create policy "plan_periods_insert" on public.plan_periods
  for insert with check (family_id = public.get_my_family_id());

create policy "plan_periods_update" on public.plan_periods
  for update using (family_id = public.get_my_family_id());

create policy "plan_periods_delete" on public.plan_periods
  for delete using (family_id = public.get_my_family_id());

-- ----------------------------------------------------------------
-- activity_logs：只追加，不允许 update / delete
-- ----------------------------------------------------------------
alter table public.activity_logs enable row level security;

create policy "activity_logs_select" on public.activity_logs
  for select using (family_id = public.get_my_family_id());

create policy "activity_logs_insert" on public.activity_logs
  for insert with check (family_id = public.get_my_family_id());

-- ----------------------------------------------------------------
-- app_settings
-- ----------------------------------------------------------------
alter table public.app_settings enable row level security;

create policy "app_settings_select" on public.app_settings
  for select using (family_id = public.get_my_family_id());

create policy "app_settings_insert" on public.app_settings
  for insert with check (family_id = public.get_my_family_id());

create policy "app_settings_update" on public.app_settings
  for update using (family_id = public.get_my_family_id());

create policy "app_settings_delete" on public.app_settings
  for delete using (family_id = public.get_my_family_id());

-- ============================================================
-- 权限配置：授权 authenticated 角色读写业务表
-- （第一阶段在应用层通过 anon key 访问，需要基础 CRUD 权限）
-- ============================================================

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on table public.families to authenticated;
grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.tasks to authenticated;
grant select, insert, update, delete on table public.task_checklist_items to authenticated;
grant select, insert, update, delete on table public.task_occurrence_statuses to authenticated;
grant select, insert, update, delete on table public.plan_periods to authenticated;
grant select, insert, update, delete on table public.app_settings to authenticated;

grant select, insert on table public.activity_logs to authenticated;

grant execute on function public.get_my_family_id() to authenticated;

-- ============================================================
-- END OF SCHEMA
-- ============================================================
