-- A QA task becomes overdue only after 23:59:59 on its scheduled end date.
-- AM/PM remains a capacity-allocation concept and must not be used as the
-- overdue cutoff.

begin;

-- Remove false late-completion markers written by the former 12:00/19:00
-- trigger when the task was still completed on its scheduled calendar day.
update public.qa_tasks
set delay_recorded_at = null
where status = 'done'
  and completed_at is not null
  and allocation_end_date is not null
  and completed_at <=
    (
      allocation_end_date::timestamp + time '23:59:59'
    ) at time zone 'Asia/Shanghai';

create or replace function public.maintain_qa_task_delay_marker()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  deadline_at timestamptz;
  completion_time timestamptz;
  schedule_changed boolean := false;
begin
  if new.allocation_end_date is null then
    return new;
  end if;

  deadline_at :=
    (
      new.allocation_end_date::timestamp + time '23:59:59'
    ) at time zone 'Asia/Shanghai';
  completion_time := coalesce(
    new.completed_at,
    case when new.status = 'done' then now() else null end
  );

  if tg_op = 'UPDATE' then
    schedule_changed :=
      old.allocation_end_date is distinct from new.allocation_end_date
      or old.allocation_end_period is distinct from new.allocation_end_period;
  end if;

  if new.status = 'done' and completion_time is not null and completion_time > deadline_at then
    new.delay_recorded_at := coalesce(
      case when tg_op = 'UPDATE' then old.delay_recorded_at else null end,
      completion_time
    );
  elsif new.status = 'done' then
    -- A completion on the scheduled calendar day is never late. This also
    -- repairs stale markers when a row is edited after this migration.
    new.delay_recorded_at := null;
  elsif schedule_changed and public.is_admin() then
    new.delay_recorded_at := null;
  end if;

  return new;
end;
$$;

-- Keep due_date consistent when a QA lead/admin drags a task in the project
-- schedule. The displayed half-day still comes from allocation_end_period.
create or replace function public.update_qa_task_schedule(
  target_task_id uuid,
  next_start_date date,
  next_end_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_role text;
  target_task public.qa_tasks%rowtype;
  next_due_date timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select profile.role
  into caller_role
  from public.profiles as profile
  where profile.id = auth.uid();

  if coalesce(caller_role, 'tester') not in ('admin', 'qa_lead') then
    raise exception 'Only system administrators or QA leads may change project schedules';
  end if;

  if next_start_date is null or next_end_date is null then
    raise exception 'Schedule start and end dates are required';
  end if;

  if next_start_date > next_end_date then
    raise exception 'Schedule start date cannot be later than the end date';
  end if;

  select task.*
  into target_task
  from public.qa_tasks as task
  where task.id = target_task_id
  for update;

  if not found then
    raise exception 'Task not found';
  end if;

  next_due_date :=
    (next_end_date + time '23:59:59') at time zone 'Asia/Shanghai';

  update public.qa_tasks as task
  set allocation_start_date = next_start_date,
      allocation_end_date = next_end_date,
      due_date = next_due_date
  where task.id = target_task_id
  returning task.* into target_task;

  return jsonb_build_object(
    'id', target_task.id,
    'allocation_start_date', target_task.allocation_start_date,
    'allocation_end_date', target_task.allocation_end_date,
    'due_date', target_task.due_date
  );
end;
$$;

revoke all on function public.update_qa_task_schedule(uuid, date, date) from public;
grant execute on function public.update_qa_task_schedule(uuid, date, date) to authenticated;

comment on function public.update_qa_task_schedule(uuid, date, date) is
  'Moves/resizes a QA task schedule; overdue cutoff is the end of the scheduled calendar day';

commit;
