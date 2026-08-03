-- One authoritative BU assignment per platform member.
-- Business data continues to inherit BU from qa_projects; people and capacity
-- use this profile field so headcount is not inferred from task participation.

alter table public.profiles
  add column if not exists business_unit text;

do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select conname
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%business_unit%'
  loop
    execute format('alter table public.profiles drop constraint %I', constraint_record.conname);
  end loop;
end
$$;

alter table public.profiles
  add constraint profiles_business_unit_check
  check (business_unit is null or business_unit in ('xiaomi', 'consumer', 'other'));

create index if not exists profiles_business_unit_resource_idx
  on public.profiles (business_unit, resource_participant)
  where resource_participant = true;

comment on column public.profiles.business_unit is
  'Fixed member BU used for headcount, capacity and assignee candidates. NULL means unassigned; never infer Other.';

create or replace function public.enforce_profile_business_unit_admin()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.business_unit is distinct from old.business_unit
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'Only system administrators may change a member business unit';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_business_unit_admin_guard on public.profiles;
create trigger profiles_business_unit_admin_guard
before update of business_unit on public.profiles
for each row execute function public.enforce_profile_business_unit_admin();

notify pgrst, 'reload schema';
