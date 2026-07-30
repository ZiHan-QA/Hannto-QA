-- Link repeated QA execution rounds without merging their independent progress.

begin;

alter table public.qa_tasks
  add column if not exists task_series_id uuid,
  add column if not exists source_task_id uuid references public.qa_tasks(id) on delete set null;

update public.qa_tasks
set task_series_id = id
where task_series_id is null;

alter table public.qa_tasks
  alter column task_series_id set default gen_random_uuid(),
  alter column task_series_id set not null;

create unique index if not exists qa_tasks_series_round_unique_idx
  on public.qa_tasks(task_series_id, test_round);

create or replace function public.link_qa_task_series(
  target_task_id uuid,
  source_task_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  caller_role text;
  target_row public.qa_tasks%rowtype;
  source_row public.qa_tasks%rowtype;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;

  select role into caller_role
  from public.profiles
  where id = caller_id;

  select * into target_row
  from public.qa_tasks
  where id = target_task_id;

  if not found then
    raise exception 'Target task not found';
  end if;

  if coalesce(caller_role, 'tester') not in ('admin', 'qa_lead')
    and target_row.created_by is distinct from caller_id then
    raise exception 'Only QA managers or the task creator may change round links';
  end if;

  if source_task_id is null then
    update public.qa_tasks
    set task_series_id = id,
        source_task_id = null
    where id = target_task_id;
    return target_task_id;
  end if;

  if source_task_id = target_task_id then
    return target_row.task_series_id;
  end if;

  select * into source_row
  from public.qa_tasks
  where id = source_task_id;

  if not found then
    raise exception 'Source task not found';
  end if;

  if target_row.project_id is distinct from source_row.project_id
    or target_row.release_id is distinct from source_row.release_id then
    raise exception 'Linked rounds must belong to the same project and release';
  end if;

  update public.qa_tasks
  set task_series_id = source_row.task_series_id,
      source_task_id = source_row.id
  where id = target_task_id;

  return source_row.task_series_id;
end;
$$;

revoke all on function public.link_qa_task_series(uuid, uuid) from public;
grant execute on function public.link_qa_task_series(uuid, uuid) to authenticated;

comment on column public.qa_tasks.task_series_id is
  'Stable group identifier shared by repeated QA execution rounds';
comment on column public.qa_tasks.source_task_id is
  'Task copied or selected as the source of this round';
comment on function public.link_qa_task_series(uuid, uuid) is
  'Links or unlinks independent QA task rounds after validating project, release and caller permission';

notify pgrst, 'reload schema';

commit;
