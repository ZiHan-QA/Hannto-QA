-- Make project ownership independent from monthly staffing plans.
--
-- Canonical chain:
--   release -> project
--   task -> project
--   task -> optional monthly plan
--
-- A missing monthly plan is a data-health warning, not a reason to reject a
-- valid work item.

-- Intentionally do not wrap the whole migration in one transaction. Supabase
-- dashboards and open application tabs continuously read these tables; letting
-- each DDL/DML statement commit separately keeps AccessExclusive locks short
-- and avoids cross-table deadlocks during an online repair.

alter table public.qa_tasks
  add column if not exists project_id uuid
  references public.qa_projects(id) on delete set null;

create index if not exists qa_tasks_project_id_idx
  on public.qa_tasks(project_id, status, allocation_start_date, allocation_end_date);

comment on column public.qa_tasks.project_id is
  'Canonical QA project inherited from the selected release; monthly plan is optional';

update public.qa_tasks task
set project_id = release.project_id
from public.releases release
where release.id = task.release_id
  and task.project_id is distinct from release.project_id
  and release.project_id is not null;

update public.qa_tasks task
set project_id = plan.project_id
from public.project_monthly_plans plan
where plan.id = task.portfolio_plan_id
  and task.project_id is null
  and plan.project_id is not null;

create or replace function public.validate_qa_task_project_chain()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  release_project_id uuid;
  plan_project_id uuid;
begin
  if new.release_id is not null then
    select project_id into release_project_id
    from public.releases
    where id = new.release_id;

    if release_project_id is null then
      raise exception 'Selected release is not linked to a QA project';
    end if;

    if new.project_id is not null and new.project_id <> release_project_id then
      raise exception 'Task and release must belong to the same QA project';
    end if;
    new.project_id := release_project_id;
  end if;

  if new.portfolio_plan_id is not null then
    select project_id into plan_project_id
    from public.project_monthly_plans
    where id = new.portfolio_plan_id;

    if plan_project_id is null then
      raise exception 'Selected project schedule is not linked to a QA project';
    end if;
    if new.project_id is null then
      new.project_id := plan_project_id;
    elsif new.project_id <> plan_project_id then
      raise exception 'Release and project schedule must belong to the same QA project';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists qa_tasks_validate_project_chain on public.qa_tasks;
create trigger qa_tasks_validate_project_chain
before insert or update of release_id, project_id, portfolio_plan_id on public.qa_tasks
for each row execute function public.validate_qa_task_project_chain();

-- The previous atomic workflow correctly resolved the release project, but
-- rejected the save when no monthly plan covered the dates. Patch that
-- installed function in place so existing projects can apply this corrective
-- migration without replaying all earlier migrations.
do $migration$
declare
  function_ddl text;
  patched_ddl text;
begin
  if to_regprocedure('public.save_qa_task_workflow(jsonb,jsonb)') is null then
    raise exception 'Required function save_qa_task_workflow(jsonb,jsonb) is missing';
  end if;

  select pg_get_functiondef('public.save_qa_task_workflow(jsonb,jsonb)'::regprocedure)
  into function_ddl;

  patched_ddl := function_ddl;
  if position('No project schedule covers the task date range' in patched_ddl) > 0 then
    -- Keep the surrounding IF valid and turn the old hard failure into a
    -- harmless no-op. Matching only the RAISE statement is resilient to the
    -- formatting returned by pg_get_functiondef.
    patched_ddl := regexp_replace(
      patched_ddl,
      E'raise[[:space:]]+exception[[:space:]]+''No project schedule covers the task date range''[[:space:]]*;',
      'resolved_portfolio_plan_id := null;',
      'i'
    );
    if position('No project schedule covers the task date range' in patched_ddl) > 0 then
      raise exception 'Could not disable monthly-plan requirement in save_qa_task_workflow';
    end if;
  end if;

  if position('project_id = release_project_id' in patched_ddl) = 0 then
    patched_ddl := regexp_replace(
      patched_ddl,
      E'release_id[[:space:]]*=[[:space:]]*requested_release_id[[:space:]]*,',
      'release_id = requested_release_id,' || E'\n    project_id = release_project_id,',
      'i'
    );
  end if;

  if position('project_id = release_project_id' in patched_ddl) = 0 then
    raise exception 'Could not add direct project link to save_qa_task_workflow';
  end if;

  if patched_ddl <> function_ddl then
    execute patched_ddl;
  end if;
end;
$migration$;

comment on function public.save_qa_task_workflow(jsonb, jsonb) is
  'Secure task workflow save with required release/project and optional monthly-plan linkage';

notify pgrst, 'reload schema';
