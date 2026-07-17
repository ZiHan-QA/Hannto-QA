-- Allow one QA task to aggregate multiple TestHub plans (for example Android + iOS).

alter table public.qa_tasks
  add column if not exists testhub_plan_ids text[] not null default '{}'::text[];

update public.qa_tasks
set testhub_plan_ids = array[testhub_plan_id]
where testhub_plan_id is not null
  and cardinality(testhub_plan_ids) = 0;

alter table public.task_testhub_progress
  add column if not exists plan_ids text[] not null default '{}'::text[];

update public.task_testhub_progress
set plan_ids = array[plan_id]
where plan_id is not null
  and cardinality(plan_ids) = 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.qa_tasks'::regclass
      and conname = 'qa_tasks_testhub_plan_ids_check'
  ) then
    alter table public.qa_tasks
      add constraint qa_tasks_testhub_plan_ids_check
      check (
        cardinality(testhub_plan_ids) <= 10
        and array_position(testhub_plan_ids, null) is null
      );
  end if;
end;
$$;

comment on column public.qa_tasks.testhub_plan_ids is
  'All TestHub plan IDs aggregated for this task; legacy testhub_plan_id keeps the first plan';
comment on column public.task_testhub_progress.plan_ids is
  'TestHub plan IDs included in the latest aggregated execution snapshot';
