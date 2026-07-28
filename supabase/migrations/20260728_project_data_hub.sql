-- Turn project business-unit tabs into a real data boundary and make QA leads
-- able to view all team work while testers remain scoped to their projects.

begin;

-- Project lifecycle: planned -> active -> paused -> closed -> archived.
alter table public.qa_projects
  drop constraint if exists qa_projects_status_check;

alter table public.qa_projects
  add constraint qa_projects_status_check
  check (status in ('planned', 'active', 'paused', 'closed', 'archived'));

comment on column public.qa_projects.status is
  'Lifecycle: planned, active, paused, closed, archived';

-- A release belongs to one project. Work items continue to point to a monthly
-- project plan, which points to the same project.
alter table public.releases
  add column if not exists project_id uuid
  references public.qa_projects(id) on delete set null;

create index if not exists releases_project_id_idx
  on public.releases(project_id, status, planned_release_date);

comment on column public.releases.project_id is
  'QA project owning this release';

create or replace function public.validate_qa_task_project_chain()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  release_project_id uuid;
  plan_project_id uuid;
begin
  if new.release_id is null or new.portfolio_plan_id is null then
    return new;
  end if;

  select project_id into release_project_id
  from public.releases
  where id = new.release_id;

  select project_id into plan_project_id
  from public.project_monthly_plans
  where id = new.portfolio_plan_id;

  if release_project_id is null or plan_project_id is null then
    raise exception 'Release and project schedule must both belong to a QA project';
  end if;

  if release_project_id <> plan_project_id then
    raise exception 'Release and project schedule must belong to the same QA project';
  end if;

  return new;
end;
$$;

drop trigger if exists qa_tasks_validate_project_chain on public.qa_tasks;
create trigger qa_tasks_validate_project_chain
before insert or update of release_id, portfolio_plan_id on public.qa_tasks
for each row execute function public.validate_qa_task_project_chain();

-- Backfill only unambiguous release/project relationships.
with release_candidates as (
  select
    task.release_id,
    min(plan.project_id::text)::uuid as project_id,
    count(distinct plan.project_id) as project_count
  from public.qa_tasks task
  join public.project_monthly_plans plan
    on plan.id = task.portfolio_plan_id
  where task.release_id is not null
    and plan.project_id is not null
  group by task.release_id
)
update public.releases release
set project_id = candidate.project_id
from release_candidates candidate
where release.id = candidate.release_id
  and release.project_id is null
  and candidate.project_count = 1;

-- QA leads and system administrators see every work item. Test engineers see
-- only items they own, created, or are assigned to.
drop policy if exists "Users read own tasks" on public.qa_tasks;
drop policy if exists qa_tasks_select_by_duty on public.qa_tasks;
create policy qa_tasks_select_by_duty
on public.qa_tasks for select
to authenticated
using (public.can_view_qa_task(id));

-- Project visibility: QA leaders manage all projects. Test engineers only see
-- projects where they are explicit members.
create or replace function public.can_view_qa_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or exists (
      select 1
      from public.qa_project_members
      where project_id = target_project_id
        and member_id = auth.uid()
    );
$$;

revoke all on function public.can_view_qa_project(uuid) from public;
grant execute on function public.can_view_qa_project(uuid) to authenticated;

drop policy if exists project_monthly_plans_read_authenticated on public.project_monthly_plans;
drop policy if exists project_monthly_plans_read_by_project on public.project_monthly_plans;
create policy project_monthly_plans_read_by_project
on public.project_monthly_plans for select
to authenticated
using (
  public.is_admin()
  or (
    project_id is not null
    and public.can_view_qa_project(project_id)
  )
);

-- Releases without a project are deliberately visible only to QA management,
-- so they can be repaired from the data-health reminder.
drop policy if exists "Authenticated users read releases" on public.releases;
drop policy if exists releases_read_by_project on public.releases;
create policy releases_read_by_project
on public.releases for select
to authenticated
using (
  public.is_admin()
  or (
    project_id is not null
    and public.can_view_qa_project(project_id)
  )
);

-- Compact health view used by the project center warning panel.
create or replace view public.qa_project_data_health
with (security_invoker = true)
as
select
  (select count(*) from public.project_monthly_plans where project_id is null) as unassigned_plans,
  (select count(*) from public.releases where project_id is null and status <> 'archived') as unassigned_releases,
  (
    select count(*)
    from public.qa_tasks task
    left join public.project_monthly_plans plan
      on plan.id = task.portfolio_plan_id
    where plan.project_id is null
      and task.status not in ('done', 'cancelled')
  ) as unassigned_tasks,
  (
    select count(*)
    from public.quality_defects defect
    left join public.qa_tasks task
      on task.id = defect.qa_task_id
    left join public.project_monthly_plans plan
      on plan.id = task.portfolio_plan_id
    left join public.releases release
      on release.id = coalesce(defect.release_id, task.release_id)
    where coalesce(plan.project_id, release.project_id) is null
  ) as unassigned_bugs;

grant select on public.qa_project_data_health to authenticated;

notify pgrst, 'reload schema';

commit;
