-- Run once in the Supabase SQL Editor or with psql before creating the owner.
create schema if not exists private;

create table if not exists private.draft_owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id)
);
revoke all on schema private from public, anon, authenticated;
revoke all on private.draft_owner from public, anon, authenticated;

create or replace function private.is_draft_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.draft_owner
    where user_id = (select auth.uid())
  );
$$;
revoke all on function private.is_draft_owner() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_draft_owner() to authenticated;

create or replace function public.can_access_drafts()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_draft_owner();
$$;
revoke all on function public.can_access_drafts() from public, anon;
grant execute on function public.can_access_drafts() to authenticated;

-- Only a server holding the service-role key can register the sole owner.
create or replace function public.set_draft_owner(owner_uuid uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required';
  end if;
  insert into private.draft_owner (singleton, user_id)
  values (true, owner_uuid)
  on conflict (singleton) do update set user_id = excluded.user_id;
end;
$$;
revoke all on function public.set_draft_owner(uuid) from public, anon, authenticated;
grant execute on function public.set_draft_owner(uuid) to service_role;

create table if not exists public.drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  kind text not null default 'article' check (kind in ('article', 'note')),
  title text not null default '未命名草稿',
  summary text not null default '',
  tags text[] not null default '{}',
  body jsonb not null default '[]'::jsonb check (jsonb_typeof(body) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists drafts_owner_updated_idx on public.drafts (owner_id, updated_at desc);
alter table public.drafts enable row level security;
revoke all on public.drafts from public, anon, authenticated;
grant select, insert, update, delete on public.drafts to authenticated;

create policy "owner reads drafts" on public.drafts for select to authenticated
using (owner_id = (select auth.uid()) and (select private.is_draft_owner()));
create policy "owner creates drafts" on public.drafts for insert to authenticated
with check (owner_id = (select auth.uid()) and (select private.is_draft_owner()));
create policy "owner edits drafts" on public.drafts for update to authenticated
using (owner_id = (select auth.uid()) and (select private.is_draft_owner()))
with check (owner_id = (select auth.uid()) and (select private.is_draft_owner()));
create policy "owner deletes drafts" on public.drafts for delete to authenticated
using (owner_id = (select auth.uid()) and (select private.is_draft_owner()));

create table if not exists public.draft_revisions (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.drafts(id) on delete cascade,
  owner_id uuid not null references auth.users(id),
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists draft_revisions_draft_created_idx on public.draft_revisions (draft_id, created_at desc);
alter table public.draft_revisions enable row level security;
revoke all on public.draft_revisions from public, anon, authenticated;
grant select on public.draft_revisions to authenticated;
create policy "owner reads revisions" on public.draft_revisions for select to authenticated
using (owner_id = (select auth.uid()) and (select private.is_draft_owner()));

create or replace function private.track_draft_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if (old.title, old.kind, old.summary, old.tags, old.body) is distinct from
     (new.title, new.kind, new.summary, new.tags, new.body)
     and not exists (
       select 1 from public.draft_revisions
       where draft_id = old.id and created_at > now() - interval '5 minutes'
     ) then
    insert into public.draft_revisions (draft_id, owner_id, snapshot)
    values (old.id, old.owner_id, jsonb_build_object(
      'title', old.title, 'kind', old.kind, 'summary', old.summary,
      'tags', old.tags, 'body', old.body
    ));
  end if;
  return new;
end;
$$;
create trigger drafts_track_update before update on public.drafts
for each row execute function private.track_draft_update();

insert into storage.buckets (id, name, public, file_size_limit)
values ('draft-assets', 'draft-assets', false, 26214400)
on conflict (id) do nothing;

create policy "owner reads draft assets" on storage.objects for select to authenticated
using (bucket_id = 'draft-assets' and (select private.is_draft_owner())
  and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "owner uploads draft assets" on storage.objects for insert to authenticated
with check (bucket_id = 'draft-assets' and (select private.is_draft_owner())
  and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "owner edits draft assets" on storage.objects for update to authenticated
using (bucket_id = 'draft-assets' and (select private.is_draft_owner())
  and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'draft-assets' and (select private.is_draft_owner())
  and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "owner deletes draft assets" on storage.objects for delete to authenticated
using (bucket_id = 'draft-assets' and (select private.is_draft_owner())
  and (storage.foldername(name))[1] = (select auth.uid())::text);

