-- Cache PingCode TestHub plan metadata populated by the local read-only sync tool.

create table if not exists public.testhub_plan_cache (
  library_id text not null,
  plan_id text not null,
  name text not null,
  short_id text,
  status text,
  state_name text,
  assignee_name text,
  start_at bigint,
  end_at bigint,
  html_url text,
  synced_at timestamptz not null default now(),
  synced_by uuid not null default auth.uid() references auth.users(id),
  primary key (library_id, plan_id),
  check (length(btrim(library_id)) between 1 and 128),
  check (length(btrim(plan_id)) between 1 and 128)
);

create index if not exists testhub_plan_cache_library_end_idx
  on public.testhub_plan_cache (library_id, end_at desc nulls last);

alter table public.testhub_plan_cache enable row level security;

drop policy if exists testhub_plan_cache_admin_all on public.testhub_plan_cache;
create policy testhub_plan_cache_admin_all
on public.testhub_plan_cache for all
to authenticated
using (public.is_admin())
with check (public.is_admin() and synced_by = auth.uid());

revoke all on public.testhub_plan_cache from anon;
grant select, insert, update, delete on public.testhub_plan_cache to authenticated;

comment on table public.testhub_plan_cache is
  'TestHub plan metadata cached by the local read-only PingCode sync tool';
