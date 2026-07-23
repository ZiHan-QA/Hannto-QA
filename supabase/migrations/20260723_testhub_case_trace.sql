-- Preserve the TestHub plan dimension for each member/day execution record.
-- Existing rows remain readable with an empty plan_id until the next local sync.

alter table public.task_testhub_daily_execution
  add column if not exists plan_id text;

update public.task_testhub_daily_execution
set plan_id = ''
where plan_id is null;

alter table public.task_testhub_daily_execution
  alter column plan_id set default '',
  alter column plan_id set not null;

alter table public.task_testhub_daily_execution
  drop constraint if exists task_testhub_daily_execution_pkey;

alter table public.task_testhub_daily_execution
  add constraint task_testhub_daily_execution_pkey
  primary key (task_id, work_date, executor_key, plan_id);

create index if not exists task_testhub_daily_execution_task_plan_idx
  on public.task_testhub_daily_execution (task_id, plan_id);

comment on column public.task_testhub_daily_execution.plan_id is
  'TestHub plan that contributed this member/day executed-case count';
