-- Persist administrator waivers for overdue and late-completed QA tasks.

begin;

alter table public.qa_tasks
  add column if not exists delay_recorded_at timestamptz,
  add column if not exists delay_waived_at timestamptz,
  add column if not exists delay_waived_by uuid references auth.users(id) on delete set null,
  add column if not exists delay_waiver_reason text;

comment on column public.qa_tasks.delay_recorded_at is
  'Persistent marker set when a task is completed after its scheduled cutoff';
comment on column public.qa_tasks.delay_waived_at is
  'When set, hides the computed overdue/late-completed marker until an administrator restores it';
comment on column public.qa_tasks.delay_waived_by is
  'Administrator who waived the computed delay marker';
comment on column public.qa_tasks.delay_waiver_reason is
  'Optional administrator explanation for waiving the delay marker';

update public.qa_tasks
set delay_recorded_at = coalesce(completed_at, updated_at, now())
where status = 'done'
  and completed_at is not null
  and allocation_end_date is not null
  and completed_at >
    (
      allocation_end_date::timestamp
      + case
          when coalesce(allocation_end_period, 'pm') = 'am' then interval '12 hours'
          else interval '19 hours'
        end
    ) at time zone 'Asia/Shanghai'
  and delay_recorded_at is null;

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
      new.allocation_end_date::timestamp
      + case
          when coalesce(new.allocation_end_period, 'pm') = 'am' then interval '12 hours'
          else interval '19 hours'
        end
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
  elsif new.status = 'done'
      and schedule_changed
      and public.is_admin() then
    new.delay_recorded_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists zz_qa_tasks_maintain_delay_marker on public.qa_tasks;
create trigger zz_qa_tasks_maintain_delay_marker
before insert or update of status, completed_at, allocation_end_date, allocation_end_period
on public.qa_tasks
for each row
execute function public.maintain_qa_task_delay_marker();

create or replace function public.set_qa_task_delay_waiver(
  target_task_id uuid,
  waive boolean,
  reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;
  if not public.is_admin() then
    raise exception 'Only administrators can change task delay waivers';
  end if;

  update public.qa_tasks
  set
    delay_waived_at = case when waive then now() else null end,
    delay_waived_by = case when waive then caller_id else null end,
    delay_waiver_reason = case when waive then nullif(btrim(reason), '') else null end
  where id = target_task_id;

  if not found then
    raise exception 'Task not found';
  end if;

  insert into public.qa_task_activity (
    task_id,
    action,
    changed_fields,
    old_values,
    new_values,
    changed_by
  )
  values (
    target_task_id,
    'updated',
    array['delay_waived_at', 'delay_waived_by', 'delay_waiver_reason'],
    '{}'::jsonb,
    jsonb_build_object(
      'delay_waived', waive,
      'delay_waiver_reason', nullif(btrim(reason), '')
    ),
    caller_id
  );
end;
$$;

revoke all on function public.set_qa_task_delay_waiver(uuid, boolean, text) from public;
grant execute on function public.set_qa_task_delay_waiver(uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';

commit;
