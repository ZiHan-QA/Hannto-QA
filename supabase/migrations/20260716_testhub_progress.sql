-- TestHub plan linkage and latest execution-progress snapshots.

alter table public.qa_tasks
  add column if not exists testhub_library_id text,
  add column if not exists testhub_plan_id text,
  add column if not exists testhub_plan_url text,
  add column if not exists testhub_effort_person_days numeric(7,2);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.qa_tasks'::regclass
      and conname = 'qa_tasks_testhub_link_check'
  ) then
    alter table public.qa_tasks
      add constraint qa_tasks_testhub_link_check
      check (
        (
          testhub_library_id is null
          and testhub_plan_id is null
          and testhub_effort_person_days is null
        )
        or
        (
          length(btrim(testhub_library_id)) > 0
          and length(btrim(testhub_plan_id)) > 0
          and testhub_effort_person_days > 0
          and effort_person_days is not null
          and testhub_effort_person_days <= effort_person_days
        )
      );
  end if;
end;
$$;

create table if not exists public.task_testhub_progress (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null unique references public.qa_tasks(id) on delete cascade,
  library_id text not null,
  plan_id text not null,
  total_cases integer not null default 0 check (total_cases >= 0),
  executed_cases integer not null default 0
    check (executed_cases >= 0 and executed_cases <= total_cases),
  progress_ratio numeric(8,6) not null default 0
    check (progress_ratio >= 0 and progress_ratio <= 1),
  status_counts jsonb not null default '{}'::jsonb,
  sync_status text not null default 'pending'
    check (sync_status in ('pending', 'synced', 'failed')),
  sync_error text,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_task_testhub_progress_updated_at on public.task_testhub_progress;
create trigger set_task_testhub_progress_updated_at
before update on public.task_testhub_progress
for each row execute function public.set_updated_at();

alter table public.task_testhub_progress enable row level security;

drop policy if exists task_testhub_progress_select_related on public.task_testhub_progress;
drop policy if exists task_testhub_progress_write_admin on public.task_testhub_progress;

create policy task_testhub_progress_select_related
on public.task_testhub_progress for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1 from public.qa_tasks
    where qa_tasks.id = task_testhub_progress.task_id
      and qa_tasks.assignee_id = auth.uid()
  )
);

create policy task_testhub_progress_write_admin
on public.task_testhub_progress for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

revoke all on public.task_testhub_progress from anon;
grant select, insert, update, delete on public.task_testhub_progress to authenticated;

comment on column public.qa_tasks.testhub_effort_person_days is
  'Part of total effort measured automatically by TestHub executed-case ratio';
comment on table public.task_testhub_progress is
  'Latest deduplicated TestHub plan execution snapshot for a QA task';
