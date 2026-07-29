-- Keep task workflow permissions aligned with the three-duty model.
-- QA leads manage team tasks in the UI and must receive the same workflow
-- save permission as system administrators.

begin;

do $$
declare
  function_definition text;
  patched_definition text;
begin
  if to_regprocedure('public.save_qa_task_workflow(jsonb,jsonb)') is null then
    raise exception 'Required function save_qa_task_workflow(jsonb,jsonb) is missing';
  end if;

  select pg_get_functiondef('public.save_qa_task_workflow(jsonb,jsonb)'::regprocedure)
  into function_definition;

  if position('role in (''admin'', ''qa_lead'')' in function_definition) > 0 then
    return;
  end if;

  patched_definition := replace(
    function_definition,
    'select coalesce(role = ''admin'', false)',
    'select coalesce(role in (''admin'', ''qa_lead''), false)'
  );

  if patched_definition = function_definition then
    raise exception 'Could not patch QA lead permission in save_qa_task_workflow';
  end if;

  execute patched_definition;
end
$$;

revoke all on function public.save_qa_task_workflow(jsonb, jsonb) from public;
grant execute on function public.save_qa_task_workflow(jsonb, jsonb) to authenticated;

comment on function public.save_qa_task_workflow(jsonb, jsonb) is
  'Secure task workflow save; system administrators and QA leads can manage team tasks';

notify pgrst, 'reload schema';

commit;
