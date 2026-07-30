-- Allow one multi-assignee task to assign different TestHub modules to each
-- responsible member. Existing tasks keep the proportional-by-effort fallback
-- because their per-member suite arrays remain empty.

begin;

alter table public.qa_task_assignees
  add column if not exists testhub_suite_ids text[] not null default '{}'::text[],
  add column if not exists testhub_suite_names text[] not null default '{}'::text[],
  add column if not exists testhub_target_cases integer not null default 0
    check (testhub_target_cases >= 0);

comment on column public.qa_task_assignees.testhub_suite_ids is
  'TestHub suites assigned specifically to this responsible member';
comment on column public.qa_task_assignees.testhub_suite_names is
  'Resolved suite names from the latest local TestHub synchronization';
comment on column public.qa_task_assignees.testhub_target_cases is
  'Case denominator for this member after applying the member suite scope';

create or replace function public.save_qa_task_testhub_assignee_scopes(
  target_task_id uuid,
  scope_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  allowed_suite_ids text[];
  assigned_suite_ids text[] := '{}'::text[];
  scope_item jsonb;
  target_member_id uuid;
  member_suite_ids text[];
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;
  if not public.is_admin() then
    raise exception 'Only QA leads or system administrators can assign TestHub modules';
  end if;
  if jsonb_typeof(coalesce(scope_payload, '[]'::jsonb)) <> 'array' then
    raise exception 'Invalid assignee scope payload';
  end if;

  select coalesce(testhub_scope_suite_ids, '{}'::text[])
  into allowed_suite_ids
  from public.qa_tasks
  where id = target_task_id;
  if not found then
    raise exception 'Task not found';
  end if;

  update public.qa_task_assignees
  set testhub_suite_ids = '{}'::text[],
      testhub_suite_names = '{}'::text[],
      testhub_target_cases = 0
  where task_id = target_task_id;

  for scope_item in
    select value from jsonb_array_elements(coalesce(scope_payload, '[]'::jsonb))
  loop
    target_member_id := nullif(scope_item ->> 'member_id', '')::uuid;
    select coalesce(array_agg(distinct suite_id), '{}'::text[])
    into member_suite_ids
    from jsonb_array_elements_text(coalesce(scope_item -> 'testhub_suite_ids', '[]'::jsonb)) suites(suite_id);

    if target_member_id is null or cardinality(member_suite_ids) = 0 then
      raise exception 'Every scoped member must have at least one TestHub suite';
    end if;
    if exists (
      select 1 from unnest(member_suite_ids) suite_id
      where not (suite_id = any(allowed_suite_ids))
    ) then
      raise exception 'Member suite must belong to the task suite scope';
    end if;
    if member_suite_ids && assigned_suite_ids then
      raise exception 'A TestHub suite may only be assigned to one member';
    end if;
    assigned_suite_ids := assigned_suite_ids || member_suite_ids;

    update public.qa_task_assignees
    set testhub_suite_ids = member_suite_ids,
        testhub_suite_names = '{}'::text[],
        testhub_target_cases = 0
    where task_id = target_task_id
      and member_id = target_member_id;
    if not found then
      raise exception 'Scoped member is not assigned to this task';
    end if;
  end loop;

  if cardinality(assigned_suite_ids) > 0
     and not (
       assigned_suite_ids @> allowed_suite_ids
       and allowed_suite_ids @> assigned_suite_ids
     ) then
    raise exception 'Every task TestHub suite must be assigned to one member';
  end if;
end;
$$;

revoke all on function public.save_qa_task_testhub_assignee_scopes(uuid, jsonb) from public;
grant execute on function public.save_qa_task_testhub_assignee_scopes(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
