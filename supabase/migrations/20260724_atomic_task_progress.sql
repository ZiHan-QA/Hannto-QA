-- Atomically update task workflow state and one or more manual progress entries.

create or replace function public.save_qa_task_progress(
  target_task_id uuid,
  target_work_date date,
  status_payload jsonb,
  progress_payload jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_task public.qa_tasks%rowtype;
  target_status text;
  progress_entry jsonb;
  target_executor_id uuid;
  target_points numeric(7,2);
  target_note text;
  saved_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into target_task
  from public.qa_tasks
  where id = target_task_id
  for update;

  if not found then
    raise exception 'Task not found';
  end if;

  if not (
    public.is_admin()
    or exists (
      select 1
      from public.qa_task_assignees
      where task_id = target_task_id
        and member_id = auth.uid()
    )
  ) then
    raise exception 'Not allowed to update this task';
  end if;

  target_status := coalesce(status_payload ->> 'status', target_task.status);
  if target_status not in ('todo', 'in_progress', 'blocked', 'done') then
    raise exception 'Invalid task status';
  end if;
  if target_status = 'blocked' and nullif(btrim(status_payload ->> 'blocked_reason'), '') is null then
    raise exception 'Blocked reason is required';
  end if;
  if target_status = 'done' and nullif(btrim(status_payload ->> 'completion_note'), '') is null then
    raise exception 'Completion note is required';
  end if;
  if target_work_date > current_date and jsonb_array_length(coalesce(progress_payload, '[]'::jsonb)) > 0 then
    raise exception 'Progress date cannot be in the future';
  end if;

  for progress_entry in
    select value from jsonb_array_elements(coalesce(progress_payload, '[]'::jsonb))
  loop
    target_executor_id := nullif(progress_entry ->> 'executor_id', '')::uuid;
    target_points := coalesce((progress_entry ->> 'progress_points')::numeric, 0);
    target_note := left(coalesce(progress_entry ->> 'note', ''), 1000);

    if target_executor_id is null or not exists (
      select 1
      from public.qa_task_assignees
      where task_id = target_task_id
        and member_id = target_executor_id
    ) then
      raise exception 'Progress executor is not assigned to this task';
    end if;
    if not public.is_admin() and target_executor_id <> auth.uid() then
      raise exception 'Members can only report their own progress';
    end if;
    if target_points < 0 or target_points > 50 then
      raise exception 'Progress points must be between 0 and 50';
    end if;
    if not public.is_admin() and exists (
      select 1
      from public.task_progress_logs
      where task_id = target_task_id
        and work_date = target_work_date
        and executor_id = target_executor_id
        and source = 'manual'
        and reported_by is distinct from auth.uid()
    ) then
      raise exception 'This date contains progress reported by another user';
    end if;

    delete from public.task_progress_logs
    where task_id = target_task_id
      and work_date = target_work_date
      and executor_id = target_executor_id
      and source = 'manual';

    if target_points > 0.0001 then
      insert into public.task_progress_logs (
        task_id, work_date, progress_points, source, note, executor_id, reported_by
      ) values (
        target_task_id, target_work_date, target_points, 'manual',
        target_note, target_executor_id, auth.uid()
      );
    end if;
    saved_count := saved_count + 1;
  end loop;

  update public.qa_tasks
  set
    status = target_status,
    blocked_reason = case when target_status = 'blocked' then nullif(status_payload ->> 'blocked_reason', '') else null end,
    blocked_owner_id = case when target_status = 'blocked' then nullif(status_payload ->> 'blocked_owner_id', '')::uuid else null end,
    blocked_until = case when target_status = 'blocked' then nullif(status_payload ->> 'blocked_until', '')::date else null end,
    completion_note = case when target_status = 'done' then nullif(status_payload ->> 'completion_note', '') else null end
  where id = target_task_id;

  return jsonb_build_object(
    'task_id', target_task_id,
    'status', target_status,
    'saved_progress_entries', saved_count
  );
end;
$$;

revoke all on function public.save_qa_task_progress(uuid, date, jsonb, jsonb) from public;
grant execute on function public.save_qa_task_progress(uuid, date, jsonb, jsonb) to authenticated;

comment on function public.save_qa_task_progress(uuid, date, jsonb, jsonb) is
  'Atomically replaces selected daily manual progress entries and updates task workflow state';
