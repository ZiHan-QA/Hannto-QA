-- TestHub local-sync health and inclusive single-day resource allocation.

alter table public.qa_tasks
  drop constraint if exists qa_tasks_allocation_check;

alter table public.qa_tasks
  add constraint qa_tasks_allocation_check
  check (
    (
      allocation_start_date is null
      and allocation_end_date is null
      and effort_person_days is null
    )
    or
    (
      allocation_start_date is not null
      and allocation_end_date is not null
      and allocation_end_date >= allocation_start_date
      and effort_person_days > 0
      and effort_person_days <= 365
    )
  );

comment on column public.qa_tasks.allocation_end_date is
  'Resource allocation end date, inclusive';

create table if not exists public.testhub_sync_status (
  sync_name text primary key,
  status text not null default 'never',
  last_started_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  next_expected_at timestamptz,
  error_message text,
  cached_plan_count integer not null default 0,
  progress_success integer not null default 0,
  progress_failed integer not null default 0,
  updated_by uuid not null default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now(),
  check (sync_name = 'testhub_local'),
  check (status in ('never', 'running', 'success', 'failed')),
  check (cached_plan_count >= 0 and progress_success >= 0 and progress_failed >= 0)
);

alter table public.testhub_sync_status enable row level security;

drop policy if exists testhub_sync_status_admin_all on public.testhub_sync_status;
create policy testhub_sync_status_admin_all
on public.testhub_sync_status for all
to authenticated
using (public.is_admin())
with check (public.is_admin() and updated_by = auth.uid());

revoke all on public.testhub_sync_status from anon;
grant select, insert, update on public.testhub_sync_status to authenticated;

comment on table public.testhub_sync_status is
  'Health heartbeat written by the local read-only TestHub synchronization task';
