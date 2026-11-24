-- ============================================================
-- 迁移：记账（TASK_10）· 新表 ledger_entries
-- 在已存在的 family-study-cloud 库上增量执行。
-- 执行方式：复制到 Supabase SQL Editor 全选运行一次。
--
-- 背景：
-- 1. 积分改成零花钱以后新增"记账"页。孩子在 iPad 上记、家长在 Mac 上记，两边会同时写，
--    不能整包存进 app_settings 的一个 jsonb（整包 last-write-wins 会互相覆盖），
--    所以每条记录一行，带 updated_at / deleted_at，走现有的 LWW 同步和软删除（ARCHITECTURE_RULES R5）。
-- 2. 金额存"分"（amount_cents，整数），界面显示成元、两位小数，避免小数误差。
-- 3. 余额不存，由记录算出。练习奖励、利息的记录 id 固定（allowance-周一 / interest-月份），
--    两台设备同时点"已转账"也只有一条。
--
-- 现网：新表，现网没有。本文件可以重复执行（if not exists / drop ... if exists），
--       不改任何现有表，不改任何现有数据。
-- 月利率等设置存 app_settings（key = 'ledger_settings_v1'），复用现有表，无需迁移。
-- ============================================================

-- 1. ledger_entries 表 ------------------------------------------
create table if not exists public.ledger_entries (
  id           text primary key,                       -- 前端字符串 id（uuid，或 allowance-2026-11-23 / interest-2026-12 / opening-cash）
  family_id    uuid not null references public.families(id) on delete cascade,
  entry_date   date not null,                          -- 记在哪天，只存 YYYY-MM-DD
  type         text not null
               check (type in ('allowance', 'expense', 'deposit', 'withdraw', 'interest', 'opening', 'adjust')),
  account      text check (account in ('cash', 'savings')),   -- 只有期初余额 / 对账调整填：零钱 cash / 存款 savings
  amount_cents integer not null,                       -- 金额（分）。对账调整可正可负，其余为正
  content      text,                                   -- 支出内容 / 调整原因 / 利息算法
  category     text,                                   -- 支出分类：吃的 文具 书 玩具 礼物 其他
  ref_key      text,                                   -- 练习奖励：那周周一；利息：月份 YYYY-MM
  created_by   text not null default 'child' check (created_by in ('child', 'parent')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz                             -- 软删除
);

create index if not exists idx_ledger_entries_family_date on public.ledger_entries(family_id, entry_date);

drop trigger if exists trg_ledger_entries_updated_at on public.ledger_entries;
create trigger trg_ledger_entries_updated_at
  before update on public.ledger_entries
  for each row execute function public.set_updated_at();

-- 2. RLS：与其他业务表一致，走 get_my_family_id() ----------------
alter table public.ledger_entries enable row level security;

drop policy if exists "ledger_entries_select" on public.ledger_entries;
create policy "ledger_entries_select" on public.ledger_entries
  for select using (family_id = public.get_my_family_id());

drop policy if exists "ledger_entries_insert" on public.ledger_entries;
create policy "ledger_entries_insert" on public.ledger_entries
  for insert with check (family_id = public.get_my_family_id());

drop policy if exists "ledger_entries_update" on public.ledger_entries;
create policy "ledger_entries_update" on public.ledger_entries
  for update using (family_id = public.get_my_family_id())
  with check (family_id = public.get_my_family_id());

drop policy if exists "ledger_entries_delete" on public.ledger_entries;
create policy "ledger_entries_delete" on public.ledger_entries
  for delete using (family_id = public.get_my_family_id());

-- 3. 授权 authenticated 角色 ------------------------------------
grant select, insert, update, delete on table public.ledger_entries to authenticated;

-- 4. 加入 realtime publication（多端同步；已加入则跳过）---------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ledger_entries'
  ) then
    alter publication supabase_realtime add table public.ledger_entries;
  end if;
end
$$;

-- 5. 执行后自查（可选）：应返回 1 行
-- select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'ledger_entries';
