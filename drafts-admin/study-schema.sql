-- Additive migration for the private Study Space. Run after schema.sql.
-- Existing Markdown drafts and their owner remain unchanged.

create table if not exists public.study_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  name text not null check (char_length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists study_plans_owner_name_active_idx
  on public.study_plans (owner_id, lower(name)) where deleted_at is null;
create index if not exists study_plans_owner_updated_idx
  on public.study_plans (owner_id, updated_at desc);

create table if not exists public.study_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  plan_id uuid references public.study_plans(id) on delete set null,
  title text not null check (char_length(trim(title)) between 1 and 160),
  scheduled_on date not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists study_tasks_owner_date_idx
  on public.study_tasks (owner_id, scheduled_on) where deleted_at is null;
create index if not exists study_tasks_plan_idx
  on public.study_tasks (plan_id) where deleted_at is null;

create table if not exists public.leetcode_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  title text not null check (char_length(trim(title)) between 1 and 160),
  url text not null default '',
  topic text not null default '',
  status text not null default 'todo' check (status in ('todo', 'solved', 'review')),
  studied_on date not null,
  solution_md text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists leetcode_records_owner_date_idx
  on public.leetcode_records (owner_id, studied_on desc) where deleted_at is null;

alter table public.study_plans enable row level security;
alter table public.study_tasks enable row level security;
alter table public.leetcode_records enable row level security;
revoke all on public.study_plans, public.study_tasks, public.leetcode_records from public, anon, authenticated;
grant select, insert, update, delete on public.study_plans, public.study_tasks, public.leetcode_records to authenticated;

drop policy if exists "sole owner manages study plans" on public.study_plans;
create policy "sole owner manages study plans" on public.study_plans for all to authenticated
  using (owner_id = (select auth.uid()) and (select private.is_draft_owner()))
  with check (owner_id = (select auth.uid()) and (select private.is_draft_owner()));
drop policy if exists "sole owner manages study tasks" on public.study_tasks;
create policy "sole owner manages study tasks" on public.study_tasks for all to authenticated
  using (owner_id = (select auth.uid()) and (select private.is_draft_owner()))
  with check (owner_id = (select auth.uid()) and (select private.is_draft_owner())
    and (plan_id is null or exists (
      select 1 from public.study_plans
      where id = plan_id and owner_id = (select auth.uid()) and deleted_at is null
    )));
drop policy if exists "sole owner manages leetcode records" on public.leetcode_records;
create policy "sole owner manages leetcode records" on public.leetcode_records for all to authenticated
  using (owner_id = (select auth.uid()) and (select private.is_draft_owner()))
  with check (owner_id = (select auth.uid()) and (select private.is_draft_owner()));

create or replace function private.touch_study_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists study_plans_touch_updated_at on public.study_plans;
create trigger study_plans_touch_updated_at before update on public.study_plans
for each row execute function private.touch_study_updated_at();
drop trigger if exists study_tasks_touch_updated_at on public.study_tasks;
create trigger study_tasks_touch_updated_at before update on public.study_tasks
for each row execute function private.touch_study_updated_at();
drop trigger if exists leetcode_records_touch_updated_at on public.leetcode_records;
create trigger leetcode_records_touch_updated_at before update on public.leetcode_records
for each row execute function private.touch_study_updated_at();

-- One transaction removes a plan while retaining its tasks as uncategorized.
create or replace function public.delete_study_plan(plan_uuid uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.study_tasks
     set plan_id = null
   where plan_id = plan_uuid and owner_id = (select auth.uid()) and deleted_at is null;
  update public.study_plans
     set deleted_at = now()
   where id = plan_uuid and owner_id = (select auth.uid()) and deleted_at is null;
  if not found then
    raise exception 'study plan not found';
  end if;
end;
$$;
revoke all on function public.delete_study_plan(uuid) from public, anon;
grant execute on function public.delete_study_plan(uuid) to authenticated;

notify pgrst, 'reload schema';
