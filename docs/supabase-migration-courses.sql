-- ============================================================
-- 迁移：课程库（TASK_02）
-- 在已存在的 family-study-cloud 库上增量执行。
-- 执行方式：复制到 Supabase SQL Editor 全选运行一次。
-- 之后到 Database → Replication 把 courses 勾进 realtime publication
-- （或运行本文件末尾被注释的 alter publication 语句）。
-- ============================================================

-- 1. courses 表 -------------------------------------------------
create table if not exists public.courses (
  id                 text primary key,            -- 前端字符串 id，与 plan_periods 一致
  family_id          uuid not null references public.families(id) on delete cascade,
  name               text not null,
  main_category      text not null,               -- 'extraHomework' | 'interestClass'
  sub_category       text not null,               -- chinese/math/english/other 或 piano/swimming/...
  extra_content_type text,                         -- 课外课程默认 'class'
  is_class           boolean not null default true,
  status             text not null default 'active',  -- active 进行中 / ended 已结课 / planned 计划中
  start_date         date,                         -- 铁律2：只存 YYYY-MM-DD 或 null
  end_date           date,                         -- null = 长期
  schedule           jsonb,                        -- {weekdays:[2], startTime, endTime}
  sort_order         integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_courses_family_id     on public.courses(family_id);
create index if not exists idx_courses_family_status on public.courses(family_id, status);

create trigger trg_courses_updated_at
  before update on public.courses
  for each row execute function public.set_updated_at();

-- 2. tasks 增加可选 course_id -----------------------------------
-- 删除课程时置空，保留历史任务（铁律3 之外的关联清理由 FK 完成）
alter table public.tasks
  add column if not exists course_id text references public.courses(id) on delete set null;

create index if not exists idx_tasks_course_id on public.tasks(family_id, course_id);

-- 3. RLS：与其他业务表一致，走 get_my_family_id() ----------------
alter table public.courses enable row level security;

create policy "courses_select" on public.courses
  for select using (family_id = public.get_my_family_id());

create policy "courses_insert" on public.courses
  for insert with check (family_id = public.get_my_family_id());

create policy "courses_update" on public.courses
  for update using (family_id = public.get_my_family_id());

create policy "courses_delete" on public.courses
  for delete using (family_id = public.get_my_family_id());

-- 4. 授权 authenticated 角色 ------------------------------------
grant select, insert, update, delete on table public.courses to authenticated;

-- 5. 加入 realtime publication（多端同步）-----------------------
-- 优先用 Dashboard：Database → Replication → 勾选 courses。
-- 或取消下一行注释直接执行：
-- alter publication supabase_realtime add table public.courses;
