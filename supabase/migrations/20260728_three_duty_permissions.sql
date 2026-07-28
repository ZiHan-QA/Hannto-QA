-- Three-duty permission model for Liene QA:
-- system administrator, QA/project lead, and test engineer.
-- Resource participation remains an independent capacity flag.

begin;

update public.profiles
set role = case
  when role = 'admin' then 'admin'
  when role = 'qa_lead' then 'qa_lead'
  else 'tester'
end;

do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select conname
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.profiles drop constraint %I', constraint_record.conname);
  end loop;
end;
$$;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'qa_lead', 'tester'));

alter table public.profiles
  alter column role set default 'tester';

comment on column public.profiles.role is
  'Duty: admin=system administrator, qa_lead=QA/project lead, tester=test engineer';

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
    'tester'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_user_profile() from public;

create or replace function public.is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

revoke all on function public.is_system_admin() from public;
grant execute on function public.is_system_admin() to authenticated;

-- Keep the existing function name for compatibility with business RLS and RPCs.
-- In the three-duty model it means "may manage QA business data".
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('admin', 'qa_lead')
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Resource participation no longer changes data access.
create or replace function public.is_resource_observer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select false;
$$;

revoke all on function public.is_resource_observer() from public;
grant execute on function public.is_resource_observer() to authenticated;

create or replace function public.can_view_qa_task(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or exists (
      select 1
      from public.qa_tasks
      where qa_tasks.id = target_task_id
        and (qa_tasks.assignee_id = auth.uid() or qa_tasks.created_by = auth.uid())
    )
    or exists (
      select 1
      from public.qa_task_assignees
      where qa_task_assignees.task_id = target_task_id
        and qa_task_assignees.member_id = auth.uid()
    );
$$;

revoke all on function public.can_view_qa_task(uuid) from public;
grant execute on function public.can_view_qa_task(uuid) to authenticated;

-- Everyone needs member names for assignee labels. Only system administrators
-- may create, edit or delete accounts, duties and resource flags.
drop policy if exists profiles_select_policy on public.profiles;
drop policy if exists profiles_insert_policy on public.profiles;
drop policy if exists profiles_update_policy on public.profiles;
drop policy if exists profiles_delete_policy on public.profiles;

create policy profiles_select_policy on public.profiles
for select to authenticated
using (true);

create policy profiles_insert_policy on public.profiles
for insert to authenticated
with check (public.is_system_admin());

create policy profiles_update_policy on public.profiles
for update to authenticated
using (public.is_system_admin())
with check (public.is_system_admin());

create policy profiles_delete_policy on public.profiles
for delete to authenticated
using (public.is_system_admin());

notify pgrst, 'reload schema';

commit;
