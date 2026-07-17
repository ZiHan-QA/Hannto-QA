-- PingCode user directory discovered from read-only TestHub execution data.

create table if not exists public.pingcode_user_directory (
  pingcode_user_id text primary key,
  display_name text not null default '',
  source text not null default 'testhub'
    check (source in ('testhub', 'work_item', 'manual')),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_pingcode_user_directory_updated_at on public.pingcode_user_directory;
create trigger set_pingcode_user_directory_updated_at
before update on public.pingcode_user_directory
for each row execute function public.set_updated_at();

alter table public.pingcode_user_directory enable row level security;

drop policy if exists pingcode_user_directory_admin_all on public.pingcode_user_directory;
create policy pingcode_user_directory_admin_all
on public.pingcode_user_directory for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

revoke all on public.pingcode_user_directory from anon;
grant select, insert, update, delete on public.pingcode_user_directory to authenticated;

comment on table public.pingcode_user_directory is
  'Stable PingCode user IDs and display names discovered from external read-only data';
