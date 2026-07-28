-- Allow authenticated users such as leaders to browse the dashboard without
-- participating in task assignment, capacity planning, progress or risk totals.

begin;

alter table public.profiles
  add column if not exists resource_participant boolean not null default true;

comment on column public.profiles.resource_participant is
  'Whether the profile participates in QA task assignment, capacity, progress and risk statistics';

-- Current known read-only leader account.
update public.profiles
set resource_participant = false
where lower(btrim(coalesce(name, ''))) = 'xuguang.li';

create or replace function public.is_resource_observer()
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
      and role <> 'admin'
      and resource_participant = false
  );
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
    or public.is_resource_observer()
    or exists (
      select 1 from public.qa_tasks
      where qa_tasks.id = target_task_id
        and (qa_tasks.assignee_id = auth.uid() or qa_tasks.created_by = auth.uid())
    )
    or exists (
      select 1 from public.qa_task_assignees
      where qa_task_assignees.task_id = target_task_id
        and qa_task_assignees.member_id = auth.uid()
    );
$$;

revoke all on function public.can_view_qa_task(uuid) from public;
grant execute on function public.can_view_qa_task(uuid) to authenticated;

drop policy if exists profiles_select_policy on public.profiles;
create policy profiles_select_policy on public.profiles
for select to authenticated
using (id = auth.uid() or public.is_admin() or public.is_resource_observer());

commit;
