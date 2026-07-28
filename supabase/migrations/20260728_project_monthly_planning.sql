-- Portfolio-level monthly QA capacity planning.

begin;

create table if not exists public.project_monthly_plans (
  id uuid primary key default gen_random_uuid(),
  plan_month date not null,
  project_name text not null check (length(btrim(project_name)) between 1 and 120),
  project_type text not null default 'other'
    check (project_type in ('app', 'pad', 'pc', 'device', 'other')),
  required_person_months numeric(7,2) not null
    check (required_person_months > 0 and required_person_months <= 999),
  owner_name text not null default '',
  status text not null default 'planned'
    check (status in ('planned', 'confirmed', 'completed', 'cancelled')),
  notes text not null default '',
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_monthly_plans_month_start_check
    check (plan_month = date_trunc('month', plan_month)::date)
);

alter table public.project_monthly_plans
  add column if not exists end_month date;

alter table public.project_monthly_plans
  add column if not exists monthly_allocations jsonb not null default '{}'::jsonb;

update public.project_monthly_plans
set end_month = plan_month
where end_month is null;

update public.project_monthly_plans
set monthly_allocations = jsonb_build_object(plan_month::text, required_person_months)
where monthly_allocations = '{}'::jsonb;

alter table public.project_monthly_plans
  alter column end_month set default date_trunc('month', current_date)::date,
  alter column end_month set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.project_monthly_plans'::regclass
      and conname = 'project_monthly_plans_end_month_check'
  ) then
    alter table public.project_monthly_plans
      add constraint project_monthly_plans_end_month_check
      check (
        end_month = date_trunc('month', end_month)::date
        and end_month >= plan_month
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.project_monthly_plans'::regclass
      and conname = 'project_monthly_plans_allocations_check'
  ) then
    alter table public.project_monthly_plans
      add constraint project_monthly_plans_allocations_check
      check (jsonb_typeof(monthly_allocations) = 'object');
  end if;
end;
$$;

create index if not exists project_monthly_plans_month_idx
  on public.project_monthly_plans (plan_month, status, project_name);

drop trigger if exists set_project_monthly_plans_updated_at on public.project_monthly_plans;
create trigger set_project_monthly_plans_updated_at
before update on public.project_monthly_plans
for each row execute function public.set_updated_at();

alter table public.project_monthly_plans enable row level security;

drop policy if exists project_monthly_plans_read_authenticated on public.project_monthly_plans;
drop policy if exists project_monthly_plans_write_admin on public.project_monthly_plans;

create policy project_monthly_plans_read_authenticated
on public.project_monthly_plans for select
to authenticated using (true);

create policy project_monthly_plans_write_admin
on public.project_monthly_plans for all
to authenticated
using (public.is_admin())
with check (public.is_admin() and created_by = auth.uid());

revoke all on public.project_monthly_plans from anon;
grant select, insert, update, delete on public.project_monthly_plans to authenticated;

comment on table public.project_monthly_plans is
  'Project schedule with explicit person-month allocation for each month';

alter table public.qa_tasks
  add column if not exists portfolio_plan_id uuid
  references public.project_monthly_plans(id) on delete set null;

create index if not exists qa_tasks_portfolio_plan_idx
  on public.qa_tasks (portfolio_plan_id, status)
  where portfolio_plan_id is not null;

comment on column public.qa_tasks.portfolio_plan_id is
  'Portfolio project schedule that owns this task; actual completed points roll up automatically';

create or replace function public.qa_server_now()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select now();
$$;

revoke all on function public.qa_server_now() from public;
grant execute on function public.qa_server_now() to authenticated;

comment on function public.qa_server_now() is
  'Trusted database timestamp used for server-timed QA task effort calculations';

commit;
