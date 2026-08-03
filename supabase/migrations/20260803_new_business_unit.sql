-- Add the fourth business unit across projects and people.  Keep NULL on a
-- profile as the explicit "unassigned" state; never silently coerce it to Other.

begin;

do $$
declare
  item record;
begin
  for item in
    select conrelid::regclass as relation_name, conname
    from pg_constraint
    where contype = 'c'
      and conrelid in ('public.qa_projects'::regclass, 'public.profiles'::regclass)
      and pg_get_constraintdef(oid) ilike '%business_unit%'
  loop
    execute format('alter table %s drop constraint %I', item.relation_name, item.conname);
  end loop;
end
$$;

alter table public.qa_projects
  add constraint qa_projects_business_unit_check
  check (business_unit in ('xiaomi', 'consumer', 'new_business', 'other'));

alter table public.profiles
  add constraint profiles_business_unit_check
  check (business_unit is null or business_unit in ('xiaomi', 'consumer', 'new_business', 'other'));

comment on column public.qa_projects.business_unit is
  'Stable BU key: xiaomi, consumer, new_business or other.';

comment on column public.profiles.business_unit is
  'Fixed member BU used by resources, tasks, projects and releases. NULL means unassigned.';

commit;

notify pgrst, 'reload schema';
