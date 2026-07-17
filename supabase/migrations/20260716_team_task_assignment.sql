-- Team task assignment and PingCode identity mapping.

alter table public.profiles
  add column if not exists pingcode_user_id text,
  add column if not exists pingcode_display_name text;

create unique index if not exists profiles_pingcode_user_id_idx
  on public.profiles (pingcode_user_id)
  where pingcode_user_id is not null;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name, role)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(new.email, '@', 1), ''),
      '新成员'
    ),
    'member'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_user_profile() from public;

drop trigger if exists on_auth_user_created_create_profile on auth.users;
create trigger on_auth_user_created_create_profile
after insert on auth.users
for each row execute function public.handle_new_user_profile();

insert into public.profiles (id, name, role)
select
  users.id,
  coalesce(
    nullif(btrim(users.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(users.email, '@', 1), ''),
    '新成员'
  ),
  'member'
from auth.users as users
on conflict (id) do nothing;

comment on column public.profiles.pingcode_user_id is
  'PingCode user id used to map imported work item assignees';
comment on column public.profiles.pingcode_display_name is
  'Last known PingCode display name for administrators';
