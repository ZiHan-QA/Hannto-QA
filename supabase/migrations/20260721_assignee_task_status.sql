-- Assigned members may update workflow state without gaining permission to edit
-- task identity, assignments, effort, dates or TestHub associations.

create or replace function public.update_qa_task_status(
  target_task_id uuid,
  status_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_status text;
  target_blocked_reason text;
  target_blocked_owner_id uuid;
  target_blocked_until date;
  target_completion_note text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_admin() and not exists (
    select 1
    from public.qa_task_assignees
    where qa_task_assignees.task_id = target_task_id
      and qa_task_assignees.member_id = auth.uid()
  ) and not exists (
    select 1
    from public.qa_tasks
    where qa_tasks.id = target_task_id
      and qa_tasks.assignee_id = auth.uid()
  ) then
    raise exception 'Only task assignees can update task status';
  end if;

  target_status := coalesce(nullif(status_payload ->> 'status', ''), 'todo');
  if target_status not in ('todo', 'in_progress', 'blocked', 'done') then
    raise exception 'Invalid member task status';
  end if;

  target_blocked_reason := nullif(btrim(status_payload ->> 'blocked_reason'), '');
  target_blocked_owner_id := nullif(status_payload ->> 'blocked_owner_id', '')::uuid;
  target_blocked_until := nullif(status_payload ->> 'blocked_until', '')::date;
  target_completion_note := nullif(btrim(status_payload ->> 'completion_note'), '');

  if target_status = 'blocked' and target_blocked_reason is null then
    raise exception 'Blocked reason is required';
  end if;
  if target_status = 'done' and target_completion_note is null then
    raise exception 'Completion note is required';
  end if;

  update public.qa_tasks
  set status = target_status,
      blocked_reason = case when target_status = 'blocked' then target_blocked_reason else null end,
      blocked_owner_id = case when target_status = 'blocked' then target_blocked_owner_id else null end,
      blocked_until = case when target_status = 'blocked' then target_blocked_until else null end,
      completion_note = case when target_status = 'done' then target_completion_note else null end,
      completed_at = case
        when target_status = 'done' then coalesce(completed_at, now())
        else null
      end
  where id = target_task_id;

  if not found then
    raise exception 'Task not found';
  end if;
  return target_task_id;
end;
$$;

revoke all on function public.update_qa_task_status(uuid, jsonb) from public;
grant execute on function public.update_qa_task_status(uuid, jsonb) to authenticated;

comment on function public.update_qa_task_status(uuid, jsonb) is
  'Lets an assigned member update only task workflow status and its required notes';
