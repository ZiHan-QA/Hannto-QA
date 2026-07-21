-- Half-day task allocation and scoped TestHub progress by plan suite/module.

alter table public.qa_tasks
  add column if not exists allocation_start_period text not null default 'am',
  add column if not exists allocation_end_period text not null default 'pm',
  add column if not exists testhub_scope_mode text not null default 'all',
  add column if not exists testhub_scope_suite_ids text[] not null default '{}';

alter table public.task_testhub_progress
  add column if not exists scope_mode text not null default 'all',
  add column if not exists scope_suite_ids text[] not null default '{}',
  add column if not exists scope_suite_names text[] not null default '{}';

alter table public.task_testhub_progress drop constraint if exists task_testhub_progress_scope_mode_check;
alter table public.task_testhub_progress
  add constraint task_testhub_progress_scope_mode_check check (scope_mode in ('all', 'suite'));

alter table public.qa_tasks drop constraint if exists qa_tasks_allocation_period_check;
alter table public.qa_tasks
  add constraint qa_tasks_allocation_period_check check (
    allocation_start_period in ('am', 'pm')
    and allocation_end_period in ('am', 'pm')
    and (
      allocation_start_date is null
      or allocation_end_date is null
      or allocation_start_date < allocation_end_date
      or not (allocation_start_period = 'pm' and allocation_end_period = 'am')
    )
  );

alter table public.qa_tasks drop constraint if exists qa_tasks_testhub_scope_mode_check;
alter table public.qa_tasks
  add constraint qa_tasks_testhub_scope_mode_check
  check (testhub_scope_mode in ('all', 'suite'));

create table if not exists public.testhub_plan_suite_cache (
  library_id text not null,
  plan_id text not null,
  suite_id text not null,
  suite_name text not null,
  case_count integer not null default 0 check (case_count >= 0),
  synced_at timestamp with time zone not null default now(),
  primary key (library_id, plan_id, suite_id)
);

create index if not exists testhub_plan_suite_cache_plan_idx
  on public.testhub_plan_suite_cache (library_id, plan_id, suite_name);

alter table public.testhub_plan_suite_cache enable row level security;
drop policy if exists testhub_plan_suite_cache_read_authenticated on public.testhub_plan_suite_cache;
create policy testhub_plan_suite_cache_read_authenticated
on public.testhub_plan_suite_cache for select to authenticated using (true);
drop policy if exists testhub_plan_suite_cache_write_admin on public.testhub_plan_suite_cache;
create policy testhub_plan_suite_cache_write_admin
on public.testhub_plan_suite_cache for all to authenticated
using (public.is_admin()) with check (public.is_admin());
revoke all on public.testhub_plan_suite_cache from anon;
grant select, insert, update, delete on public.testhub_plan_suite_cache to authenticated;

create or replace function public.save_qa_task_workflow(
  task_payload jsonb,
  assignee_payload jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  target_task_id uuid;
  target_status text;
  scope_mode text;
  scope_suite_ids text[];
begin
  target_status := coalesce(task_payload ->> 'status', 'todo');
  scope_mode := coalesce(nullif(task_payload ->> 'testhub_scope_mode', ''), 'all');
  select coalesce(array_agg(suite_id), array[]::text[]) into scope_suite_ids
  from jsonb_array_elements_text(coalesce(task_payload -> 'testhub_scope_suite_ids', '[]'::jsonb)) as suites(suite_id);

  if target_status = 'blocked' and nullif(btrim(task_payload ->> 'blocked_reason'), '') is null then
    raise exception 'Blocked reason is required';
  end if;
  if target_status = 'done' and nullif(btrim(task_payload ->> 'completion_note'), '') is null then
    raise exception 'Completion note is required';
  end if;
  if scope_mode = 'suite' and cardinality(scope_suite_ids) = 0 then
    raise exception 'At least one TestHub suite is required for suite scope';
  end if;

  target_task_id := public.save_qa_task_with_assignees(task_payload, assignee_payload);
  update public.qa_tasks set
    release_id = nullif(task_payload ->> 'release_id', '')::uuid,
    blocked_reason = case when target_status = 'blocked' then nullif(task_payload ->> 'blocked_reason', '') else null end,
    blocked_owner_id = case when target_status = 'blocked' then nullif(task_payload ->> 'blocked_owner_id', '')::uuid else null end,
    blocked_until = case when target_status = 'blocked' then nullif(task_payload ->> 'blocked_until', '')::date else null end,
    completion_note = case when target_status = 'done' then nullif(task_payload ->> 'completion_note', '') else null end,
    allocation_start_period = coalesce(nullif(task_payload ->> 'allocation_start_period', ''), 'am'),
    allocation_end_period = coalesce(nullif(task_payload ->> 'allocation_end_period', ''), 'pm'),
    testhub_scope_mode = scope_mode,
    testhub_scope_suite_ids = case when scope_mode = 'suite' then scope_suite_ids else '{}' end
  where id = target_task_id;
  return target_task_id;
end;
$$;

revoke all on function public.save_qa_task_workflow(jsonb, jsonb) from public;
grant execute on function public.save_qa_task_workflow(jsonb, jsonb) to authenticated;

comment on column public.qa_tasks.allocation_start_period is 'Start half-day: am or pm';
comment on column public.qa_tasks.allocation_end_period is 'Inclusive end half-day: am or pm';
comment on column public.qa_tasks.testhub_scope_mode is 'TestHub progress scope: all plan runs or selected suites';
comment on column public.qa_tasks.testhub_scope_suite_ids is 'Stable TestHub suite IDs included in task progress';
comment on table public.testhub_plan_suite_cache is 'Read-only TestHub plan suites discovered by the local sync';

create or replace function public.record_qa_task_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  fields text[];
  tracked_fields text[] := array[
    'title', 'status', 'task_type', 'release_id', 'due_date', 'assignee_id',
    'effort_person_days', 'allocation_start_date', 'allocation_end_date',
    'allocation_start_period', 'allocation_end_period', 'testhub_plan_ids',
    'testhub_scope_mode', 'testhub_scope_suite_ids', 'blocked_reason',
    'blocked_owner_id', 'blocked_until', 'completion_note'
  ];
  old_snapshot jsonb;
  new_snapshot jsonb;
begin
  new_snapshot := to_jsonb(new);
  if tg_op = 'INSERT' then
    insert into public.qa_task_activity (task_id, action, changed_fields, new_values, changed_by)
    values (new.id, 'created', array['created'], new_snapshot, auth.uid());
    return new;
  end if;
  old_snapshot := to_jsonb(old);
  select coalesce(array_agg(field_name), array[]::text[]) into fields
  from unnest(tracked_fields) as field_name
  where old_snapshot -> field_name is distinct from new_snapshot -> field_name;
  if cardinality(fields) > 0 then
    insert into public.qa_task_activity (task_id, action, changed_fields, old_values, new_values, changed_by)
    values (new.id, 'updated', fields, old_snapshot, new_snapshot, auth.uid());
  end if;
  return new;
end;
$$;
