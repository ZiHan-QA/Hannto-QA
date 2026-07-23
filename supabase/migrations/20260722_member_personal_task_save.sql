-- Allow authenticated members to create and maintain only their own personal
-- tasks while keeping multi-assignee task management restricted to admins.

drop policy if exists "Users insert allowed tasks" on public.qa_tasks;
create policy "Users insert allowed tasks"
on public.qa_tasks for insert
to authenticated
with check (
  created_by = auth.uid()
  and (assignee_id = auth.uid() or public.is_admin())
);

create or replace function public.save_qa_task_workflow(
  task_payload jsonb,
  assignee_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  caller_is_admin boolean := false;
  target_task_id uuid;
  requested_member_id uuid;
  target_status text;
  scope_mode text;
  scope_suite_ids text[];
  existing_creator_id uuid;
  existing_assignment_count integer;
  existing_self_assignment_count integer;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;
  if jsonb_typeof(task_payload) <> 'object' or jsonb_typeof(assignee_payload) <> 'array' then
    raise exception 'Invalid task or assignee payload';
  end if;

  select coalesce(role = 'admin', false)
  into caller_is_admin
  from public.profiles
  where id = caller_id;
  caller_is_admin := coalesce(caller_is_admin, false);

  target_task_id := nullif(task_payload ->> 'id', '')::uuid;
  if not caller_is_admin then
    if jsonb_array_length(assignee_payload) <> 1 then
      raise exception 'Members can only create personal tasks assigned to themselves';
    end if;
    requested_member_id := nullif((assignee_payload -> 0) ->> 'member_id', '')::uuid;
    if requested_member_id is distinct from caller_id then
      raise exception 'Members can only assign personal tasks to themselves';
    end if;

    if target_task_id is not null then
      select created_by
      into existing_creator_id
      from public.qa_tasks
      where id = target_task_id;
      if not found or existing_creator_id is distinct from caller_id then
        raise exception 'Members can only edit personal tasks they created';
      end if;

      select
        count(*),
        count(*) filter (where member_id = caller_id)
      into existing_assignment_count, existing_self_assignment_count
      from public.qa_task_assignees
      where task_id = target_task_id;
      if existing_assignment_count <> 1 or existing_self_assignment_count <> 1 then
        raise exception 'Multi-assignee tasks can only be edited by administrators';
      end if;
    end if;
  end if;

  target_status := coalesce(task_payload ->> 'status', 'todo');
  scope_mode := coalesce(nullif(task_payload ->> 'testhub_scope_mode', ''), 'all');
  select coalesce(array_agg(suite_id), array[]::text[])
  into scope_suite_ids
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

comment on function public.save_qa_task_workflow(jsonb, jsonb) is
  'Admin task workflow plus secure self-assigned personal task creation for members';
