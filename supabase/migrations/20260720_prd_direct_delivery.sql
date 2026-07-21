-- Allow simple PRDs to link directly to QA tasks and defects.
-- requirements remain optional acceptance scopes for complex PRDs.

alter table public.qa_tasks
  add column if not exists prd_id uuid references public.prds(id) on delete set null;

alter table public.qa_tasks
  add column if not exists test_round integer not null default 1 check (test_round between 1 and 99);

alter table public.quality_defects
  add column if not exists prd_id uuid references public.prds(id) on delete set null;

create index if not exists qa_tasks_prd_id_idx on public.qa_tasks (prd_id);
create index if not exists qa_tasks_prd_round_idx on public.qa_tasks (prd_id, test_round);
create index if not exists quality_defects_prd_id_idx on public.quality_defects (prd_id);

update public.qa_tasks as tasks
set prd_id = requirements.prd_id
from public.requirements
where tasks.requirement_id = requirements.id
  and tasks.prd_id is null;

update public.quality_defects as defects
set prd_id = requirements.prd_id
from public.requirements
where defects.requirement_id = requirements.id
  and defects.prd_id is null;

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
  target_prd_id uuid;
  target_requirement_id uuid;
  requirement_prd_id uuid;
  inherited_release_id uuid;
begin
  target_status := coalesce(task_payload ->> 'status', 'todo');
  target_prd_id := nullif(task_payload ->> 'prd_id', '')::uuid;
  target_requirement_id := nullif(task_payload ->> 'requirement_id', '')::uuid;
  if target_status = 'blocked' and nullif(btrim(task_payload ->> 'blocked_reason'), '') is null then
    raise exception 'Blocked reason is required';
  end if;
  if target_status = 'done' and nullif(btrim(task_payload ->> 'completion_note'), '') is null then
    raise exception 'Completion note is required';
  end if;

  if target_requirement_id is not null then
    select requirements.prd_id, prds.release_id
    into requirement_prd_id, inherited_release_id
    from public.requirements
    join public.prds on prds.id = requirements.prd_id
    where requirements.id = target_requirement_id;
    if not found then
      raise exception 'Requirement not found';
    end if;
    if target_prd_id is not null and target_prd_id <> requirement_prd_id then
      raise exception 'Requirement does not belong to selected PRD';
    end if;
    target_prd_id := requirement_prd_id;
  elsif target_prd_id is not null then
    select release_id into inherited_release_id
    from public.prds
    where id = target_prd_id;
    if not found then
      raise exception 'PRD not found';
    end if;
  end if;

  target_task_id := public.save_qa_task_with_assignees(task_payload, assignee_payload);
  update public.qa_tasks set
    release_id = coalesce(nullif(task_payload ->> 'release_id', '')::uuid, inherited_release_id),
    prd_id = target_prd_id,
    requirement_id = target_requirement_id,
    test_round = greatest(coalesce(nullif(task_payload ->> 'test_round', '')::integer, 1), 1),
    related_type = case
      when target_requirement_id is not null then 'requirement'
      when target_prd_id is not null then 'prd'
      else nullif(task_payload ->> 'related_type', '')
    end,
    related_id = case
      when target_requirement_id is not null then target_requirement_id::text
      when target_prd_id is not null then target_prd_id::text
      else nullif(task_payload ->> 'related_id', '')
    end,
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
revoke all on function public.refresh_requirement_delivery_status(uuid) from authenticated;
revoke all on function public.sync_requirement_delivery_status() from authenticated;

comment on column public.qa_tasks.prd_id is 'PRD delivered directly or through an optional acceptance scope';
comment on column public.qa_tasks.test_round is 'Execution round within a PRD or acceptance scope';
comment on column public.quality_defects.prd_id is 'PRD associated with this escaped defect';
