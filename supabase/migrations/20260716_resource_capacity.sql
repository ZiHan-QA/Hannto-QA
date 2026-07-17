-- Daily resource capacity for QA task planning.
-- Allocation ranges use [start_date, end_date): start is included, end is excluded.

alter table public.profiles
  add column if not exists daily_capacity numeric(5,2) not null default 1.00;

alter table public.qa_tasks
  add column if not exists allocation_start_date date,
  add column if not exists allocation_end_date date,
  add column if not exists effort_person_days numeric(7,2);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_daily_capacity_check'
  ) then
    alter table public.profiles
      add constraint profiles_daily_capacity_check
      check (daily_capacity > 0 and daily_capacity <= 5);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.qa_tasks'::regclass
      and conname = 'qa_tasks_allocation_check'
  ) then
    alter table public.qa_tasks
      add constraint qa_tasks_allocation_check
      check (
        (
          allocation_start_date is null
          and allocation_end_date is null
          and effort_person_days is null
        )
        or
        (
          allocation_start_date is not null
          and allocation_end_date is not null
          and allocation_end_date > allocation_start_date
          and effort_person_days > 0
          and effort_person_days <= 365
        )
      );
  end if;
end;
$$;

create index if not exists qa_tasks_resource_range_idx
  on public.qa_tasks (allocation_start_date, allocation_end_date, assignee_id)
  where effort_person_days is not null;

comment on column public.profiles.daily_capacity is
  'Available resource points per calendar day; 1.00 means one full person-day';
comment on column public.qa_tasks.allocation_start_date is
  'Resource allocation start date, inclusive';
comment on column public.qa_tasks.allocation_end_date is
  'Resource allocation end date, exclusive';
comment on column public.qa_tasks.effort_person_days is
  'Total estimated effort in person-days distributed evenly over the allocation range';
