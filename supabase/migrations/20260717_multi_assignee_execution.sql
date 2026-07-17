-- Multi-assignee task allocation and per-member daily execution details.

create table if not exists public.qa_task_assignees (
  task_id uuid not null references public.qa_tasks(id) on delete cascade,
  member_id uuid not null references auth.users(id) on delete restrict,
  allocated_effort numeric(7,2) not null check (allocated_effort > 0 and allocated_effort <= 365),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (task_id, member_id)
);

insert into public.qa_task_assignees (task_id, member_id, allocated_effort, created_by)
select id, assignee_id, effort_person_days, created_by
from public.qa_tasks
where effort_person_days is not null and effort_person_days > 0
on conflict (task_id, member_id) do nothing;

drop trigger if exists set_qa_task_assignees_updated_at on public.qa_task_assignees;
create trigger set_qa_task_assignees_updated_at
before update on public.qa_task_assignees
for each row execute function public.set_updated_at();

alter table public.qa_task_assignees enable row level security;

create or replace function public.can_view_qa_task(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
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

create or replace function public.can_manage_task_assignment(target_task_id uuid, target_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or (
      target_member_id = auth.uid()
      and exists (
        select 1 from public.qa_tasks
        where qa_tasks.id = target_task_id
          and qa_tasks.created_by = auth.uid()
      )
    );
$$;

revoke all on function public.can_manage_task_assignment(uuid, uuid) from public;
grant execute on function public.can_manage_task_assignment(uuid, uuid) to authenticated;

drop policy if exists qa_task_assignees_select_authenticated on public.qa_task_assignees;
drop policy if exists qa_task_assignees_write_admin on public.qa_task_assignees;
drop policy if exists qa_task_assignees_insert_allowed on public.qa_task_assignees;
drop policy if exists qa_task_assignees_update_allowed on public.qa_task_assignees;
drop policy if exists qa_task_assignees_delete_allowed on public.qa_task_assignees;
create policy qa_task_assignees_select_authenticated
on public.qa_task_assignees for select
to authenticated
using (public.can_view_qa_task(task_id));
create policy qa_task_assignees_insert_allowed
on public.qa_task_assignees for insert
to authenticated
with check (
  created_by = auth.uid()
  and public.can_manage_task_assignment(task_id, member_id)
);
create policy qa_task_assignees_update_allowed
on public.qa_task_assignees for update
to authenticated
using (public.can_manage_task_assignment(task_id, member_id))
with check (created_by = auth.uid() and public.can_manage_task_assignment(task_id, member_id));
create policy qa_task_assignees_delete_allowed
on public.qa_task_assignees for delete
to authenticated
using (public.can_manage_task_assignment(task_id, member_id));

revoke all on public.qa_task_assignees from anon;
grant select, insert, update, delete on public.qa_task_assignees to authenticated;

drop policy if exists "Users read own tasks" on public.qa_tasks;
create policy "Users read own tasks"
on public.qa_tasks for select
to authenticated
using (
  public.can_view_qa_task(id)
);

alter table public.task_progress_logs
  add column if not exists executor_id uuid references auth.users(id) on delete restrict;

update public.task_progress_logs as logs
set executor_id = tasks.assignee_id
from public.qa_tasks as tasks
where tasks.id = logs.task_id and logs.executor_id is null;

alter table public.task_progress_logs
  alter column executor_id set not null;

create index if not exists task_progress_logs_executor_date_idx
  on public.task_progress_logs (executor_id, work_date);

drop policy if exists task_progress_logs_select_related on public.task_progress_logs;
drop policy if exists task_progress_logs_insert_manual on public.task_progress_logs;
drop policy if exists task_progress_logs_update_manual on public.task_progress_logs;
drop policy if exists task_progress_logs_delete_manual on public.task_progress_logs;

create policy task_progress_logs_select_related
on public.task_progress_logs for select
to authenticated
using (
  executor_id = auth.uid() or public.can_view_qa_task(task_id)
);

create policy task_progress_logs_insert_manual
on public.task_progress_logs for insert
to authenticated
with check (
  source = 'manual'
  and reported_by = auth.uid()
  and (executor_id = auth.uid() or public.is_admin())
  and exists (
    select 1 from public.qa_task_assignees
    where qa_task_assignees.task_id = task_progress_logs.task_id
      and qa_task_assignees.member_id = task_progress_logs.executor_id
  )
);

create policy task_progress_logs_update_manual
on public.task_progress_logs for update
to authenticated
using (source = 'manual' and (reported_by = auth.uid() or public.is_admin()))
with check (source = 'manual' and (executor_id = auth.uid() or public.is_admin()));

create policy task_progress_logs_delete_manual
on public.task_progress_logs for delete
to authenticated
using (source = 'manual' and (reported_by = auth.uid() or public.is_admin()));

create table if not exists public.task_testhub_daily_execution (
  task_id uuid not null references public.qa_tasks(id) on delete cascade,
  work_date date not null,
  executor_key text not null,
  member_id uuid references auth.users(id) on delete set null,
  executor_name text not null default '未识别执行人',
  executed_cases integer not null default 0 check (executed_cases >= 0),
  synced_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (task_id, work_date, executor_key)
);

create index if not exists task_testhub_daily_execution_member_date_idx
  on public.task_testhub_daily_execution (member_id, work_date);

drop trigger if exists set_task_testhub_daily_execution_updated_at on public.task_testhub_daily_execution;
create trigger set_task_testhub_daily_execution_updated_at
before update on public.task_testhub_daily_execution
for each row execute function public.set_updated_at();

alter table public.task_testhub_daily_execution enable row level security;

drop policy if exists task_testhub_daily_execution_select_related on public.task_testhub_daily_execution;
drop policy if exists task_testhub_daily_execution_write_admin on public.task_testhub_daily_execution;
create policy task_testhub_daily_execution_select_related
on public.task_testhub_daily_execution for select
to authenticated
using (
  member_id = auth.uid() or public.can_view_qa_task(task_id)
);
create policy task_testhub_daily_execution_write_admin
on public.task_testhub_daily_execution for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

revoke all on public.task_testhub_daily_execution from anon;
grant select, insert, update, delete on public.task_testhub_daily_execution to authenticated;

drop policy if exists task_testhub_progress_select_related on public.task_testhub_progress;
create policy task_testhub_progress_select_related
on public.task_testhub_progress for select
to authenticated
using (
  public.can_view_qa_task(task_id)
);

comment on table public.qa_task_assignees is
  'Members assigned to a QA task with their share of total event effort';
comment on column public.task_progress_logs.executor_id is
  'Member who performed the work; reported_by is the account that submitted the entry';
comment on table public.task_testhub_daily_execution is
  'Daily TestHub executed-case counts grouped by task and mapped executor';
