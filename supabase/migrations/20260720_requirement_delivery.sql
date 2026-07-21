-- Requirement delivery links: PRD -> requirement -> QA task -> TestHub / defect / release.

alter table public.prds
  add column if not exists release_id uuid references public.releases(id) on delete set null;

alter table public.qa_tasks
  add column if not exists requirement_id uuid references public.requirements(id) on delete set null;

alter table public.quality_defects
  add column if not exists requirement_id uuid references public.requirements(id) on delete set null;

create index if not exists prds_release_id_idx on public.prds (release_id);
create index if not exists qa_tasks_requirement_id_idx on public.qa_tasks (requirement_id);
create index if not exists quality_defects_requirement_id_idx on public.quality_defects (requirement_id);

create or replace function public.refresh_requirement_delivery_status(target_requirement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_count integer;
  done_count integer;
  started_count integer;
begin
  if target_requirement_id is null then
    return;
  end if;

  select
    count(*) filter (where status <> 'cancelled'),
    count(*) filter (where status = 'done'),
    count(*) filter (where status in ('in_progress', 'blocked'))
  into active_count, done_count, started_count
  from public.qa_tasks
  where requirement_id = target_requirement_id;

  update public.requirements
  set status = case
    when active_count = 0 then '待测试'
    when done_count = active_count then '已完成'
    when started_count > 0 or done_count > 0 then '测试中'
    else '待测试'
  end,
  updated_at = now()
  where id = target_requirement_id;
end;
$$;

create or replace function public.sync_requirement_delivery_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_requirement_delivery_status(old.requirement_id);
    return old;
  end if;

  if tg_op = 'UPDATE' and old.requirement_id is distinct from new.requirement_id then
    perform public.refresh_requirement_delivery_status(old.requirement_id);
  end if;
  perform public.refresh_requirement_delivery_status(new.requirement_id);
  return new;
end;
$$;

drop trigger if exists sync_qa_task_requirement_status on public.qa_tasks;
create trigger sync_qa_task_requirement_status
after insert or update of status, requirement_id or delete on public.qa_tasks
for each row execute function public.sync_requirement_delivery_status();

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
  target_requirement_id uuid;
  inherited_release_id uuid;
begin
  target_status := coalesce(task_payload ->> 'status', 'todo');
  target_requirement_id := nullif(task_payload ->> 'requirement_id', '')::uuid;
  if target_status = 'blocked' and nullif(btrim(task_payload ->> 'blocked_reason'), '') is null then
    raise exception 'Blocked reason is required';
  end if;
  if target_status = 'done' and nullif(btrim(task_payload ->> 'completion_note'), '') is null then
    raise exception 'Completion note is required';
  end if;

  if target_requirement_id is not null then
    select prds.release_id
    into inherited_release_id
    from public.requirements
    join public.prds on prds.id = requirements.prd_id
    where requirements.id = target_requirement_id;
    if not found then
      raise exception 'Requirement not found';
    end if;
  end if;

  target_task_id := public.save_qa_task_with_assignees(task_payload, assignee_payload);
  update public.qa_tasks set
    release_id = coalesce(nullif(task_payload ->> 'release_id', '')::uuid, inherited_release_id),
    requirement_id = target_requirement_id,
    related_type = case when target_requirement_id is not null then 'requirement' else nullif(task_payload ->> 'related_type', '') end,
    related_id = case when target_requirement_id is not null then target_requirement_id::text else nullif(task_payload ->> 'related_id', '') end,
    blocked_reason = case when target_status = 'blocked' then nullif(task_payload ->> 'blocked_reason', '') else null end,
    blocked_owner_id = case when target_status = 'blocked' then nullif(task_payload ->> 'blocked_owner_id', '')::uuid else null end,
    blocked_until = case when target_status = 'blocked' then nullif(task_payload ->> 'blocked_until', '')::date else null end,
    completion_note = case when target_status = 'done' then nullif(task_payload ->> 'completion_note', '') else null end
  where id = target_task_id;
  return target_task_id;
end;
$$;

revoke all on function public.refresh_requirement_delivery_status(uuid) from public;
revoke all on function public.refresh_requirement_delivery_status(uuid) from authenticated;
revoke all on function public.sync_requirement_delivery_status() from public;
revoke all on function public.sync_requirement_delivery_status() from authenticated;
revoke all on function public.save_qa_task_workflow(jsonb, jsonb) from public;
grant execute on function public.save_qa_task_workflow(jsonb, jsonb) to authenticated;

comment on column public.prds.release_id is 'Release delivered by this PRD';
comment on column public.qa_tasks.requirement_id is 'Requirement delivered by this QA task';
comment on column public.quality_defects.requirement_id is 'Requirement associated with this escaped defect';
