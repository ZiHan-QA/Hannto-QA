-- Atomic task saving, immutable allocation snapshots and richer TestHub sync diagnostics.

create table if not exists public.qa_task_allocation_history (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.qa_tasks(id) on delete cascade,
  revision integer not null check (revision > 0),
  total_effort numeric(7,2) not null check (total_effort > 0),
  allocation_start_date date not null,
  allocation_end_date date not null,
  assignments jsonb not null check (jsonb_typeof(assignments) = 'array'),
  changed_by uuid not null default auth.uid() references auth.users(id),
  changed_at timestamptz not null default now(),
  unique (task_id, revision)
);

alter table public.qa_task_allocation_history enable row level security;

drop policy if exists qa_task_allocation_history_select_related on public.qa_task_allocation_history;
drop policy if exists qa_task_allocation_history_insert_related on public.qa_task_allocation_history;
create policy qa_task_allocation_history_select_related
on public.qa_task_allocation_history for select
to authenticated
using (public.can_view_qa_task(task_id));
create policy qa_task_allocation_history_insert_related
on public.qa_task_allocation_history for insert
to authenticated
with check (changed_by = auth.uid() and public.can_view_qa_task(task_id));

revoke all on public.qa_task_allocation_history from anon;
grant select, insert on public.qa_task_allocation_history to authenticated;

insert into public.qa_task_allocation_history (
  task_id, revision, total_effort, allocation_start_date, allocation_end_date, assignments, changed_by
)
select
  tasks.id,
  1,
  tasks.effort_person_days,
  tasks.allocation_start_date,
  tasks.allocation_end_date,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'member_id', assignees.member_id,
        'allocated_effort', assignees.allocated_effort
      ) order by assignees.member_id
    ) filter (where assignees.member_id is not null),
    '[]'::jsonb
  ),
  tasks.created_by
from public.qa_tasks as tasks
left join public.qa_task_assignees as assignees on assignees.task_id = tasks.id
where tasks.effort_person_days is not null
  and tasks.allocation_start_date is not null
  and tasks.allocation_end_date is not null
group by tasks.id
on conflict (task_id, revision) do nothing;

