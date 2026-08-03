-- Persist project Gantt drag/resize changes through one authorized operation.
-- Direct table updates can be silently reduced to zero rows by RLS, which made
-- the Gantt appear draggable while leaving the stored schedule unchanged.

begin;

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

  next_due_date := (
    next_end_date
    + case
        when coalesce(target_task.allocation_end_period, 'pm') = 'am' then time '12:00:00'
        else time '19:00:00'
      end
  ) at time zone 'Asia/Shanghai';

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
  'Moves or resizes a QA task schedule from the project Gantt for administrators and QA leads';

notify pgrst, 'reload schema';

commit;
