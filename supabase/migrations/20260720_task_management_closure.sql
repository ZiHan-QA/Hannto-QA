-- Task management closure: blocking, completion notes, releases and audit history.

alter table public.qa_tasks
  add column if not exists blocked_reason text,
  add column if not exists blocked_owner_id uuid references public.profiles(id) on delete set null,
  add column if not exists blocked_until date,
  add column if not exists completion_note text;

alter table public.qa_tasks drop constraint if exists qa_tasks_status_check;
alter table public.qa_tasks
  add constraint qa_tasks_status_check
  check (status in ('todo', 'in_progress', 'blocked', 'done', 'cancelled'));

create table if not exists public.qa_task_activity (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.qa_tasks(id) on delete cascade,
  action text not null check (action in ('created', 'updated')),
  changed_fields text[] not null default '{}',
  old_values jsonb,
  new_values jsonb not null,
  changed_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists qa_task_activity_task_created_idx
  on public.qa_task_activity (task_id, created_at desc);

create or replace function public.record_qa_task_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  fields text[];
  old_snapshot jsonb;
  new_snapshot jsonb;
begin
  new_snapshot := jsonb_build_object(
    'title', new.title, 'status', new.status, 'task_type', new.task_type,
    'release_id', new.release_id, 'due_date', new.due_date,
    'assignee_id', new.assignee_id, 'effort_person_days', new.effort_person_days,
    'allocation_start_date', new.allocation_start_date,
    'allocation_end_date', new.allocation_end_date,
    'blocked_reason', new.blocked_reason, 'blocked_owner_id', new.blocked_owner_id,
    'blocked_until', new.blocked_until, 'completion_note', new.completion_note
  );
  if tg_op = 'INSERT' then
    insert into public.qa_task_activity (task_id, action, changed_fields, new_values, changed_by)
    values (new.id, 'created', array['created'], new_snapshot, auth.uid());
    return new;
  end if;

  old_snapshot := jsonb_build_object(
    'title', old.title, 'status', old.status, 'task_type', old.task_type,
    'release_id', old.release_id, 'due_date', old.due_date,
    'assignee_id', old.assignee_id, 'effort_person_days', old.effort_person_days,
    'allocation_start_date', old.allocation_start_date,
    'allocation_end_date', old.allocation_end_date,
    'blocked_reason', old.blocked_reason, 'blocked_owner_id', old.blocked_owner_id,
    'blocked_until', old.blocked_until, 'completion_note', old.completion_note
  );
  fields := array_remove(array[
    case when old.title is distinct from new.title then 'title' end,
    case when old.status is distinct from new.status then 'status' end,
    case when old.task_type is distinct from new.task_type then 'task_type' end,
    case when old.release_id is distinct from new.release_id then 'release_id' end,
    case when old.due_date is distinct from new.due_date then 'due_date' end,
    case when old.assignee_id is distinct from new.assignee_id then 'assignee_id' end,
    case when old.effort_person_days is distinct from new.effort_person_days then 'effort_person_days' end,
    case when old.allocation_start_date is distinct from new.allocation_start_date then 'allocation_start_date' end,
    case when old.allocation_end_date is distinct from new.allocation_end_date then 'allocation_end_date' end,
    case when old.blocked_reason is distinct from new.blocked_reason then 'blocked_reason' end,
    case when old.blocked_owner_id is distinct from new.blocked_owner_id then 'blocked_owner_id' end,
    case when old.blocked_until is distinct from new.blocked_until then 'blocked_until' end,
    case when old.completion_note is distinct from new.completion_note then 'completion_note' end
  ], null);
  if cardinality(fields) > 0 then
    insert into public.qa_task_activity (task_id, action, changed_fields, old_values, new_values, changed_by)
    values (new.id, 'updated', fields, old_snapshot, new_snapshot, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists record_qa_task_activity on public.qa_tasks;
create trigger record_qa_task_activity
after insert or update on public.qa_tasks
for each row execute function public.record_qa_task_activity();

alter table public.qa_task_activity enable row level security;
drop policy if exists qa_task_activity_select_related on public.qa_task_activity;
create policy qa_task_activity_select_related
on public.qa_task_activity for select
to authenticated
using (public.can_view_qa_task(task_id));
revoke all on public.qa_task_activity from anon;
grant select on public.qa_task_activity to authenticated;

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
begin
  target_status := coalesce(task_payload ->> 'status', 'todo');
  if target_status = 'blocked' and nullif(btrim(task_payload ->> 'blocked_reason'), '') is null then
    raise exception 'Blocked reason is required';
  end if;
  if target_status = 'done' and nullif(btrim(task_payload ->> 'completion_note'), '') is null then
    raise exception 'Completion note is required';
  end if;

  target_task_id := public.save_qa_task_with_assignees(task_payload, assignee_payload);
  update public.qa_tasks set
    release_id = nullif(task_payload ->> 'release_id', '')::uuid,
    blocked_reason = case when target_status = 'blocked' then nullif(task_payload ->> 'blocked_reason', '') else null end,
    blocked_owner_id = case when target_status = 'blocked' then nullif(task_payload ->> 'blocked_owner_id', '')::uuid else null end,
    blocked_until = case when target_status = 'blocked' then nullif(task_payload ->> 'blocked_until', '')::date else null end,
    completion_note = case when target_status = 'done' then nullif(task_payload ->> 'completion_note', '') else null end
  where id = target_task_id;
  return target_task_id;
end;
$$;

revoke all on function public.save_qa_task_workflow(jsonb, jsonb) from public;
grant execute on function public.save_qa_task_workflow(jsonb, jsonb) to authenticated;

comment on table public.qa_task_activity is 'Immutable task create/update audit history';
comment on function public.save_qa_task_workflow(jsonb, jsonb) is
  'Atomically saves task assignments plus release, blocking and completion workflow fields';