create or replace function public.save_qa_task_with_assignees(
  task_payload jsonb,
  assignee_payload jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  target_task_id uuid;
  primary_assignee_id uuid;
  total_effort numeric(7,2);
  assigned_effort numeric(7,2);
  assignment_count integer;
  plan_ids text[];
  has_testhub boolean;
  next_revision integer;
begin
  if jsonb_typeof(task_payload) <> 'object' or jsonb_typeof(assignee_payload) <> 'array' then
    raise exception 'Invalid task or assignee payload';
  end if;

  total_effort := (task_payload ->> 'effort_person_days')::numeric;
  select count(*), coalesce(sum((item ->> 'allocated_effort')::numeric), 0)
  into assignment_count, assigned_effort
  from jsonb_array_elements(assignee_payload) as item;

  if assignment_count < 1 then
    raise exception 'At least one assignee is required';
  end if;
  if total_effort <= 0 or abs(assigned_effort - total_effort) > 0.01 then
    raise exception 'Assignee effort total must equal task effort';
  end if;
  if exists (
    select 1 from jsonb_array_elements(assignee_payload) as item
    where (item ->> 'allocated_effort')::numeric <= 0
  ) then
    raise exception 'Every assignee effort must be greater than zero';
  end if;
  if (
    select count(*) <> count(distinct item ->> 'member_id')
    from jsonb_array_elements(assignee_payload) as item
  ) then
    raise exception 'Duplicate assignees are not allowed';
  end if;

  primary_assignee_id := ((assignee_payload -> 0) ->> 'member_id')::uuid;
  select coalesce(array_agg(value), '{}'::text[])
  into plan_ids
  from jsonb_array_elements_text(coalesce(task_payload -> 'testhub_plan_ids', '[]'::jsonb)) as value;
  has_testhub := cardinality(plan_ids) > 0;
  if has_testhub and nullif(task_payload ->> 'testhub_library_id', '') is null then
    raise exception 'TestHub library is required when plans are linked';
  end if;

  target_task_id := nullif(task_payload ->> 'id', '')::uuid;
  if target_task_id is null then
    insert into public.qa_tasks (
      title, description, priority, task_type, status, assignee_id, due_date,
      source, related_type, external_id, external_url, effort_person_days,
      allocation_start_date, allocation_end_date, testhub_library_id,
      testhub_plan_id, testhub_plan_ids, testhub_effort_person_days, completed_at, created_by
    ) values (
      task_payload ->> 'title', coalesce(task_payload ->> 'description', ''),
      coalesce(task_payload ->> 'priority', 'P1'), coalesce(task_payload ->> 'task_type', 'other'),
      coalesce(task_payload ->> 'status', 'todo'), primary_assignee_id,
      (task_payload ->> 'due_date')::timestamptz, coalesce(task_payload ->> 'source', 'manual'),
      nullif(task_payload ->> 'related_type', ''), nullif(task_payload ->> 'external_id', ''),
      nullif(task_payload ->> 'external_url', ''), total_effort,
      (task_payload ->> 'allocation_start_date')::date,
      (task_payload ->> 'allocation_end_date')::date,
      case when has_testhub then task_payload ->> 'testhub_library_id' else null end,
      case when has_testhub then plan_ids[1] else null end,
      plan_ids,
      case when has_testhub then total_effort else null end,
      case when coalesce(task_payload ->> 'status', 'todo') = 'done' then now() else null end,
      auth.uid()
    ) returning id into target_task_id;
  else
    update public.qa_tasks set
      title = task_payload ->> 'title',
      description = coalesce(task_payload ->> 'description', ''),
      priority = coalesce(task_payload ->> 'priority', 'P1'),
      task_type = coalesce(task_payload ->> 'task_type', 'other'),
      status = coalesce(task_payload ->> 'status', 'todo'),
      assignee_id = primary_assignee_id,
      due_date = (task_payload ->> 'due_date')::timestamptz,
      effort_person_days = total_effort,
      allocation_start_date = (task_payload ->> 'allocation_start_date')::date,
      allocation_end_date = (task_payload ->> 'allocation_end_date')::date,
      testhub_library_id = case when has_testhub then task_payload ->> 'testhub_library_id' else null end,
      testhub_plan_id = case when has_testhub then plan_ids[1] else null end,
      testhub_plan_ids = plan_ids,
      testhub_effort_person_days = case when has_testhub then total_effort else null end
    where id = target_task_id;
    if not found then
      raise exception 'Task not found or update not permitted';
    end if;
  end if;

  insert into public.qa_task_assignees (task_id, member_id, allocated_effort, created_by)
  select
    target_task_id,
    (item ->> 'member_id')::uuid,
    (item ->> 'allocated_effort')::numeric,
    auth.uid()
  from jsonb_array_elements(assignee_payload) as item
  on conflict (task_id, member_id) do update
  set allocated_effort = excluded.allocated_effort,
      created_by = excluded.created_by,
      updated_at = now();

  delete from public.qa_task_assignees
  where task_id = target_task_id
    and member_id not in (
      select (item ->> 'member_id')::uuid
      from jsonb_array_elements(assignee_payload) as item
    );

  select coalesce(max(revision), 0) + 1
  into next_revision
  from public.qa_task_allocation_history
  where task_id = target_task_id;

  insert into public.qa_task_allocation_history (
    task_id, revision, total_effort, allocation_start_date, allocation_end_date,
    assignments, changed_by
  ) values (
    target_task_id, next_revision, total_effort,
    (task_payload ->> 'allocation_start_date')::date,
    (task_payload ->> 'allocation_end_date')::date,
    assignee_payload, auth.uid()
  );

  return target_task_id;
end;
$$;

revoke all on function public.save_qa_task_with_assignees(jsonb, jsonb) from public;
grant execute on function public.save_qa_task_with_assignees(jsonb, jsonb) to authenticated;

alter table public.testhub_sync_status
  add column if not exists execution_record_count integer not null default 0,
  add column if not exists mapped_executor_count integer not null default 0,
  add column if not exists unmapped_executor_count integer not null default 0;

create table if not exists public.admin_risk_actions (
  risk_key text primary key,
  action text not null check (action in ('acknowledged', 'snoozed')),
  snoozed_until timestamptz,
  updated_by uuid not null default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now(),
  check ((action = 'snoozed') = (snoozed_until is not null))
);

alter table public.admin_risk_actions enable row level security;
drop policy if exists admin_risk_actions_admin_all on public.admin_risk_actions;
create policy admin_risk_actions_admin_all
on public.admin_risk_actions for all
to authenticated
using (public.is_admin())
with check (public.is_admin() and updated_by = auth.uid());

revoke all on public.admin_risk_actions from anon;
grant select, insert, update, delete on public.admin_risk_actions to authenticated;

comment on table public.qa_task_allocation_history is
  'Immutable snapshots of task effort allocation after each atomic save';
comment on function public.save_qa_task_with_assignees(jsonb, jsonb) is
  'Atomically validates and saves a QA task, assignees and an allocation snapshot';
comment on table public.admin_risk_actions is
  'Administrator acknowledgement and snooze state for deduplicated dashboard risks';
