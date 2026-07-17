-- Hybrid task progress ledger for manual and external execution evidence.

create table if not exists public.task_progress_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.qa_tasks(id) on delete cascade,
  work_date date not null,
  progress_points numeric(7,2) not null
    check (progress_points > 0 and progress_points <= 50),
  source text not null default 'manual'
    check (source in ('manual', 'pingcode', 'testhub', 'automation')),
  external_event_id text,
  note text not null default '',
  reported_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists task_progress_logs_task_date_idx
  on public.task_progress_logs (task_id, work_date);

create unique index if not exists task_progress_logs_external_event_idx
  on public.task_progress_logs (source, external_event_id)
  where external_event_id is not null;

drop trigger if exists set_task_progress_logs_updated_at on public.task_progress_logs;
create trigger set_task_progress_logs_updated_at
before update on public.task_progress_logs
for each row execute function public.set_updated_at();

alter table public.task_progress_logs enable row level security;

drop policy if exists task_progress_logs_select_related on public.task_progress_logs;
drop policy if exists task_progress_logs_insert_manual on public.task_progress_logs;
drop policy if exists task_progress_logs_update_manual on public.task_progress_logs;
drop policy if exists task_progress_logs_delete_manual on public.task_progress_logs;

create policy task_progress_logs_select_related
on public.task_progress_logs for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1 from public.qa_tasks
    where qa_tasks.id = task_progress_logs.task_id
      and qa_tasks.assignee_id = auth.uid()
  )
);

create policy task_progress_logs_insert_manual
on public.task_progress_logs for insert
to authenticated
with check (
  source = 'manual'
  and reported_by = auth.uid()
  and exists (
    select 1 from public.qa_tasks
    where qa_tasks.id = task_progress_logs.task_id
      and (qa_tasks.assignee_id = auth.uid() or public.is_admin())
  )
);

create policy task_progress_logs_update_manual
on public.task_progress_logs for update
to authenticated
using (source = 'manual' and (reported_by = auth.uid() or public.is_admin()))
with check (source = 'manual' and (reported_by = auth.uid() or public.is_admin()));

create policy task_progress_logs_delete_manual
on public.task_progress_logs for delete
to authenticated
using (source = 'manual' and (reported_by = auth.uid() or public.is_admin()));

revoke all on public.task_progress_logs from anon;
grant select, insert, update, delete on public.task_progress_logs to authenticated;

comment on table public.task_progress_logs is
  'Daily actual progress points from manual reports and deduplicated external execution events';
